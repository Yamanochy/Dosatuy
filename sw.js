// Единый service worker: офлайн-кэш приложения + фоновые push-уведомления.
// (Раньше это были два разных файла на одном адресе сайта — они конфликтовали
// за право быть активным SW, из-за чего фоновые уведомления не показывались.)

// Firebase Messaging — оборачиваем в try/catch: если сети нет в момент
// запуска SW, офлайн-кэширование ниже всё равно должно продолжить работать.
try {
  importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

  firebase.initializeApp({
    apiKey: "AIzaSyA4BZspRcmA8I_j6mUtIvIHJcTd22k48fg",
    authDomain: "dosatuy.firebaseapp.com",
    projectId: "dosatuy",
    storageBucket: "dosatuy.firebasestorage.app",
    messagingSenderId: "630795971089",
    appId: "1:630795971089:web:3b80b4d2436bbcc9ac5fb0",
  });

  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || "Вахта 45×45";
    const body = payload.notification?.body || "";
    self.registration.showNotification(title, {
      body,
      icon: "icon-192.png",
      badge: "icon-192.png",
    });
  });
} catch (e) {
  // офлайн или сервис недоступен — просто не будет фоновых push в этот раз
}

const VERSION = "vahta-v11";
const ASSETS = [
  "./",
  "./index.html",
  "./data.js",
  "./app.js",
  "./docs.js",
  "./chat.js",
  "./notifications.js",
  "./auth.js",
  "./firebase-config.js",
  "./cloud-config.js",
  "./vapid-config.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const network = fetch(e.request)
        .then((resp) => {
          if (resp && resp.ok && e.request.url.startsWith(self.location.origin)) {
            const clone = resp.clone();
            caches.open(VERSION).then((cache) => cache.put(e.request, clone));
          }
          return resp;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
