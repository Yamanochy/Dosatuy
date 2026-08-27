// ============================================================
// ДОКУМЕНТЫ — фото ТТН и путевых листов
// ============================================================

let docsCache = [];
let docsUnsub = null;
let addFormOpen = false;
let selectedFile = null;

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
  addBtn.onclick = () => { addFormOpen = true; selectedFile = null; render(); };
  wrap.appendChild(addBtn);

  if (addFormOpen) wrap.appendChild(renderAddForm());

  if (!docsCache.length) {
    wrap.appendChild(el("div", "text-center text-slate-400 text-sm py-8", "Пока нет загруженных документов"));
  }

  docsCache.forEach((doc) => {
    const card = el("div", "bg-white rounded-2xl shadow-sm overflow-hidden flex gap-3 p-3");
    const thumb = el("img", "w-20 h-20 object-cover rounded-xl shrink-0 cursor-pointer");
    thumb.src = doc.photoUrl;
    thumb.onclick = () => openLightbox(doc.photoUrl);
    card.appendChild(thumb);

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
      <div class="block text-xs text-slate-500 mb-1">Фото ТТН / путевого листа</div>
      <div class="flex gap-2">
        <button type="button" id="df-btn-camera" class="flex-1 py-2.5 rounded-lg bg-slate-700 text-white text-sm font-semibold flex items-center justify-center gap-1.5">📷 Камера</button>
        <button type="button" id="df-btn-gallery" class="flex-1 py-2.5 rounded-lg bg-slate-100 text-slate-600 text-sm font-semibold flex items-center justify-center gap-1.5">🖼️ Галерея</button>
      </div>
      <input id="df-photo-camera" type="file" accept="image/*" capture="environment" class="hidden" />
      <input id="df-photo-gallery" type="file" accept="image/*" class="hidden" />
    </div>
    <div id="df-preview" class="hidden"><img class="w-full rounded-lg max-h-48 object-contain bg-slate-50" /></div>
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

  const handlePhoto = (file) => {
    selectedFile = file || null;
    const prev = card.querySelector("#df-preview");
    if (selectedFile) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        prev.querySelector("img").src = ev.target.result;
        prev.classList.remove("hidden");
      };
      reader.readAsDataURL(selectedFile);
    } else {
      prev.classList.add("hidden");
    }
  };
  const camInput = card.querySelector("#df-photo-camera");
  const galInput = card.querySelector("#df-photo-gallery");
  card.querySelector("#df-btn-camera").onclick = () => camInput.click();
  card.querySelector("#df-btn-gallery").onclick = () => galInput.click();
  camInput.onchange = (e) => handlePhoto(e.target.files[0]);
  galInput.onchange = (e) => handlePhoto(e.target.files[0]);

  card.querySelector("#df-cancel").onclick = () => { addFormOpen = false; render(); };

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

    if (!ttnNumber || !ttnDate || !driverName || !selectedFile) {
      errBox.textContent = "Заполни номер ТТН, дату, водителя и прикрепи фото.";
      errBox.classList.remove("hidden");
      return;
    }
    errBox.classList.add("hidden");
    saveBtn.disabled = true;
    saveBtn.textContent = "Загружаю фото…";

    try {
      const resized = await resizeImage(selectedFile);
      const url = await uploadToCloudinary(resized);
      await db.collection("ttnDocs").add({
        ttnNumber, ttnDate, truck, driverName,
        weight: weight ? Number(weight) : null,
        photoUrl: url,
        uploadedByUid: currentUser.uid,
        uploadedByName: currentProfile.name,
        uploadedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      addFormOpen = false;
      selectedFile = null;
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

function openLightbox(url) {
  const overlay = el("div", "fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4");
  overlay.onclick = () => overlay.remove();
  const img = el("img", "max-w-full max-h-full rounded-lg");
  img.src = url;
  overlay.appendChild(img);
  document.body.appendChild(overlay);
}
