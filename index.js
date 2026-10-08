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

// ============================================================
// ПРИЛОЖЕНИЕ «СМЕНА» (водители техники, Новосибирск) — push чата.
// Отдельная коллекция сообщений (nskChat) и отдельные адреса
// устройств (nskPush), чтобы бригады Досатуя и Новосибирска не
// получали уведомления друг друга.
// ============================================================

// те же два email, что в Табеле и в правилах Firestore
const NSK_MANAGER_EMAILS = ["letiushev.a.a@gmail.com", "mandrow@yandex.ru"];
const NSK_APP_URL = "https://yamanochy.github.io/Smena/";

// кому сейчас положено получать уведомления: водители с действующим
// доступом и руководители. Тому, у кого доступ отключили, чат больше
// не приходит, даже если адрес его телефона остался в базе.
async function nskMemberUids() {
  const uids = new Set();
  const accessSnap = await admin.firestore().collection("nskAccess").where("active", "==", true).get();
  accessSnap.forEach((doc) => uids.add(doc.id));
  const found = await admin.auth().getUsers(NSK_MANAGER_EMAILS.map((email) => ({ email })));
  found.users.forEach((u) => uids.add(u.uid));
  return uids;
}

exports.nskChatPush = onDocumentCreated("nskChat/{msgId}", async (event) => {
  const snap = event.data;
  if (!snap) return;
  const msg = snap.data();

  const [members, pushSnap] = await Promise.all([
    nskMemberUids(),
    admin.firestore().collection("nskPush").get(),
  ]);
  const tokens = [];
  const owners = []; // чей это адрес — чтобы убрать его, если он устарел
  pushSnap.forEach((doc) => {
    if (doc.id === msg.senderUid) return; // не слать самому себе
    if (!members.has(doc.id)) return;
    const list = doc.data().tokens;
    if (Array.isArray(list)) list.forEach((t) => { tokens.push(t); owners.push(doc.ref); });
  });
  if (!tokens.length) return;

  const text = msg.text || (msg.imageUrl ? "Фото" : "");
  const bodyText = text.length > 100 ? text.slice(0, 100) + "…" : text;

  const response = await admin.messaging().sendEachForMulticast({
    tokens,
    // только data, без notification — иначе браузер покажет уведомление
    // второй раз, вдобавок к тому, что показывает sw.js приложения
    data: {
      title: `${msg.senderName || "Сообщение"} · Смена`,
      body: bodyText,
    },
    webpush: {
      fcmOptions: { link: NSK_APP_URL },
    },
  });

  // адреса, которые Google отклонил (приложение удалили, уведомления выключили)
  const batch = admin.firestore().batch();
  let stale = 0;
  response.responses.forEach((r, i) => {
    if (!r.success && r.error && r.error.code === "messaging/registration-token-not-registered") {
      batch.update(owners[i], { tokens: admin.firestore.FieldValue.arrayRemove(tokens[i]) });
      stale++;
    }
  });
  if (stale) await batch.commit();
});
