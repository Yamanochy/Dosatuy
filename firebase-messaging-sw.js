// Отдельный service worker — требование Firebase Messaging.
// Конфиг здесь продублирован (сервис-воркеры не видят обычные <script> теги).
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
