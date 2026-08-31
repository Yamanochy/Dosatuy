const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
admin.initializeApp();

// ---------- отключение/включение доступа водителя (только для руководителя) ----------
// Отключить доступ можно только так — через серверную функцию с правами
// администратора. Просто удалить профиль в Firestore недостаточно: вход
// в Firebase Auth от этого не заблокируется, человек просто получит
// профиль "по умолчанию" и продолжит пользоваться приложением.
exports.setDriverAccess = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Нужно быть авторизованным.");
  const callerUid = request.auth.uid;
  const callerDoc = await admin.firestore().collection("users").doc(callerUid).get();
  if (!callerDoc.exists || callerDoc.data().role !== "manager") {
    throw new HttpsError("permission-denied", "Только руководитель может управлять доступом.");
  }
  const targetUid = request.data && request.data.uid;
  if (!targetUid) throw new HttpsError("invalid-argument", "Не указан пользователь.");
  if (targetUid === callerUid) throw new HttpsError("failed-precondition", "Нельзя отключить самого себя.");

  const disable = request.data.disable !== false; // true = отключить (по умолчанию), false = включить обратно
  await admin.auth().updateUser(targetUid, { disabled: disable });
  if (disable) {
    // разлогинивает активные сессии этого пользователя — без этого уже
    // выданный токен мог бы ещё поработать до истечения (обычно до часа)
    await admin.auth().revokeRefreshTokens(targetUid);
  }
  await admin.firestore().collection("users").doc(targetUid).set({ disabled: disable }, { merge: true });
  return { ok: true };
});

// убирает из fcmTokens те токены, которые Google отклонил как недействительные
// (удалённое приложение, отключённые уведомления и т.п.)
async function pruneInvalidTokens(usersSnap, tokens, responses) {
  const invalidTokens = [];
  responses.forEach((r, i) => {
    if (!r.success && r.error && r.error.code === "messaging/registration-token-not-registered") {
      invalidTokens.push(tokens[i]);
    }
  });
  if (!invalidTokens.length) return;
  const batch = admin.firestore().batch();
  usersSnap.forEach((doc) => {
    const data = doc.data();
    if (Array.isArray(data.fcmTokens)) {
      const filtered = data.fcmTokens.filter((t) => !invalidTokens.includes(t));
      if (filtered.length !== data.fcmTokens.length) {
        batch.update(doc.ref, { fcmTokens: filtered });
      }
    }
  });
  await batch.commit();
}

exports.onNewChatMessage = onDocumentCreated("chatMessages/{msgId}", async (event) => {
  const snap = event.data;
  if (!snap) return;
  const msg = snap.data();

  const usersSnap = await admin.firestore().collection("users").get();
  const tokens = [];
  usersSnap.forEach((doc) => {
    if (doc.id === msg.senderUid) return; // не слать самому себе
    const data = doc.data();
    if (Array.isArray(data.fcmTokens)) tokens.push(...data.fcmTokens);
  });
  if (!tokens.length) return;

  const bodyText =
    msg.text && msg.text.length > 100 ? msg.text.slice(0, 100) + "…" : msg.text;

  const response = await admin.messaging().sendEachForMulticast({
    tokens,
    // ВАЖНО: только data, без notification — иначе браузер сам покажет
    // системное уведомление ДОПОЛНИТЕЛЬНО к тому, что показывает наш
    // sw.js вручную, и получается два показа на одно сообщение.
    data: {
      title: `${msg.senderName || "Сообщение"} · Вахта 45×45`,
      body: bodyText || "",
    },
    webpush: {
      fcmOptions: { link: "https://yamanochy.github.io/Dosatuy/" },
    },
  });

  await pruneInvalidTokens(usersSnap, tokens, response.responses);
});

// каждый день в 20:00 по времени Забайкалья — сводка руководителям:
// сколько рейсов было сегодня и сколько заработано
exports.dailySummary = onSchedule(
  { schedule: "0 20 * * *", timeZone: "Asia/Novosibirsk" },
  async () => {
    const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Novosibirsk" }); // YYYY-MM-DD

    const db = admin.firestore();
    const [ttnSnap, maintSnap, usersSnap] = await Promise.all([
      db.collection("ttnDocs").where("ttnDate", "==", todayStr).get(),
      db.collection("maintenanceDocs").where("date", "==", todayStr).get(),
      db.collection("users").get(),
    ]);

    const tripsCount = ttnSnap.size;
    // каждый рейс — 6000₽. ТО/ремонт — по виду: ТО всегда 6000₽ суммарно,
    // ремонт — по цене вида ремонта, сохранённой в самой записи (если её
    // нет — это старая запись, до появления видов ремонта — тоже 6000₽)
    let maintMoney = 0;
    maintSnap.forEach((doc) => {
      const m = doc.data();
      maintMoney += (m.type === "Ремонт" && m.repairPrice) ? Number(m.repairPrice) : 6000;
    });
    const money = tripsCount * 6000 + maintMoney;

    const tokens = [];
    usersSnap.forEach((doc) => {
      const u = doc.data();
      if (u.role === "manager" && Array.isArray(u.fcmTokens)) tokens.push(...u.fcmTokens);
    });
    if (!tokens.length) return;

    const bodyText = `Рейсов: ${tripsCount} · ТО/ремонт: ${maintSnap.size} · Заработано: ${money.toLocaleString("ru-RU")} ₽`;

    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      data: {
        title: "Итоги дня · Вахта 45×45",
        body: bodyText,
      },
      webpush: {
        fcmOptions: { link: "https://yamanochy.github.io/Dosatuy/" },
      },
    });

    await pruneInvalidTokens(usersSnap, tokens, response.responses);
  }
);
