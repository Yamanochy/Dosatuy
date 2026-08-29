// ============================================================
// ДОКУМЕНТЫ — ТТН/путевые листы + ТО и ремонт (два режима одной вкладки)
// ============================================================

const MAX_PHOTOS = 3;

let docsMode = "ttn"; // "ttn" | "maintenance"

// ---------- ТТН ----------
let docsCache = [];
let docsUnsub = null;
let addFormOpen = false;
let selectedFiles = []; // массив File, до MAX_PHOTOS
let docsFilterFrom = ""; // фильтр по дате ТТН, ISO "YYYY-MM-DD"
let docsFilterTo = "";
let docsShowArchive = false; // false = текущая неделя, true = архив (до вторника)

function subscribeDocs() {
  if (docsUnsub) return;
  docsUnsub = db.collection("ttnDocs").orderBy("uploadedAt", "desc")
    .onSnapshot((snap) => {
      docsCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (currentTab === "documents" && docsMode === "ttn") renderDocuments();
    }, (err) => { console.error(err); });
}

// ---------- ТО / Ремонт ----------
let maintenanceCache = [];
let maintenanceUnsub = null;
let maintFormOpen = false;
let maintSelectedFiles = [];
let maintFilterFrom = "";
let maintFilterTo = "";
let maintShowArchive = false;

function subscribeMaintenance() {
  if (maintenanceUnsub) return;
  maintenanceUnsub = db.collection("maintenanceDocs").orderBy("uploadedAt", "desc")
    .onSnapshot((snap) => {
      maintenanceCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (currentTab === "documents" && docsMode === "maintenance") renderDocuments();
    }, (err) => { console.error(err); });
}

// ближайший (текущий или прошедший) вторник, 00:00 по местному времени —
// граница архива: всё, что добавлено раньше — уходит в «Архив»
function mostRecentTuesday(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0=вс,1=пн,2=вт...
  const diff = (day - 2 + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

function splitCurrentArchive(list) {
  const boundary = mostRecentTuesday();
  const current = [], archived = [];
  list.forEach((doc) => {
    const t = doc.uploadedAt && doc.uploadedAt.toDate ? doc.uploadedAt.toDate() : null;
    if (t && t < boundary) archived.push(doc); else current.push(doc);
  });
  return { current, archived };
}

function applyDateFilter(list, fromV, toV, fieldName) {
  if (!fromV && !toV) return list;
  return list.filter((doc) => {
    const val = doc[fieldName];
    if (!val) return false;
    if (fromV && val < fromV) return false;
    if (toV && val > toV) return false;
    return true;
  });
}

// сжимаем фото на телефоне перед отправкой — экономит трафик в Досатуе
function resizeImage(file, maxDim = 1600, quality = 0.8) {
  return new Promise((resolve) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target.result; };
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
        else { width = Math.round(width * maxDim / height); height = maxDim; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
    };
    reader.readAsDataURL(file);
  });
}

