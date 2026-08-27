// ============================================================
// PUSH-УВЕДОМЛЕНИЯ — включаются один раз с кнопки в чате,
// приходят даже когда приложение закрыто (кроме iPhone без
// установки на экран "Домой" — см. инструкцию)
// ============================================================

let messaging = null;
if ("serviceWorker" in navigator && "PushManager" in window) {
  try { messaging = firebase.messaging(); } catch (e) { messaging = null; }
}

function pushPermissionStatus() {
  if (!messaging || !("Notification" in window)) return "unsupported";
  return Notification.permission; // "default" | "granted" | "denied"
}

async function enablePushNotifications() {
  if (!messaging) {
    alert("Этот браузер не поддерживает push-уведомления.");
    return false;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;
    const reg = await navigator.serviceWorker.register("firebase-messaging-sw.js");
    const token = await messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (token && currentUser) {
      await db.collection("users").doc(currentUser.uid).set(
        { fcmTokens: firebase.firestore.FieldValue.arrayUnion(token) },
        { merge: true }
      );
    }
    return true;
  } catch (e) {
    console.error("Push enable error", e);
    alert("Не удалось включить уведомления: " + e.message);
    return false;
  }
}

if (messaging) {
  messaging.onMessage((payload) => {
    // приложение открыто на экране — показываем баннер внутри приложения
    showInAppBanner(payload.notification?.title, payload.notification?.body);
  });
}

function showInAppBanner(title, body) {
  const banner = el("div", "fixed top-3 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white rounded-2xl shadow-lg px-4 py-3 max-w-xs w-[90%]");
  banner.innerHTML = `<div class="font-semibold text-sm">${escapeHtml(title || "Новое сообщение")}</div><div class="text-xs text-slate-300 mt-0.5">${escapeHtml(body || "")}</div>`;
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 4000);
}
