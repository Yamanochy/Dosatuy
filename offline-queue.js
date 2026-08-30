// ============================================================
// ОФЛАЙН-ОЧЕРЕДЬ — если при сохранении ТТН или ТО/ремонта нет
// интернета, запись (вместе с уже сжатыми фото) кладётся в IndexedDB
// на телефоне и сама отправляется, как только сеть появится снова.
// Ничего не теряется, даже если человек закрыл приложение.
// ============================================================

const OFFLINE_DB_NAME = "vahta-offline-queue";
const OFFLINE_STORE = "pending";

function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(OFFLINE_STORE)) {
        req.result.createObjectStore(OFFLINE_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// payload — обычные поля формы (без файлов), photoBlobs — уже сжатые
// на телефоне картинки (Blob), это не требует сети
async function queueAdd(kind, payload, photoBlobs) {
  const idb = await openOfflineDB();
  const item = {
    id: "q" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
    kind, payload, photoBlobs, queuedAt: Date.now(),
  };
  await new Promise((resolve, reject) => {
    const tx = idb.transaction(OFFLINE_STORE, "readwrite");
    tx.objectStore(OFFLINE_STORE).put(item);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  return item;
}

async function queueGetAll() {
  try {
    const idb = await openOfflineDB();
    return await new Promise((resolve, reject) => {
      const tx = idb.transaction(OFFLINE_STORE, "readonly");
      const req = tx.objectStore(OFFLINE_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return [];
  }
}

async function queueDelete(id) {
  const idb = await openOfflineDB();
  await new Promise((resolve, reject) => {
    const tx = idb.transaction(OFFLINE_STORE, "readwrite");
    tx.objectStore(OFFLINE_STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

let pendingQueueCache = [];
let offlineFlushInProgress = false;

async function refreshPendingQueueCache() {
  pendingQueueCache = await queueGetAll();
}

// true, если ошибка похожа на "нет сети", а не на настоящую проблему
// (неверные данные, отказ сервера и т.п.)
function looksLikeNetworkError(e) {
  if (!navigator.onLine) return true;
  const msg = String(e && e.message || "");
  return /fetch|network|internet|offline/i.test(msg);
}

// пробует отправить всё, что скопилось в очереди. Безопасно вызывать
// сколько угодно раз подряд — параллельные вызовы не пересекаются.
// Останавливается на первой сетевой неудаче (чтобы не долбить сеть
// по кругу), остальное подождёт следующего вызова.
async function flushOfflineQueue() {
  if (offlineFlushInProgress) return;
  offlineFlushInProgress = true;
  try {
    await refreshPendingQueueCache();
    for (const item of pendingQueueCache) {
      try {
        const urls = [];
        for (const blob of item.photoBlobs) {
          urls.push(await uploadToCloudinary(blob));
        }
        const coll = item.kind === "ttn" ? "ttnDocs" : "maintenanceDocs";
        await db.collection(coll).add({
          ...item.payload,
          photoUrls: urls,
          uploadedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        await queueDelete(item.id);
      } catch (e) {
        break; // сети всё ещё нет (или другая заминка) — остальное попробуем позже
      }
    }
  } finally {
    await refreshPendingQueueCache();
    offlineFlushInProgress = false;
    if (typeof currentTab !== "undefined" && currentTab === "documents") render();
  }
}

window.addEventListener("online", () => flushOfflineQueue());
// на телефонах событие "online" срабатывает не всегда надёжно —
// подстраховываемся периодической проверкой
setInterval(() => { if (navigator.onLine) flushOfflineQueue(); }, 25000);
