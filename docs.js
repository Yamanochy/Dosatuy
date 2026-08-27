// ============================================================
// ДОКУМЕНТЫ — фото ТТН и путевых листов
// ============================================================

const MAX_PHOTOS = 3;

let docsCache = [];
let docsUnsub = null;
let addFormOpen = false;
let selectedFiles = []; // массив File, до MAX_PHOTOS

function subscribeDocs() {
  if (docsUnsub) return;
  docsUnsub = db.collection("ttnDocs").orderBy("uploadedAt", "desc")
    .onSnapshot((snap) => {
      docsCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (currentTab === "documents") render();
    }, (err) => {
      console.error(err);
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

function renderDocuments() {
  app.innerHTML = "";
  subscribeDocs();
  const wrap = el("div", "space-y-3");

  const addBtn = el("button", "w-full py-3 rounded-xl bg-slate-800 text-white font-semibold shadow-sm flex items-center justify-center gap-2", "➕ Добавить ТТН / путевой лист");
  addBtn.onclick = () => { addFormOpen = true; selectedFiles = []; render(); };
  wrap.appendChild(addBtn);

  if (addFormOpen) wrap.appendChild(renderAddForm());

  if (!docsCache.length) {
    wrap.appendChild(el("div", "text-center text-slate-400 text-sm py-8", "Пока нет загруженных документов"));
  }

  docsCache.forEach((doc) => {
    const photos = doc.photoUrls || (doc.photoUrl ? [doc.photoUrl] : []);
    const card = el("div", "bg-white rounded-2xl shadow-sm overflow-hidden flex gap-3 p-3");

    const thumbWrap = el("div", "relative shrink-0 cursor-pointer");
    const thumb = el("img", "w-20 h-20 object-cover rounded-xl");
    thumb.src = photos[0] || "";
    thumbWrap.appendChild(thumb);
    if (photos.length > 1) {
      const badge = el("div", "absolute -bottom-1 -right-1 bg-slate-800 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center", "+" + (photos.length - 1));
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
      <div class="text-slate-600 text-xs">⚖️ ${doc.weight ? doc.weight + " кг" : "—"}</div>
      <div class="text-slate-300 text-[10px] mt-1">добавил(а): ${escapeHtml(doc.uploadedByName || "")}</div>`;
    card.appendChild(info);

    if (currentUser && doc.uploadedByUid === currentUser.uid) {
      const del = el("button", "text-slate-300 hover:text-rose-500 shrink-0 self-start", "✕");
      del.onclick = () => {
        if (confirm("Удалить эту запись?")) db.collection("ttnDocs").doc(doc.id).delete();
      };
      card.appendChild(del);
    }

    wrap.appendChild(card);
  });

  app.appendChild(wrap);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderAddForm() {
  const card = el("div", "bg-white rounded-2xl shadow-sm p-4 space-y-3");
  card.innerHTML = `
    <div class="font-bold text-slate-700">Новая запись</div>
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
    <label class="block text-xs text-slate-500">Вес груза, кг
      <input id="df-weight" type="number" min="0" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" placeholder="напр. 18500" />
    </label>
    <div>
      <div class="flex items-center justify-between mb-1">
        <div class="text-xs text-slate-500">Фото (путевой лист + ТТН с двух сторон)</div>
        <div id="df-photo-count" class="text-xs text-slate-400 font-medium">0 / ${MAX_PHOTOS}</div>
      </div>
      <div class="flex gap-2">
        <button type="button" id="df-btn-camera" class="flex-1 py-2.5 rounded-lg bg-slate-700 text-white text-sm font-semibold flex items-center justify-center gap-1.5">📷 Камера</button>
        <button type="button" id="df-btn-gallery" class="flex-1 py-2.5 rounded-lg bg-slate-100 text-slate-600 text-sm font-semibold flex items-center justify-center gap-1.5">🖼️ Галерея</button>
      </div>
      <input id="df-photo-camera" type="file" accept="image/*" capture="environment" class="hidden" />
      <input id="df-photo-gallery" type="file" accept="image/*" class="hidden" />
      <div id="df-thumbs" class="grid grid-cols-3 gap-2 mt-2"></div>
    </div>
    <div id="df-error" class="text-xs text-rose-600 hidden"></div>
    <div class="flex gap-2 pt-1">
      <button id="df-save" class="flex-1 py-2.5 rounded-lg bg-slate-800 text-white font-semibold text-sm">Сохранить</button>
      <button id="df-cancel" class="px-4 py-2.5 rounded-lg bg-slate-100 text-slate-500 font-semibold text-sm">Отмена</button>
    </div>`;

  // список водителей — из графика вахт + опция "другой"
  const driverNames = [...new Set(STATE.drivers.map((d) => d.name))];
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
      const rm = el("button", "absolute -top-1.5 -right-1.5 bg-slate-800 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center", "✕");
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

function openLightbox(urls) {
  const list = Array.isArray(urls) ? urls : [urls];
  let idx = 0;

  const overlay = el("div", "fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4");
  const img = el("img", "max-w-full max-h-full rounded-lg");
  overlay.appendChild(img);

  function show() { img.src = list[idx]; }
  show();

  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  if (list.length > 1) {
    const counter = el("div", "absolute top-4 left-1/2 -translate-x-1/2 text-white text-sm bg-black/50 px-3 py-1 rounded-full");
    const updateCounter = () => { counter.textContent = `${idx + 1} / ${list.length}`; };
    updateCounter();
    overlay.appendChild(counter);

    const prev = el("button", "absolute left-2 top-1/2 -translate-y-1/2 text-white text-3xl w-12 h-12 flex items-center justify-center", "‹");
    prev.onclick = (e) => { e.stopPropagation(); idx = (idx - 1 + list.length) % list.length; show(); updateCounter(); };
    overlay.appendChild(prev);

    const next = el("button", "absolute right-2 top-1/2 -translate-y-1/2 text-white text-3xl w-12 h-12 flex items-center justify-center", "›");
    next.onclick = (e) => { e.stopPropagation(); idx = (idx + 1) % list.length; show(); updateCounter(); };
    overlay.appendChild(next);
  }

  document.body.appendChild(overlay);
}