function uploadToCloudinary(blob) {
  const fd = new FormData();
  fd.append("file", blob);
  fd.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  return fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: "POST", body: fd,
  }).then((r) => r.json()).then((data) => {
    if (!data.secure_url) throw new Error(data.error?.message || "Ошибка загрузки фото");
    return data.secure_url;
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ============================================================
// ГЛАВНЫЙ РЕНДЕР — переключатель режимов
// ============================================================
function renderDocuments() {
  app.innerHTML = "";
  subscribeDocs();
  subscribeMaintenance();
  const wrap = el("div", "space-y-3");

  const modeRow = el("div", "flex gap-2");
  const btnTtn = el("button", `flex-1 py-2.5 rounded-xl text-sm font-semibold ${docsMode === "ttn" ? "bg-diesel text-white" : "bg-white text-slate-500"}`, "📄 ТТН");
  const btnMaint = el("button", `flex-1 py-2.5 rounded-xl text-sm font-semibold ${docsMode === "maintenance" ? "bg-diesel text-white" : "bg-white text-slate-500"}`, "🔧 ТО / Ремонт");
  btnTtn.onclick = () => { docsMode = "ttn"; render(); };
  btnMaint.onclick = () => { docsMode = "maintenance"; render(); };
  modeRow.appendChild(btnTtn);
  modeRow.appendChild(btnMaint);
  wrap.appendChild(modeRow);

  if (docsMode === "ttn") renderTtnSection(wrap);
  else renderMaintenanceSection(wrap);

  app.appendChild(wrap);
}

// ============================================================
// РЕЖИМ: ТТН
// ============================================================
function renderTtnSection(wrap) {
  const addBtn = el("button", "w-full py-3 rounded-xl bg-diesel text-white font-semibold shadow-sm flex items-center justify-center gap-2", "➕ Добавить ТТН / путевой лист");
  addBtn.onclick = () => { addFormOpen = true; selectedFiles = []; render(); };
  wrap.appendChild(addBtn);

  if (addFormOpen) wrap.appendChild(renderAddForm());

  const { current, archived } = splitCurrentArchive(docsCache);

  const toggleRow = el("div", "flex gap-2");
  const btnCurrent = el("button", `flex-1 py-2 rounded-xl text-sm font-semibold ${!docsShowArchive ? "bg-diesel text-white" : "bg-white text-slate-500"}`, `Текущие (${current.length})`);
  const btnArchive = el("button", `flex-1 py-2 rounded-xl text-sm font-semibold ${docsShowArchive ? "bg-diesel text-white" : "bg-white text-slate-500"}`, `📦 Архив (${archived.length})`);
  btnCurrent.onclick = () => { docsShowArchive = false; render(); };
  btnArchive.onclick = () => { docsShowArchive = true; render(); };
  toggleRow.appendChild(btnCurrent);
  toggleRow.appendChild(btnArchive);
  wrap.appendChild(toggleRow);

  const filterCard = el("div", "bg-white rounded-xl border border-slate-200 p-3 flex items-end gap-2");
  filterCard.innerHTML = `
    <label class="text-xs text-slate-500 flex-1">С даты
      <input id="doc-filter-from" type="date" value="${docsFilterFrom}" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
    </label>
    <label class="text-xs text-slate-500 flex-1">По дату
      <input id="doc-filter-to" type="date" value="${docsFilterTo}" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
    </label>`;
  const clearBtn = el("button", "text-xs text-slate-400 underline shrink-0 pb-1.5", "Сбросить");
  clearBtn.onclick = () => { docsFilterFrom = ""; docsFilterTo = ""; render(); };
  filterCard.appendChild(clearBtn);
  wrap.appendChild(filterCard);
  setTimeout(() => {
    const fFrom = document.getElementById("doc-filter-from");
    const fTo = document.getElementById("doc-filter-to");
    if (fFrom) fFrom.onchange = () => { docsFilterFrom = fFrom.value; render(); };
    if (fTo) fTo.onchange = () => { docsFilterTo = fTo.value; render(); };
  }, 0);

  const baseList = docsShowArchive ? archived : current;
  const shownList = applyDateFilter(baseList, docsFilterFrom, docsFilterTo, "ttnDate");

  if (!shownList.length) {
    wrap.appendChild(el("div", "text-center text-slate-400 text-sm py-8",
      docsCache.length ? "Ничего не найдено по этим фильтрам" : "Пока нет загруженных документов"));
  }

  shownList.forEach((doc) => {
    const photos = doc.photoUrls || (doc.photoUrl ? [doc.photoUrl] : []);
    const card = el("div", "bg-white rounded-xl border border-slate-200 overflow-hidden flex gap-3 p-3");

    const thumbWrap = el("div", "relative shrink-0 cursor-pointer");
    const thumb = el("img", "w-20 h-20 object-cover rounded-xl");
    thumb.src = photos[0] || "";
    thumbWrap.appendChild(thumb);
    if (photos.length > 1) {
      const badge = el("div", "absolute -bottom-1 -right-1 bg-diesel text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center", "+" + (photos.length - 1));
      thumbWrap.appendChild(badge);
    }
    thumbWrap.onclick = () => openLightbox(photos);
    card.appendChild(thumbWrap);

    const info = el("div", "flex-1 text-sm min-w-0");
    info.innerHTML = `
      <div class="font-bold text-slate-800">ТТН № ${escapeHtml(doc.ttnNumber)}</div>
      <div class="text-slate-500 text-xs">${doc.ttnDate ? fmtRU(parseISO(doc.ttnDate)) : ""}</div>
      <div class="text-slate-600 text-xs mt-1">🚛 ${escapeHtml(doc.truck || "—")}</div>
      <div class="text-slate-600 text-xs">👤 ${escapeHtml(doc.driverName || "—")}</div>
      <div class="text-slate-600 text-xs">⚖️ ${doc.weight ? doc.weight + " т" : "—"}</div>
      <div class="text-shift text-xs font-semibold font-num">💰 6 000 ₽</div>
      <div class="text-slate-300 text-[10px] mt-1">добавил(а): ${escapeHtml(doc.uploadedByName || "")}</div>`;
    card.appendChild(info);

    const canDelete = currentUser && (doc.uploadedByUid === currentUser.uid || currentProfile?.role === "manager");
    if (canDelete) {
      const del = el("button", "text-slate-300 hover:text-rose-500 shrink-0 self-start", "✕");
      del.onclick = () => {
        if (confirm("Удалить эту запись?")) db.collection("ttnDocs").doc(doc.id).delete();
      };
      card.appendChild(del);
    }

    wrap.appendChild(card);
  });
}

function renderAddForm() {
  const card = el("div", "bg-white rounded-xl border border-slate-200 p-4 space-y-3");
  card.innerHTML = `
    <div class="font-bold text-slate-700">Новая запись — ТТН</div>
    <label class="block text-xs text-slate-500">Номер ТТН
      <input id="df-ttn" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" placeholder="напр. 000123" />
    </label>
    <label class="block text-xs text-slate-500">Дата ТТН
      <input id="df-date" type="date" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
    </label>
    <label class="block text-xs text-slate-500">Номер машины
      <select id="df-truck" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white">
        ${STATE.trucks.map((t) => `<option value="${t}">${t}</option>`).join("")}
      </select>
    </label>
    <label class="block text-xs text-slate-500">ФИО водителя
      <select id="df-driver-select" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white"></select>
      <input id="df-driver-other" placeholder="Впиши ФИО" class="mt-2 hidden w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
    </label>
    <label class="block text-xs text-slate-500">Вес груза, т
      <input id="df-weight" type="number" min="0" step="0.01" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" placeholder="напр. 34.56" />
    </label>
    <div class="text-xs text-slate-400">1 ТТН = 1 смена = 6 000 ₽. Если за день два рейса — просто добавь вторую запись тем же числом.</div>
    <div>
      <div class="flex items-center justify-between mb-1">
        <div class="text-xs text-slate-500">Фото (путевой лист + ТТН с двух сторон)</div>
        <div id="df-photo-count" class="text-xs text-slate-400 font-medium">0 / ${MAX_PHOTOS}</div>
      </div>
      <div class="flex gap-2">
        <button type="button" id="df-btn-camera" class="flex-1 py-2.5 rounded-lg bg-diesel-700 text-white text-sm font-semibold flex items-center justify-center gap-1.5">📷 Камера</button>
        <button type="button" id="df-btn-gallery" class="flex-1 py-2.5 rounded-lg bg-slate-100 text-slate-600 text-sm font-semibold flex items-center justify-center gap-1.5">🖼️ Галерея</button>
      </div>
      <input id="df-photo-camera" type="file" accept="image/*" capture="environment" class="hidden" />
      <input id="df-photo-gallery" type="file" accept="image/*" multiple class="hidden" />
      <div id="df-thumbs" class="grid grid-cols-3 gap-2 mt-2"></div>
    </div>
    <div id="df-error" class="text-xs text-rose-600 hidden"></div>
    <div class="flex gap-2 pt-1">
      <button id="df-save" class="flex-1 py-2.5 rounded-lg bg-diesel text-white font-semibold text-sm">Сохранить</button>
      <button id="df-cancel" class="px-4 py-2.5 rounded-lg bg-slate-100 text-slate-500 font-semibold text-sm">Отмена</button>
    </div>`;

  const driverNames = [...new Set(STATE.drivers.map((d) => d.name).filter(Boolean))];
  const driverSelect = card.querySelector("#df-driver-select");
  const otherInput = card.querySelector("#df-driver-other");
  driverSelect.innerHTML =
    `<option value="">Выбери водителя</option>` +
    driverNames.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("") +
    `<option value="__other__">Другой (вписать ФИО)</option>`;
  const preselect = currentProfile?.role === "driver" &&
    driverNames.find((n) => n.toLowerCase() === currentProfile.name.toLowerCase());
  if (preselect) driverSelect.value = preselect;
  driverSelect.onchange = () => {
    otherInput.classList.toggle("hidden", driverSelect.value !== "__other__");
  };

  const camInput = card.querySelector("#df-photo-camera");
  const galInput = card.querySelector("#df-photo-gallery");
  const btnCam = card.querySelector("#df-btn-camera");
  const btnGal = card.querySelector("#df-btn-gallery");
  const countLabel = card.querySelector("#df-photo-count");
  const thumbsWrap = card.querySelector("#df-thumbs");

  function renderThumbs() {
    countLabel.textContent = `${selectedFiles.length} / ${MAX_PHOTOS}`;
    const atLimit = selectedFiles.length >= MAX_PHOTOS;
    btnCam.disabled = atLimit;
    btnGal.disabled = atLimit;
    btnCam.classList.toggle("opacity-40", atLimit);
    btnGal.classList.toggle("opacity-40", atLimit);

    thumbsWrap.innerHTML = "";
    selectedFiles.forEach((file, idx) => {
      const box = el("div", "relative");
      const img = el("img", "w-full h-20 object-cover rounded-lg bg-slate-50");
      const reader = new FileReader();
      reader.onload = (ev) => { img.src = ev.target.result; };
      reader.readAsDataURL(file);
      box.appendChild(img);
      const rm = el("button", "absolute -top-1.5 -right-1.5 bg-diesel text-white rounded-full w-5 h-5 text-xs flex items-center justify-center", "✕");
      rm.type = "button";
      rm.onclick = () => { selectedFiles.splice(idx, 1); renderThumbs(); };
      box.appendChild(rm);
      thumbsWrap.appendChild(box);
    });
  }

  function addFiles(fileList) {
    for (const f of fileList) {
      if (selectedFiles.length >= MAX_PHOTOS) break;
      selectedFiles.push(f);
    }
    renderThumbs();
  }

  btnCam.onclick = () => { if (selectedFiles.length < MAX_PHOTOS) camInput.click(); };
  btnGal.onclick = () => { if (selectedFiles.length < MAX_PHOTOS) galInput.click(); };
  camInput.onchange = (e) => { addFiles(e.target.files); camInput.value = ""; };
  galInput.onchange = (e) => { addFiles(e.target.files); galInput.value = ""; };

  renderThumbs();

  card.querySelector("#df-cancel").onclick = () => { addFormOpen = false; selectedFiles = []; render(); };

  card.querySelector("#df-save").onclick = async () => {
    const ttnNumber = card.querySelector("#df-ttn").value.trim();
    const ttnDate = card.querySelector("#df-date").value;
    const truck = card.querySelector("#df-truck").value;
    const driverName = driverSelect.value === "__other__"
      ? otherInput.value.trim()
      : driverSelect.value;
    const weight = card.querySelector("#df-weight").value;
    const errBox = card.querySelector("#df-error");
    const saveBtn = card.querySelector("#df-save");

    if (!ttnNumber || !ttnDate || !driverName || !selectedFiles.length) {
      errBox.textContent = "Заполни номер ТТН, дату, водителя и прикрепи хотя бы одно фото.";
      errBox.classList.remove("hidden");
      return;
    }
    errBox.classList.add("hidden");
    saveBtn.disabled = true;

    try {
      const urls = [];
      for (let i = 0; i < selectedFiles.length; i++) {
        saveBtn.textContent = `Загружаю фото ${i + 1}/${selectedFiles.length}…`;
        const resized = await resizeImage(selectedFiles[i]);
        const url = await uploadToCloudinary(resized);
        urls.push(url);
      }
      await db.collection("ttnDocs").add({
        ttnNumber, ttnDate, truck, driverName,
        weight: weight ? Number(weight) : null,
        photoUrls: urls,
        uploadedByUid: currentUser.uid,
        uploadedByName: currentProfile.name,
        uploadedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      addFormOpen = false;
      selectedFiles = [];
      render();
    } catch (e) {
      errBox.textContent = "Не получилось сохранить: " + e.message;
      errBox.classList.remove("hidden");
      saveBtn.disabled = false;
      saveBtn.textContent = "Сохранить";
    }
  };

  return card;
}

// ============================================================
// РЕЖИМ: ТО / Ремонт
// ============================================================
function renderMaintenanceSection(wrap) {
  const addBtn = el("button", "w-full py-3 rounded-xl bg-diesel-700 text-white font-semibold shadow-sm flex items-center justify-center gap-2", "➕ Добавить ТО / ремонт");
  addBtn.onclick = () => { maintFormOpen = true; maintSelectedFiles = []; render(); };
  wrap.appendChild(addBtn);

  if (maintFormOpen) wrap.appendChild(renderMaintenanceAddForm());

  const { current, archived } = splitCurrentArchive(maintenanceCache);

  const toggleRow = el("div", "flex gap-2");
  const btnCurrent = el("button", `flex-1 py-2 rounded-xl text-sm font-semibold ${!maintShowArchive ? "bg-diesel text-white" : "bg-white text-slate-500"}`, `Текущие (${current.length})`);
  const btnArchive = el("button", `flex-1 py-2 rounded-xl text-sm font-semibold ${maintShowArchive ? "bg-diesel text-white" : "bg-white text-slate-500"}`, `📦 Архив (${archived.length})`);
  btnCurrent.onclick = () => { maintShowArchive = false; render(); };
  btnArchive.onclick = () => { maintShowArchive = true; render(); };
  toggleRow.appendChild(btnCurrent);
  toggleRow.appendChild(btnArchive);
  wrap.appendChild(toggleRow);

  const filterCard = el("div", "bg-white rounded-xl border border-slate-200 p-3 flex items-end gap-2");
  filterCard.innerHTML = `
    <label class="text-xs text-slate-500 flex-1">С даты
      <input id="maint-filter-from" type="date" value="${maintFilterFrom}" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
    </label>
    <label class="text-xs text-slate-500 flex-1">По дату
      <input id="maint-filter-to" type="date" value="${maintFilterTo}" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
    </label>`;
  const clearBtn = el("button", "text-xs text-slate-400 underline shrink-0 pb-1.5", "Сбросить");
  clearBtn.onclick = () => { maintFilterFrom = ""; maintFilterTo = ""; render(); };
  filterCard.appendChild(clearBtn);
  wrap.appendChild(filterCard);
  setTimeout(() => {
    const fFrom = document.getElementById("maint-filter-from");
    const fTo = document.getElementById("maint-filter-to");
    if (fFrom) fFrom.onchange = () => { maintFilterFrom = fFrom.value; render(); };
    if (fTo) fTo.onchange = () => { maintFilterTo = fTo.value; render(); };
  }, 0);

  const baseList = maintShowArchive ? archived : current;
  const shownList = applyDateFilter(baseList, maintFilterFrom, maintFilterTo, "date");

  if (!shownList.length) {
    wrap.appendChild(el("div", "text-center text-slate-400 text-sm py-8",
      maintenanceCache.length ? "Ничего не найдено по этим фильтрам" : "Пока нет записей о ТО и ремонте"));
  }

  shownList.forEach((doc) => {
    const photos = doc.photoUrls || [];
    const card = el("div", "bg-white rounded-xl border border-slate-200 overflow-hidden flex gap-3 p-3");

    const thumbWrap = el("div", "relative shrink-0 cursor-pointer");
    if (photos.length) {
      const thumb = el("img", "w-20 h-20 object-cover rounded-xl");
      thumb.src = photos[0];
      thumbWrap.appendChild(thumb);
      if (photos.length > 1) {
        const badge = el("div", "absolute -bottom-1 -right-1 bg-diesel text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center", "+" + (photos.length - 1));
        thumbWrap.appendChild(badge);
      }
      thumbWrap.onclick = () => openLightbox(photos);
    } else {
      thumbWrap.className += " w-20 h-20 bg-slate-100 rounded-xl flex items-center justify-center text-2xl";
      thumbWrap.textContent = "🔧";
    }
    card.appendChild(thumbWrap);

    const workers = [doc.primaryWorker, doc.secondaryWorker].filter(Boolean);
    const share = workers.length === 2 ? 3000 : 6000;
    const info = el("div", "flex-1 text-sm min-w-0");
    info.innerHTML = `
      <div class="font-bold text-slate-800">${doc.type === "Ремонт" ? "🔧 Ремонт" : "🛠️ ТО"}</div>
      <div class="text-slate-500 text-xs">${doc.date ? fmtRU(parseISO(doc.date)) : ""}</div>
      <div class="text-slate-600 text-xs mt-1">🚛 ${escapeHtml(doc.truck || "—")}</div>
      <div class="text-slate-600 text-xs">👤 ${escapeHtml(workers.join(" + ") || "—")}</div>
      ${doc.note ? `<div class="text-slate-500 text-xs mt-0.5">📝 ${escapeHtml(doc.note)}</div>` : ""}
      <div class="text-shift text-xs font-semibold font-num">💰 ${share.toLocaleString("ru-RU")} ₽ ${workers.length === 2 ? "каждому" : ""}</div>
      <div class="text-slate-300 text-[10px] mt-1">добавил(а): ${escapeHtml(doc.uploadedByName || "")}</div>`;
    card.appendChild(info);

    const canDelete = currentUser && (doc.uploadedByUid === currentUser.uid || currentProfile?.role === "manager");
    if (canDelete) {
      const del = el("button", "text-slate-300 hover:text-rose-500 shrink-0 self-start", "✕");
      del.onclick = () => {
        if (confirm("Удалить эту запись?")) db.collection("maintenanceDocs").doc(doc.id).delete();
      };
      card.appendChild(del);
    }

    wrap.appendChild(card);
  });
}

function renderMaintenanceAddForm() {
  const card = el("div", "bg-white rounded-xl border border-slate-200 p-4 space-y-3");
  const driverNames = [...new Set(STATE.drivers.map((d) => d.name).filter(Boolean))];
  card.innerHTML = `
    <div class="font-bold text-slate-700">Новая запись — ТО / ремонт</div>
    <label class="block text-xs text-slate-500">Дата
      <input id="mf-date" type="date" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
    </label>
    <label class="block text-xs text-slate-500">Машина
      <select id="mf-truck" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white">
        ${STATE.trucks.map((t) => `<option value="${t}">${t}</option>`).join("")}
      </select>
    </label>
    <label class="block text-xs text-slate-500">Что делали
      <select id="mf-type" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white">
        <option value="ТО">ТО (техобслуживание)</option>
        <option value="Ремонт">Ремонт</option>
      </select>
    </label>
    <label class="block text-xs text-slate-500">Кто делал (основной)
      <select id="mf-worker1" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white">
        <option value="">Выбери водителя</option>
        ${driverNames.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("")}
      </select>
    </label>
    <label class="block text-xs text-slate-500">Напарник (если делали вдвоём)
      <select id="mf-worker2" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white">
        <option value="">Нет — делал один</option>
        ${driverNames.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("")}
      </select>
    </label>
    <div id="mf-pay-hint" class="text-xs text-slate-400">Один человек — 6 000 ₽ ему. Двое — по 3 000 ₽ каждому.</div>
    <label class="block text-xs text-slate-500">Что сделали (необязательно)
      <textarea id="mf-note" rows="2" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm resize-none" placeholder="напр. замена тормозных колодок"></textarea>
    </label>
    <div>
      <div class="flex items-center justify-between mb-1">
        <div class="text-xs text-slate-500">Фото (что именно делали)</div>
        <div id="mf-photo-count" class="text-xs text-slate-400 font-medium">0 / ${MAX_PHOTOS}</div>
      </div>
      <div class="flex gap-2">
        <button type="button" id="mf-btn-camera" class="flex-1 py-2.5 rounded-lg bg-diesel-700 text-white text-sm font-semibold flex items-center justify-center gap-1.5">📷 Камера</button>
        <button type="button" id="mf-btn-gallery" class="flex-1 py-2.5 rounded-lg bg-slate-100 text-slate-600 text-sm font-semibold flex items-center justify-center gap-1.5">🖼️ Галерея</button>
      </div>
      <input id="mf-photo-camera" type="file" accept="image/*" capture="environment" class="hidden" />
      <input id="mf-photo-gallery" type="file" accept="image/*" multiple class="hidden" />
      <div id="mf-thumbs" class="grid grid-cols-3 gap-2 mt-2"></div>
    </div>
    <div id="mf-error" class="text-xs text-rose-600 hidden"></div>
    <div class="flex gap-2 pt-1">
      <button id="mf-save" class="flex-1 py-2.5 rounded-lg bg-diesel text-white font-semibold text-sm">Сохранить</button>
      <button id="mf-cancel" class="px-4 py-2.5 rounded-lg bg-slate-100 text-slate-500 font-semibold text-sm">Отмена</button>
    </div>`;

  const worker1 = card.querySelector("#mf-worker1");
  const worker2 = card.querySelector("#mf-worker2");
  if (currentProfile?.role === "driver") {
    const own = driverNames.find((n) => n.toLowerCase() === currentProfile.name.toLowerCase());
    if (own) worker1.value = own;
  }

  const camInput = card.querySelector("#mf-photo-camera");
  const galInput = card.querySelector("#mf-photo-gallery");
  const btnCam = card.querySelector("#mf-btn-camera");
  const btnGal = card.querySelector("#mf-btn-gallery");
  const countLabel = card.querySelector("#mf-photo-count");
  const thumbsWrap = card.querySelector("#mf-thumbs");

  function renderThumbs() {
    countLabel.textContent = `${maintSelectedFiles.length} / ${MAX_PHOTOS}`;
    const atLimit = maintSelectedFiles.length >= MAX_PHOTOS;
    btnCam.disabled = atLimit;
    btnGal.disabled = atLimit;
    btnCam.classList.toggle("opacity-40", atLimit);
    btnGal.classList.toggle("opacity-40", atLimit);

    thumbsWrap.innerHTML = "";
    maintSelectedFiles.forEach((file, idx) => {
      const box = el("div", "relative");
      const img = el("img", "w-full h-20 object-cover rounded-lg bg-slate-50");
      const reader = new FileReader();
      reader.onload = (ev) => { img.src = ev.target.result; };
      reader.readAsDataURL(file);
      box.appendChild(img);
      const rm = el("button", "absolute -top-1.5 -right-1.5 bg-diesel text-white rounded-full w-5 h-5 text-xs flex items-center justify-center", "✕");
      rm.type = "button";
      rm.onclick = () => { maintSelectedFiles.splice(idx, 1); renderThumbs(); };
      box.appendChild(rm);
      thumbsWrap.appendChild(box);
    });
  }

  function addFiles(fileList) {
    for (const f of fileList) {
      if (maintSelectedFiles.length >= MAX_PHOTOS) break;
      maintSelectedFiles.push(f);
    }
    renderThumbs();
  }

  btnCam.onclick = () => { if (maintSelectedFiles.length < MAX_PHOTOS) camInput.click(); };
  btnGal.onclick = () => { if (maintSelectedFiles.length < MAX_PHOTOS) galInput.click(); };
  camInput.onchange = (e) => { addFiles(e.target.files); camInput.value = ""; };
  galInput.onchange = (e) => { addFiles(e.target.files); galInput.value = ""; };

  renderThumbs();

  card.querySelector("#mf-cancel").onclick = () => { maintFormOpen = false; maintSelectedFiles = []; render(); };

  card.querySelector("#mf-save").onclick = async () => {
    const date = card.querySelector("#mf-date").value;
    const truck = card.querySelector("#mf-truck").value;
    const type = card.querySelector("#mf-type").value;
    const primaryWorker = worker1.value;
    const secondaryWorker = worker2.value === primaryWorker ? "" : worker2.value;
    const note = card.querySelector("#mf-note").value.trim();
    const errBox = card.querySelector("#mf-error");
    const saveBtn = card.querySelector("#mf-save");

    if (!date || !primaryWorker) {
      errBox.textContent = "Заполни дату и хотя бы одного исполнителя.";
      errBox.classList.remove("hidden");
      return;
    }
    errBox.classList.add("hidden");
    saveBtn.disabled = true;

    try {
      const urls = [];
      for (let i = 0; i < maintSelectedFiles.length; i++) {
        saveBtn.textContent = `Загружаю фото ${i + 1}/${maintSelectedFiles.length}…`;
        const resized = await resizeImage(maintSelectedFiles[i]);
        const url = await uploadToCloudinary(resized);
        urls.push(url);
      }
      await db.collection("maintenanceDocs").add({
        date, truck, type, primaryWorker, secondaryWorker, note,
        photoUrls: urls,
        uploadedByUid: currentUser.uid,
        uploadedByName: currentProfile.name,
        uploadedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      maintFormOpen = false;
      maintSelectedFiles = [];
      render();
    } catch (e) {
      errBox.textContent = "Не получилось сохранить: " + e.message;
      errBox.classList.remove("hidden");
      saveBtn.disabled = false;
      saveBtn.textContent = "Сохранить";
    }
  };

  return card;
}

// ============================================================
// СКАЧАТЬ / ОТПРАВИТЬ ФОТО (общее для ТТН и ТО/Ремонт)
// ============================================================
async function fetchAsFile(url, filename) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("Не удалось загрузить фото");
  const blob = await resp.blob();
  return new File([blob], filename, { type: blob.type || "image/jpeg" });
}

async function downloadPhoto(url, btn) {
  const oldText = btn ? btn.textContent : "";
  try {
    if (btn) btn.textContent = "…";
    const file = await fetchAsFile(url, "foto-" + Date.now() + ".jpg");
    const blobUrl = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 8000);
  } catch (e) {
    alert("Не удалось скачать фото: " + e.message);
  } finally {
    if (btn) btn.textContent = oldText;
  }
}

async function sharePhoto(url, btn) {
  const oldText = btn ? btn.textContent : "";
  try {
    if (btn) btn.textContent = "…";
    const file = await fetchAsFile(url, "foto-" + Date.now() + ".jpg");
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file] });
    } else if (navigator.share) {
      await navigator.share({ url });
    } else {
      window.open(url, "_blank");
    }
  } catch (e) {
    if (e.name !== "AbortError") alert("Не удалось отправить фото: " + e.message);
  } finally {
    if (btn) btn.textContent = oldText;
  }
}

