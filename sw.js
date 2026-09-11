// Единый service worker: офлайн-кэш приложения + фоновые push-уведомления.
// (Раньше это были два разных файла на одном адресе сайта — они конфликтовали
// за право быть активным SW, из-за чего фоновые уведомления не показывались.)

// ---------- счётчик непрочитанных для значка на иконке (Badging API) ----------
function openBadgeDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("vahta-badge", 1);
    req.onupgradeneeded = () => { req.result.createObjectStore("kv"); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function getUnreadCount() {
  try {
    const db = await openBadgeDB();
    return await new Promise((resolve) => {
      const req = db.transaction("kv", "readonly").objectStore("kv").get("unread");
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => resolve(0);
    });
  } catch (e) { return 0; }
}
async function setUnreadCount(n) {
  try {
    const db = await openBadgeDB();
    await new Promise((resolve) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(n, "unread");
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch (e) {}
}

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
  messaging.onBackgroundMessage(async (payload) => {
    const title = payload.data?.title || "Вахта 45×45";
    const body = payload.data?.body || "";
    self.registration.showNotification(title, {
      body,
      icon: "icon-192.png",
      badge: "icon-192.png",
      vibrate: [200, 100, 200],
      silent: false,
      tag: "chat-" + Date.now(), // не схлопывать разные сообщения в одно
      renotify: true,
    });

    const next = (await getUnreadCount()) + 1;
    await setUnreadCount(next);
    try {
      if (self.navigator && self.navigator.setAppBadge) await self.navigator.setAppBadge(next);
    } catch (e) {}
  });
} catch (e) {
  // офлайн или сервис недоступен — просто не будет фоновых push в этот раз
}

// клик по уведомлению — открыть/переключиться на приложение
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window" }).then((list) => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow("./");
    })
  );
});

const VERSION = "vahta-v40";

// Свои файлы — без них приложение офлайн не запустится вообще.
// Если хоть один не скачался, установка ДОЛЖНА провалиться, чтобы
// не затереть предыдущий рабочий кэш (раньше из-за этого одно
// неудачное обновление на плохой связи ломало офлайн-режим).
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./data.js",
  "./offline-queue.js",
  "./app.js",
  "./docs.js",
  "./timesheet.js",
  "./stats.js",
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

// Внешние библиотеки — тоже нужны офлайн, но если какая-то разово не
// скачалась, рушить установку из-за неё не стоит: подтянется позже сама.
const CDN_ASSETS = [
  "https://cdn.tailwindcss.com",
  "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-functions-compat.js",
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // свои файлы — строго, с проверкой; любая ошибка прерывает установку
    for (const url of CORE_ASSETS) {
      const resp = await fetch(url, { cache: "reload" });
      if (!resp || !resp.ok) throw new Error("Не скачался " + url);
      await cache.put(url, resp);
    }
    // внешние — по возможности
    await Promise.all(CDN_ASSETS.map((url) =>
      fetch(url, { mode: "no-cors" }).then((r) => cache.put(url, r)).catch(() => {})
    ));
  })());
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

// сеть, но с таймаутом: если связь формально есть, а данные не идут
// (обычное дело на вахте), не ждём бесконечно, а отдаём из кэша
function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    fetch(request).then((resp) => { clearTimeout(timer); resolve(resp); },
                        (err) => { clearTimeout(timer); reject(err); });
  });
}

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const isOwnFile = url.origin === self.location.origin;

  // запросы к самой базе/облаку не трогаем — Firebase сам умеет офлайн
  if (!isOwnFile && !CDN_ASSETS.some((a) => e.request.url.startsWith(a.split("?")[0]))) return;

  e.respondWith((async () => {
    try {
      const resp = await fetchWithTimeout(e.request, 3000);
      if (resp && resp.ok && isOwnFile) {
        const clone = resp.clone();
        caches.open(VERSION).then((cache) => cache.put(e.request, clone));
      }
      return resp;
    } catch (err) {
      const cached = await caches.match(e.request);
      if (cached) return cached;
      // на всякий случай: любой незнакомый переход внутри приложения
      // отдаём как главную страницу, чтобы не было пустого экрана
      if (e.request.mode === "navigate") {
        const fallback = await caches.match("./index.html");
        if (fallback) return fallback;
      }
      return new Response("Нет сети и нет сохранённой копии", { status: 503, statusText: "Offline" });
    }
  })());
});