async function downloadAllPhotos(urls, btn) {
  const oldText = btn ? btn.textContent : "";
  try {
    for (let i = 0; i < urls.length; i++) {
      if (btn) btn.textContent = `Скачиваю ${i + 1}/${urls.length}…`;
      const file = await fetchAsFile(urls[i], `foto-${Date.now()}-${i + 1}.jpg`);
      const blobUrl = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 8000);
      if (i < urls.length - 1) await new Promise((r) => setTimeout(r, 400));
    }
  } catch (e) {
    alert("Не удалось скачать фото: " + e.message);
  } finally {
    if (btn) btn.textContent = oldText;
  }
}

async function shareAllPhotos(urls, btn) {
  const oldText = btn ? btn.textContent : "";
  try {
    if (btn) btn.textContent = "…";
    const files = [];
    for (let i = 0; i < urls.length; i++) {
      files.push(await fetchAsFile(urls[i], `foto-${Date.now()}-${i + 1}.jpg`));
    }
    if (navigator.canShare && navigator.canShare({ files })) {
      await navigator.share({ files });
    } else if (navigator.share) {
      await navigator.share({ url: urls[0] });
    } else {
      urls.forEach((u) => window.open(u, "_blank"));
    }
  } catch (e) {
    if (e.name !== "AbortError") alert("Не удалось отправить фото: " + e.message);
  } finally {
    if (btn) btn.textContent = oldText;
  }
}

function openLightbox(urls) {
  const list = Array.isArray(urls) ? urls : [urls];
  let idx = 0;

  const overlay = el("div", "fixed inset-0 bg-black/90 z-50 flex flex-col items-center justify-center p-4 touch-none");
  const imgWrap = el("div", "flex-1 flex items-center justify-center w-full min-h-0");
  const img = el("img", "max-w-full max-h-full rounded-lg select-none pointer-events-none");
  imgWrap.appendChild(img);
  overlay.appendChild(imgWrap);

  function show() { img.src = list[idx]; }
  show();

  function goPrev() { idx = (idx - 1 + list.length) % list.length; show(); updateCounter(); }
  function goNext() { idx = (idx + 1) % list.length; show(); updateCounter(); }

  overlay.onclick = (e) => { if (e.target === overlay || e.target === imgWrap) overlay.remove(); };

  let touchStartX = null;
  let touchStartY = null;
  overlay.addEventListener("touchstart", (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  overlay.addEventListener("touchend", (e) => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    touchStartX = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) && list.length > 1) {
      if (dx < 0) goNext(); else goPrev();
    }
  }, { passive: true });

  let updateCounter = () => {};
  if (list.length > 1) {
    const counter = el("div", "absolute top-4 left-1/2 -translate-x-1/2 text-white text-sm bg-black/50 px-3 py-1 rounded-full");
    updateCounter = () => { counter.textContent = `${idx + 1} / ${list.length}`; };
    updateCounter();
    overlay.appendChild(counter);

    const prev = el("button", "absolute left-2 top-1/2 -translate-y-1/2 text-white text-3xl w-12 h-12 flex items-center justify-center", "‹");
    prev.onclick = (e) => { e.stopPropagation(); goPrev(); };
    overlay.appendChild(prev);

    const next = el("button", "absolute right-2 top-1/2 -translate-y-1/2 text-white text-3xl w-12 h-12 flex items-center justify-center", "›");
    next.onclick = (e) => { e.stopPropagation(); goNext(); };
    overlay.appendChild(next);
  }

  const toolbar = el("div", "flex flex-col items-center gap-2 pt-4 shrink-0");

  const row1 = el("div", "flex gap-3");
  const dlBtn = el("button", "px-4 py-2.5 rounded-full bg-white/15 text-white text-sm font-semibold flex items-center gap-1.5", list.length > 1 ? "⬇️ Это фото" : "⬇️ Скачать");
  dlBtn.onclick = (e) => { e.stopPropagation(); downloadPhoto(list[idx], dlBtn); };
  const shareBtn = el("button", "px-4 py-2.5 rounded-full bg-white/15 text-white text-sm font-semibold flex items-center gap-1.5", list.length > 1 ? "📤 Это фото" : "📤 Отправить");
  shareBtn.onclick = (e) => { e.stopPropagation(); sharePhoto(list[idx], shareBtn); };
  row1.appendChild(dlBtn);
  row1.appendChild(shareBtn);
  toolbar.appendChild(row1);

  if (list.length > 1) {
    const row2 = el("div", "flex gap-3");
    const dlAllBtn = el("button", "px-4 py-2.5 rounded-full bg-shift text-white text-sm font-semibold flex items-center gap-1.5", `⬇️ Все (${list.length})`);
    dlAllBtn.onclick = (e) => { e.stopPropagation(); downloadAllPhotos(list, dlAllBtn); };
    const shareAllBtn = el("button", "px-4 py-2.5 rounded-full bg-shift text-white text-sm font-semibold flex items-center gap-1.5", `📤 Все (${list.length})`);
    shareAllBtn.onclick = (e) => { e.stopPropagation(); shareAllPhotos(list, shareAllBtn); };
    row2.appendChild(dlAllBtn);
    row2.appendChild(shareAllBtn);
    toolbar.appendChild(row2);
  }

  overlay.appendChild(toolbar);

  document.body.appendChild(overlay);
}
