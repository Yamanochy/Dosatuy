// ============================================================
// БОРТОВОЙ ЖУРНАЛ
// Всё, что происходит с машиной, но НЕ оплачивается: подкачал колесо,
// долил антифриз, заметил стук, заменил лампочку. Оплачиваемые работы
// идут во вкладку «ТО / Ремонт» — они падают в табель и в деньги.
// Записи журнала в табель не попадают никогда.
//
// Замечание («стучит ступица») живёт со статусом «открыто», пока кто-то
// не отметит, что устранено. Открытые замечания видно сверху списка,
// чтобы они не терялись.
// ============================================================

let logbookCache = [];
let logbookUnsub = null;
let logFormOpen = false;
let logEditId = null;          // правка записи (руководитель)
let logSelectedFiles = [];     // новые фото
let logKeptPhotos = [];        // уже загруженные фото при правке
let logFilterFrom = "";
let logFilterTo = "";
let logFilterTruck = "";       // "" = все машины
let logOnlyOpen = false;       // показывать только открытые замечания
let logView = "list";          // "list" | "trucks"
let logTruckOpen = "";         // машина, раскрытая в истории

// Типы записи. defect — единственный, у которого есть статус.
const LOG_KINDS = [
  { id: "defect", label: "Замечание",      short: "Замечание",  cls: "bg-brick/15 text-brick border-brick/30" },
  { id: "fixed",  label: "Устранил",       short: "Устранил",   cls: "bg-shift/15 text-shift border-shift/30" },
  { id: "fluids", label: "Долив / замена", short: "Долив",      cls: "bg-diesel/10 text-diesel border-diesel/25" },
  { id: "tires",  label: "Колёса",         short: "Колёса",     cls: "bg-diesel/10 text-diesel border-diesel/25" },
  { id: "other",  label: "Прочее",         short: "Прочее",     cls: "bg-slate-100 text-slate-500 border-slate-200" },
];
function logKind(id) {
  return LOG_KINDS.find((k) => k.id === id) || LOG_KINDS[LOG_KINDS.length - 1];
}

// сегодняшняя дата по МЕСТНОМУ времени. Через toISOString() нельзя:
// он отдаёт UTC, и в Забайкалье (+9) запись, сделанная ночью или рано
// утром, получила бы вчерашнее число.
function logTodayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function subscribeLogbook() {
  if (logbookUnsub) return;
  logbookUnsub = db.collection("logbookDocs").orderBy("date", "desc")
    .onSnapshot((snap) => {
      logbookCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      // не сносим форму, пока человек её заполняет или правит запись
      if (currentTab === "documents" && docsMode === "logbook" && !logFormOpen && !logEditId) renderDocuments();
    }, (err) => {
      // правила для новой коллекции ещё не загружены — журнал просто пуст
      console.warn("Журнал недоступен:", err && err.message);
    });
}

// все машины, которые встречаются в системе: из Настроек + из самих записей
// (машину могли убрать из Настроек, а история по ней должна остаться)
function logbookTrucks() {
  const set = new Set((STATE.trucks || []).filter(Boolean));
  logbookCache.forEach((r) => { if (r.truck) set.add(r.truck); });
  docsCache.forEach((d) => { if (d.truck) set.add(d.truck); });
  maintenanceCache.forEach((m) => { if (m.truck) set.add(m.truck); });
  return [...set].sort((a, b) => a.localeCompare(b, "ru"));
}

// последний известный пробег машины (по записям журнала)
function lastOdometer(truck) {
  let best = null;
  logbookCache.forEach((r) => {
    if (r.truck !== truck || !r.odometer) return;
    if (!best || (r.date || "") > (best.date || "") ||
        ((r.date || "") === (best.date || "") && Number(r.odometer) > Number(best.odometer))) {
      best = r;
    }
  });
  return best ? Number(best.odometer) : null;
}

function openDefects() {
  return logbookCache.filter((r) => r.kind === "defect" && r.status !== "done");
}

function logSorted(list) {
  return list.slice().sort((a, b) => {
    const d = String(b.date || "").localeCompare(String(a.date || ""));
    if (d) return d;
    const ta = a.uploadedAt && a.uploadedAt.seconds ? a.uploadedAt.seconds : 0;
    const tb = b.uploadedAt && b.uploadedAt.seconds ? b.uploadedAt.seconds : 0;
    return tb - ta;
  });
}

function logFiltered() {
  let list = applyDateFilter(logbookCache, logFilterFrom, logFilterTo, "date");
  if (logFilterTruck) list = list.filter((r) => r.truck === logFilterTruck);
  if (logOnlyOpen) list = list.filter((r) => r.kind === "defect" && r.status !== "done");
  return logSorted(list);
}

// ============================================================
// ГЛАВНЫЙ РЕНДЕР РАЗДЕЛА
// ============================================================
function renderLogbookSection(wrap) {
  subscribeLogbook();

  // если правимая запись исчезла — выходим из правки
  const editDoc = logEditId ? logbookCache.find((r) => r.id === logEditId) : null;
  if (logEditId && !editDoc) { logEditId = null; logSelectedFiles = []; logKeptPhotos = []; }

  // переключатель «Записи / По машинам»
  const seg = el("div", "flex gap-2");
  [["list", "Записи"], ["trucks", "По машинам"]].forEach(([key, label]) => {
    const b = el("button",
      `flex-1 py-2 rounded-lg text-xs font-semibold ${logView === key ? "bg-diesel text-white" : "bg-white text-slate-500 border border-slate-200"}`,
      label);
    b.onclick = () => { logView = key; logTruckOpen = ""; render(); };
    seg.appendChild(b);
  });
  wrap.appendChild(seg);

  if (logView === "trucks") { renderTruckHistory(wrap); return; }

  if (editDoc) {
    wrap.appendChild(renderLogbookForm(editDoc));
  } else {
    const addBtn = el("button", "w-full py-3 rounded-xl bg-diesel-700 text-white font-semibold shadow-sm flex items-center justify-center gap-2",
      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg><span>Добавить запись в журнал</span>`);
    addBtn.onclick = () => { logFormOpen = true; logSelectedFiles = []; render(); };
    wrap.appendChild(addBtn);
    if (logFormOpen) wrap.appendChild(renderLogbookForm(null));
  }

  wrap.appendChild(el("div", "text-[11px] text-slate-400 px-1 -mt-1",
    "Журнал — для того, что не оплачивается. За работу, которая оплачивается, записывай во вкладке «ТО / Ремонт»."));

  renderPendingBanner(wrap, "logbook", "date",
    (p) => `${logKind(p.kind).short} · ${escapeHtml(p.truck || "")}`);

  // ---------- открытые замечания ----------
  const open = openDefects();
  if (open.length && !logOnlyOpen) {
    const card = el("div", "bg-brick/10 border border-brick/30 rounded-xl p-3");
    const head = el("div", "flex items-center justify-between gap-2");
    head.innerHTML = `<div class="text-xs font-bold text-brick flex items-center gap-1.5">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>
      Открытых замечаний: ${open.length}</div>`;
    const showBtn = el("button", "text-[11px] font-semibold text-brick underline shrink-0", "показать только их");
    showBtn.onclick = () => { logOnlyOpen = true; render(); };
    head.appendChild(showBtn);
    card.appendChild(head);
    const names = [...new Set(open.map((r) => r.truck).filter(Boolean))];
    if (names.length) {
      card.appendChild(el("div", "text-[11px] text-brick/80 mt-1", escapeHtml(names.join(" · "))));
    }
    wrap.appendChild(card);
  }

  // ---------- фильтр ----------
  const trucks = logbookTrucks();
  const filterCard = el("div", "bg-white rounded-xl border border-slate-200 p-3 space-y-2");
  filterCard.innerHTML = `
    <div class="flex items-end gap-2">
      <label class="text-xs text-slate-500 flex-1">С даты
        <input id="log-from" type="date" value="${logFilterFrom}" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
      </label>
      <label class="text-xs text-slate-500 flex-1">По дату
        <input id="log-to" type="date" value="${logFilterTo}" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
      </label>
    </div>
    <label class="block text-xs text-slate-500">Машина
      <select id="log-truck" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white">
        <option value="">Все машины</option>
        ${trucks.map((t) => `<option value="${escapeHtml(t)}" ${t === logFilterTruck ? "selected" : ""}>${escapeHtml(t)}${truckPlate(t) ? " · " + escapeHtml(truckPlate(t)) : ""}</option>`).join("")}
      </select>
    </label>`;
  const row = el("div", "flex items-center justify-between gap-2 pt-1");
  const onlyBtn = el("button",
    `text-xs font-semibold px-2.5 py-1.5 rounded-lg border ${logOnlyOpen ? "bg-brick text-white border-brick" : "bg-white text-slate-500 border-slate-200"}`,
    "Только открытые");
  onlyBtn.onclick = () => { logOnlyOpen = !logOnlyOpen; render(); };
  row.appendChild(onlyBtn);
  const clearBtn = el("button", "text-xs text-slate-400 underline", "Сбросить");
  clearBtn.onclick = () => { logFilterFrom = ""; logFilterTo = ""; logFilterTruck = ""; logOnlyOpen = false; render(); };
  row.appendChild(clearBtn);
  filterCard.appendChild(row);
  wrap.appendChild(filterCard);
  setTimeout(() => {
    const f = document.getElementById("log-from"), t = document.getElementById("log-to"), tr = document.getElementById("log-truck");
    if (f) f.onchange = () => { logFilterFrom = f.value; render(); };
    if (t) t.onchange = () => { logFilterTo = t.value; render(); };
    if (tr) tr.onchange = () => { logFilterTruck = tr.value; render(); };
  }, 0);

  // ---------- список ----------
  const list = logFiltered();

  if (currentProfile?.role === "manager" && list.length) {
    const exp = el("button", "w-full py-2.5 rounded-xl bg-white border border-diesel text-diesel text-sm font-semibold flex items-center justify-center gap-2",
      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13m0 0-4-4m4 4 4-4"/><path d="M4 19h16"/></svg>Скачать журнал (${list.length})`);
    exp.onclick = () => exportLogbookExcel(list);
    wrap.appendChild(exp);
  }

  if (!list.length) {
    wrap.appendChild(el("div", "text-center text-slate-400 text-sm py-8",
      logbookCache.length
        ? "По этому фильтру записей нет."
        : "Журнал пока пуст. Сюда пишут всё, что сделали с машиной или заметили: подкачал колесо, долил антифриз, стучит ступица."));
    return;
  }

  list.forEach((rec) => wrap.appendChild(logbookCard(rec)));
}

// ---------- карточка записи ----------
function logbookCard(rec, compact) {
  const k = logKind(rec.kind);
  const isOpenDefect = rec.kind === "defect" && rec.status !== "done";
  const card = el("div", `bg-white rounded-xl border overflow-hidden ${isOpenDefect ? "border-brick/50" : "border-slate-200"}`);
  const body = el("div", "p-3");

  const top = el("div", "flex items-start justify-between gap-2 mb-1.5");
  top.innerHTML = `
    <div class="min-w-0 flex flex-wrap items-center gap-1.5">
      <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded border ${k.cls}">${escapeHtml(k.label)}</span>
      ${isOpenDefect ? `<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-brick text-white">ОТКРЫТО</span>` : ""}
      ${rec.kind === "defect" && rec.status === "done" ? `<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-shift/15 text-shift border border-shift/30">УСТРАНЕНО</span>` : ""}
      <span class="text-xs text-slate-400 font-num">${rec.date ? fmtRU(parseISO(rec.date)) : ""}</span>
    </div>`;
  body.appendChild(top);

  const meta = el("div", "text-xs text-slate-500 mb-1");
  meta.innerHTML = `<span class="font-semibold text-slate-700">${escapeHtml(rec.truck || "—")}</span>${truckPlate(rec.truck) ? ` · <span class="font-num">${escapeHtml(truckPlate(rec.truck))}</span>` : ""} · ${escapeHtml(rec.driverName || "—")}${rec.odometer ? ` · <span class="font-num">${Number(rec.odometer).toLocaleString("ru-RU")} км</span>` : ""}`;
  body.appendChild(meta);

  body.appendChild(el("div", "text-sm text-slate-700 whitespace-pre-wrap break-words", escapeHtml(rec.text || "")));

  if (rec.photoUrls && rec.photoUrls.length) {
    const ph = el("div", "grid grid-cols-3 gap-2 mt-2");
    rec.photoUrls.forEach((url) => {
      const img = el("img", "w-full h-20 object-cover rounded-lg bg-slate-50 cursor-pointer");
      img.src = url;
      img.onclick = () => { if (typeof openLightbox === "function") openLightbox(rec.photoUrls, rec.photoUrls.indexOf(url)); };
      ph.appendChild(img);
    });
    body.appendChild(ph);
  }

  const foot = el("div", "text-[10px] text-slate-300 mt-1.5", `записал(а): ${escapeHtml(rec.uploadedByName || "")}`);
  body.appendChild(foot);
  if (rec.status === "done" && rec.resolvedByName) {
    body.appendChild(el("div", "text-[10px] text-shift",
      `устранил(а): ${escapeHtml(rec.resolvedByName)}${rec.resolvedDate ? " · " + fmtRU(parseISO(rec.resolvedDate)) : ""}`));
  }
  if (rec.editedByName) {
    body.appendChild(el("div", "text-[10px] text-route", `исправил(а): ${escapeHtml(rec.editedByName)}`));
  }

  card.appendChild(body);

  if (compact) return card;

  // ---------- действия ----------
  const isManager = currentProfile?.role === "manager";
  const isAuthor = currentUser && rec.uploadedByUid === currentUser.uid;
  const actions = el("div", "border-t border-slate-100 px-3 py-2 flex items-center gap-2 flex-wrap");
  let any = false;

  if (isOpenDefect) {
    // отметить устранённым может любой — чинит часто не тот, кто записал
    const done = el("button", "text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-shift text-white", "Отметить устранённым");
    done.onclick = async () => {
      if (!navigator.onLine) return alert("Для этого нужен интернет.");
      done.disabled = true; done.textContent = "…";
      try {
        await db.collection("logbookDocs").doc(rec.id).update({
          status: "done",
          resolvedByUid: currentUser.uid,
          resolvedByName: currentProfile.name,
          resolvedDate: logTodayISO(),
          resolvedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) {
        done.disabled = false; done.textContent = "Отметить устранённым";
        alert("Не получилось: " + e.message);
      }
    };
    actions.appendChild(done);
    any = true;
  }

  if (rec.kind === "defect" && rec.status === "done" && isManager) {
    const back = el("button", "text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-500", "Вернуть в открытые");
    back.onclick = async () => {
      if (!navigator.onLine) return alert("Для этого нужен интернет.");
      try {
        await db.collection("logbookDocs").doc(rec.id).update({
          status: "open", resolvedByUid: null, resolvedByName: null, resolvedDate: null,
        });
      } catch (e) { alert("Не получилось: " + e.message); }
    };
    actions.appendChild(back);
    any = true;
  }

  if (isManager) {
    const edit = el("button", "text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-500", "Исправить");
    edit.onclick = () => {
      logEditId = rec.id;
      logFormOpen = false;
      logSelectedFiles = [];
      logKeptPhotos = (rec.photoUrls || []).slice();
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    actions.appendChild(edit);
    any = true;
  }

  if (isManager || isAuthor) {
    const del = el("button", "text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-400 ml-auto", "Удалить");
    del.onclick = () => {
      if (confirm("Удалить эту запись журнала?")) db.collection("logbookDocs").doc(rec.id).delete();
    };
    actions.appendChild(del);
    any = true;
  }

  if (any) card.appendChild(actions);
  return card;
}

// ============================================================
// ФОРМА: добавление и правка одной записи
// ============================================================
function renderLogbookForm(editDoc) {
  const card = el("div", `bg-white rounded-xl border-2 ${editDoc ? "border-route" : "border-diesel"} p-4 space-y-3`);
  const trucks = logbookTrucks();
  const driverNames = [...new Set((STATE.drivers || []).map((d) => d.name).filter(Boolean))];
  if (editDoc && editDoc.driverName && !driverNames.includes(editDoc.driverName)) driverNames.push(editDoc.driverName);
  driverNames.sort((a, b) => a.localeCompare(b, "ru"));

  // по умолчанию — сегодня, своя машина и ты сам
  const me = nameKey(currentProfile?.name);
  const myDriver = (STATE.drivers || []).find((d) => nameKey(d.name) === me);
  const defTruck = editDoc ? editDoc.truck : (myDriver && myDriver.truck ? myDriver.truck : (trucks[0] || ""));
  const defDriver = editDoc ? editDoc.driverName : (myDriver ? myDriver.name : "");
  const defDate = editDoc ? editDoc.date : logTodayISO();
  let chosenKind = editDoc ? editDoc.kind : "";

  card.innerHTML = `
    <div class="font-bold text-slate-700">${editDoc ? "Исправить запись журнала" : "Новая запись в журнал"}</div>
    <label class="block text-xs text-slate-500">Дата
      <input id="lg-date" type="date" value="${defDate}" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
    </label>
    <label class="block text-xs text-slate-500">Машина
      <select id="lg-truck" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white">
        ${trucks.map((t) => `<option value="${escapeHtml(t)}" ${t === defTruck ? "selected" : ""}>${escapeHtml(t)}${truckPlate(t) ? " · " + escapeHtml(truckPlate(t)) : ""}</option>`).join("")}
      </select>
    </label>
    <label class="block text-xs text-slate-500">Кто делал / заметил
      <select id="lg-driver" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white">
        <option value="">Выбери водителя</option>
        ${driverNames.map((n) => `<option value="${escapeHtml(n)}" ${n === defDriver ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")}
      </select>
    </label>
    <div>
      <div class="text-xs text-slate-500 mb-1.5">Тип записи</div>
      <div id="lg-kinds" class="flex flex-wrap gap-1.5"></div>
    </div>
    <label class="block text-xs text-slate-500">Пробег, км <span class="text-slate-300">— если знаешь</span>
      <input id="lg-odo" type="number" inputmode="numeric" min="0" step="1" value="${editDoc && editDoc.odometer ? editDoc.odometer : ""}" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-num" placeholder="показания одометра" />
    </label>
    <div id="lg-odo-hint" class="text-[11px] text-slate-400 -mt-1"></div>
    <label class="block text-xs text-slate-500">Что сделал или заметил
      <textarea id="lg-text" rows="4" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm resize-none" placeholder="подробно: что именно, с какой стороны, при каких условиях">${editDoc ? escapeHtml(editDoc.text || "") : ""}</textarea>
    </label>
    <div>
      <div class="flex items-center justify-between mb-1">
        <div class="text-xs text-slate-500">Фото</div>
        <div id="lg-count" class="text-xs text-slate-400 font-medium">0 / ${MAX_PHOTOS}</div>
      </div>
      <div class="flex gap-2">
        <button type="button" id="lg-cam" class="flex-1 py-2.5 rounded-lg bg-diesel-700 text-white text-sm font-semibold">Камера</button>
        <button type="button" id="lg-gal" class="flex-1 py-2.5 rounded-lg bg-slate-100 text-slate-600 text-sm font-semibold">Галерея</button>
      </div>
      <input id="lg-cam-i" type="file" accept="image/*" capture="environment" class="hidden" />
      <input id="lg-gal-i" type="file" accept="image/*" multiple class="hidden" />
      <div id="lg-thumbs" class="grid grid-cols-3 gap-2 mt-2"></div>
    </div>
    <div id="lg-err" class="text-xs text-rose-600 hidden"></div>
    <div class="flex gap-2 pt-1">
      <button id="lg-save" class="flex-1 py-2.5 rounded-lg bg-diesel text-white font-semibold text-sm">${editDoc ? "Сохранить" : "Записать"}</button>
      <button id="lg-cancel" class="px-4 py-2.5 rounded-lg bg-slate-100 text-slate-500 font-semibold text-sm">Отмена</button>
    </div>`;

  // ---- чипсы типа ----
  const kindsWrap = card.querySelector("#lg-kinds");
  function paintKinds() {
    kindsWrap.innerHTML = "";
    LOG_KINDS.forEach((k) => {
      const b = el("button",
        `px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${chosenKind === k.id ? "bg-diesel text-white border-diesel" : "bg-white text-slate-600 border-slate-200"}`,
        escapeHtml(k.label));
      b.type = "button";
      b.onclick = () => { chosenKind = k.id; paintKinds(); };
      kindsWrap.appendChild(b);
    });
  }
  paintKinds();

  // ---- подсказка по пробегу ----
  const odoInput = card.querySelector("#lg-odo");
  const odoHint = card.querySelector("#lg-odo-hint");
  const truckSel = card.querySelector("#lg-truck");
  function paintOdoHint() {
    const prev = lastOdometer(truckSel.value);
    const val = Number(odoInput.value);
    if (!prev) { odoHint.textContent = ""; return; }
    if (val && val < prev) {
      odoHint.className = "text-[11px] text-brick -mt-1";
      odoHint.textContent = `Меньше прошлого (${prev.toLocaleString("ru-RU")} км) — проверь, не опечатка ли.`;
    } else {
      odoHint.className = "text-[11px] text-slate-400 -mt-1";
      odoHint.textContent = `Прошлый известный пробег: ${prev.toLocaleString("ru-RU")} км.`;
    }
  }
  odoInput.oninput = paintOdoHint;
  truckSel.onchange = paintOdoHint;
  paintOdoHint();

  // ---- фото ----
  const camI = card.querySelector("#lg-cam-i"), galI = card.querySelector("#lg-gal-i");
  const camB = card.querySelector("#lg-cam"), galB = card.querySelector("#lg-gal");
  const countEl = card.querySelector("#lg-count"), thumbs = card.querySelector("#lg-thumbs");
  const kept = editDoc ? logKeptPhotos : [];
  function total() { return kept.length + logSelectedFiles.length; }
  function paintThumbs() {
    countEl.textContent = `${total()} / ${MAX_PHOTOS}`;
    const full = total() >= MAX_PHOTOS;
    camB.disabled = full; galB.disabled = full;
    camB.classList.toggle("opacity-40", full); galB.classList.toggle("opacity-40", full);
    thumbs.innerHTML = "";
    kept.forEach((url, i) => {
      const box = el("div", "relative");
      const img = el("img", "w-full h-20 object-cover rounded-lg bg-slate-50"); img.src = url;
      box.appendChild(img);
      const rm = el("button", "absolute -top-1.5 -right-1.5 bg-diesel text-white rounded-full w-5 h-5 text-xs flex items-center justify-center", "✕");
      rm.type = "button";
      rm.onclick = () => { kept.splice(i, 1); paintThumbs(); };
      box.appendChild(rm);
      thumbs.appendChild(box);
    });
    logSelectedFiles.forEach((f, i) => {
      const box = el("div", "relative");
      const img = el("img", "w-full h-20 object-cover rounded-lg bg-slate-50");
      const r = new FileReader(); r.onload = (e) => { img.src = e.target.result; }; r.readAsDataURL(f);
      box.appendChild(img);
      const rm = el("button", "absolute -top-1.5 -right-1.5 bg-diesel text-white rounded-full w-5 h-5 text-xs flex items-center justify-center", "✕");
      rm.type = "button";
      rm.onclick = () => { logSelectedFiles.splice(i, 1); paintThumbs(); };
      box.appendChild(rm);
      thumbs.appendChild(box);
    });
  }
  function addFiles(fl) {
    for (const f of fl) { if (total() >= MAX_PHOTOS) break; logSelectedFiles.push(f); }
    paintThumbs();
  }
  camB.onclick = () => { if (total() < MAX_PHOTOS) camI.click(); };
  galB.onclick = () => { if (total() < MAX_PHOTOS) galI.click(); };
  camI.onchange = (e) => { addFiles(e.target.files); camI.value = ""; };
  galI.onchange = (e) => { addFiles(e.target.files); galI.value = ""; };
  paintThumbs();

  function close() {
    logFormOpen = false; logEditId = null;
    logSelectedFiles = []; logKeptPhotos = [];
    render();
  }
  card.querySelector("#lg-cancel").onclick = close;

  // ---- сохранение ----
  card.querySelector("#lg-save").onclick = async () => {
    const err = card.querySelector("#lg-err");
    const btn = card.querySelector("#lg-save");
    const fail = (m) => {
      err.textContent = m; err.classList.remove("hidden");
      btn.disabled = false; btn.textContent = editDoc ? "Сохранить" : "Записать";
    };

    const date = card.querySelector("#lg-date").value;
    const truck = truckSel.value;
    const driverName = card.querySelector("#lg-driver").value;
    const text = card.querySelector("#lg-text").value.trim();
    const odoRaw = card.querySelector("#lg-odo").value;
    const odometer = odoRaw === "" ? null : Math.round(Number(odoRaw));

    if (!date) return fail("Поставь дату.");
    if (!truck) return fail("Выбери машину.");
    if (!driverName) return fail("Выбери, кто делал или заметил.");
    if (!chosenKind) return fail("Выбери тип записи — одно нажатие по кнопкам выше.");
    if (text.length < 3) return fail("Опиши подробнее, что сделал или заметил.");
    if (odometer !== null && (!(odometer > 0) || odometer > 9999999)) return fail("Пробег выглядит неправильно.");

    err.classList.add("hidden");
    btn.disabled = true;

    const payload = {
      date, truck, driverName, kind: chosenKind, odometer, text,
      status: chosenKind === "defect" ? (editDoc ? (editDoc.status || "open") : "open") : null,
    };

    try {
      // фото сжимаем всегда — это не требует сети
      const blobs = [];
      for (let i = 0; i < logSelectedFiles.length; i++) {
        btn.textContent = `Готовлю фото ${i + 1}/${logSelectedFiles.length}…`;
        blobs.push(await resizeImage(logSelectedFiles[i]));
      }

      if (editDoc) {
        // правка идёт только онлайн: офлайн-очередь умеет только добавлять
        if (!navigator.onLine) return fail("Для правки нужен интернет.");
        btn.textContent = "Сохраняю…";
        const urls = kept.slice();
        for (let i = 0; i < blobs.length; i++) {
          btn.textContent = `Загружаю фото ${i + 1}/${blobs.length}…`;
          urls.push(await uploadToCloudinary(blobs[i]));
        }
        // uploadedAt и автора не трогаем — правка помечается отдельно
        await db.collection("logbookDocs").doc(editDoc.id).update({
          ...payload,
          photoUrls: urls,
          editedByUid: currentUser.uid,
          editedByName: currentProfile.name,
          editedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        close();
        return;
      }

      const full = {
        ...payload,
        uploadedByUid: currentUser.uid,
        uploadedByName: currentProfile.name,
      };

      if (!navigator.onLine) {
        await queueAdd("logbook", full, blobs);
        await refreshPendingQueueCache();
        close();
        return;
      }

      btn.textContent = "Сохраняю…";
      const urls = [];
      for (let i = 0; i < blobs.length; i++) {
        btn.textContent = `Загружаю фото ${i + 1}/${blobs.length}…`;
        urls.push(await uploadToCloudinary(blobs[i]));
      }
      await db.collection("logbookDocs").add({
        ...full,
        photoUrls: urls,
        uploadedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      close();
    } catch (e) {
      // сеть пропала посреди отправки — не теряем запись, кладём в очередь
      if (!editDoc && typeof looksLikeNetworkError === "function" && looksLikeNetworkError(e)) {
        try {
          const blobs2 = [];
          for (const f of logSelectedFiles) blobs2.push(await resizeImage(f));
          await queueAdd("logbook", {
            ...payload,
            uploadedByUid: currentUser.uid,
            uploadedByName: currentProfile.name,
          }, blobs2);
          await refreshPendingQueueCache();
          close();
          return;
        } catch (e2) { /* ниже покажем исходную ошибку */ }
      }
      fail("Не получилось сохранить: " + e.message);
    }
  };

  return card;
}

// ============================================================
// ИСТОРИЯ ПО МАШИНЕ
// Вся жизнь Шакмана в одной ленте: рейсы, ТО, ремонты, журнал.
// ============================================================
function truckTimeline(truck) {
  const items = [];
  docsCache.forEach((d) => {
    if (d.truck !== truck) return;
    items.push({
      date: d.ttnDate, sort: d.ttnDate, type: "ttn",
      title: `Рейс · ТТН № ${d.ttnNumber || ""}`,
      sub: `${d.driverName || ""}${d.weight ? ` · ${Number(d.weight).toLocaleString("ru-RU")} т` : ""}`,
      cls: "bg-diesel/10 text-diesel border-diesel/25",
    });
  });
  maintenanceCache.forEach((m) => {
    if (m.truck !== truck) return;
    const workers = [m.primaryWorker, m.secondaryWorker].filter(Boolean);
    items.push({
      date: m.date, sort: m.date, type: "maint",
      title: m.type === "Ремонт" ? `Ремонт · ${m.repairTypeName || "без вида"}` : "ТО",
      sub: `${workers.join(", ")} · ${maintBasePay(m).toLocaleString("ru-RU")} ₽`,
      note: m.note || "",
      cls: "bg-route/15 text-route-600 border-route/30",
    });
  });
  logbookCache.forEach((r) => {
    if (r.truck !== truck) return;
    const k = logKind(r.kind);
    items.push({
      date: r.date, sort: r.date, type: "log",
      title: `${k.label}${r.kind === "defect" && r.status !== "done" ? " · ОТКРЫТО" : ""}`,
      sub: `${r.driverName || ""}${r.odometer ? ` · ${Number(r.odometer).toLocaleString("ru-RU")} км` : ""}`,
      note: r.text || "",
      cls: r.kind === "defect" && r.status !== "done" ? "bg-brick/15 text-brick border-brick/30" : k.cls,
    });
  });
  return items.sort((a, b) => String(b.sort || "").localeCompare(String(a.sort || "")));
}

function renderTruckHistory(wrap) {
  const trucks = logbookTrucks();

  if (!logTruckOpen) {
    if (!trucks.length) {
      wrap.appendChild(el("div", "text-center text-slate-400 text-sm py-8", "Машин пока нет — добавь их в Настройках."));
      return;
    }
    wrap.appendChild(el("div", "text-[11px] text-slate-400 px-1", "Выбери машину — увидишь всё, что с ней происходило: рейсы, ТО, ремонты и записи журнала."));
    trucks.forEach((t) => {
      const openCnt = logbookCache.filter((r) => r.truck === t && r.kind === "defect" && r.status !== "done").length;
      const odo = lastOdometer(t);
      const total = docsCache.filter((d) => d.truck === t).length
        + maintenanceCache.filter((m) => m.truck === t).length
        + logbookCache.filter((r) => r.truck === t).length;
      const card = el("div", `bg-white rounded-xl border ${openCnt ? "border-brick/50" : "border-slate-200"} p-4 flex items-center justify-between gap-2 cursor-pointer`);
      card.innerHTML = `
        <div class="min-w-0">
          <div class="font-bold text-slate-800 truncate">${escapeHtml(t)}</div>
          <div class="text-xs text-slate-400">${truckPlate(t) ? `<span class="font-num">${escapeHtml(truckPlate(t))}</span> · ` : ""}${total} запис${total % 10 === 1 && total % 100 !== 11 ? "ь" : ([2,3,4].includes(total % 10) && ![12,13,14].includes(total % 100)) ? "и" : "ей"}${odo ? ` · <span class="font-num">${odo.toLocaleString("ru-RU")} км</span>` : ""}</div>
        </div>
        <div class="shrink-0 text-right">
          ${openCnt ? `<div class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-brick text-white inline-block">${openCnt} открыт${openCnt === 1 ? "о" : "ых"}</div>` : ""}
          <div class="text-slate-300 text-lg leading-none mt-1">›</div>
        </div>`;
      card.onclick = () => { logTruckOpen = t; render(); };
      wrap.appendChild(card);
    });
    return;
  }

  // ---- лента одной машины ----
  const back = el("button", "text-sm text-slate-500 flex items-center gap-1", "‹ ко всем машинам");
  back.onclick = () => { logTruckOpen = ""; render(); };
  wrap.appendChild(back);

  const odo = lastOdometer(logTruckOpen);
  const head = el("div", "bg-diesel rounded-xl px-4 py-3 text-white");
  head.innerHTML = `
    <div class="font-bold text-lg">${escapeHtml(logTruckOpen)}</div>
    <div class="text-xs text-white/60">${truckPlate(logTruckOpen) ? `<span class="font-num">${escapeHtml(truckPlate(logTruckOpen))}</span>` : "гос. номер не заполнен"}${odo ? ` · пробег <span class="font-num text-route">${odo.toLocaleString("ru-RU")} км</span>` : ""}</div>`;
  wrap.appendChild(head);

  const items = truckTimeline(logTruckOpen);
  if (!items.length) {
    wrap.appendChild(el("div", "text-center text-slate-400 text-sm py-8", "По этой машине пока ничего не записано."));
    return;
  }

  items.forEach((it) => {
    const card = el("div", "bg-white rounded-xl border border-slate-200 p-3");
    card.innerHTML = `
      <div class="flex items-center gap-1.5 flex-wrap mb-1">
        <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded border ${it.cls}">${escapeHtml(it.title)}</span>
        <span class="text-xs text-slate-400 font-num">${it.date ? fmtRU(parseISO(it.date)) : ""}</span>
      </div>
      <div class="text-xs text-slate-500">${escapeHtml(it.sub || "")}</div>
      ${it.note ? `<div class="text-sm text-slate-700 mt-1 whitespace-pre-wrap break-words">${escapeHtml(it.note)}</div>` : ""}`;
    wrap.appendChild(card);
  });
}

// ============================================================
// ВЫГРУЗКА ЖУРНАЛА В EXCEL
// ============================================================
function exportLogbookExcel(list) {
  if (typeof XLSX === "undefined" || typeof xlBuildSheet !== "function") {
    alert("Не удалось загрузить модуль Excel — проверь интернет и попробуй ещё раз.");
    return;
  }
  if (!list.length) { alert("Записей нет."); return; }

  const periodLine = (logFilterFrom || logFilterTo)
    ? `Период: ${logFilterFrom ? fmtRU(parseISO(logFilterFrom)) : "начало"} — ${logFilterTo ? fmtRU(parseISO(logFilterTo)) : fmtRU(new Date())}`
    : "Период: все записи";
  const lines = [periodLine];
  if (logFilterTruck) lines.push(`Машина: ${logFilterTruck}${truckPlate(logFilterTruck) ? " · " + truckPlate(logFilterTruck) : ""}`);
  if (logOnlyOpen) lines.push("Показаны только открытые замечания");

  const ws = xlBuildSheet({
    title: "БОРТОВОЙ ЖУРНАЛ",
    subtitle: "Перевозка железной руды · п. Досатуй, Забайкальский край",
    lines,
    columns: [
      { title: "№", width: 5, align: "center" },
      { title: "Дата", width: 12, align: "center" },
      { title: "Машина", width: 18 },
      { title: "Гос. номер", width: 13, align: "center" },
      { title: "Кто", width: 28, wrap: true },
      { title: "Тип", width: 15, align: "center" },
      { title: "Пробег, км", width: 12, align: "right", numFmt: "#,##0" },
      { title: "Что сделал или заметил", width: 52, wrap: true },
      { title: "Статус", width: 13, align: "center" },
    ],
    rows: list.map((r, i) => [
      i + 1,
      r.date ? fmtRU(parseISO(r.date)) : "",
      r.truck || "",
      truckPlate(r.truck),
      r.driverName || "",
      logKind(r.kind).label,
      r.odometer ? Number(r.odometer) : "",
      r.text || "",
      r.kind === "defect" ? (r.status === "done" ? "устранено" : "ОТКРЫТО") : "",
    ]),
    total: {
      label: `ВСЕГО: ${list.length} ${xlPlural(list.length, "запись", "записи", "записей")}`
        + (list.filter((r) => r.kind === "defect" && r.status !== "done").length
            ? `, из них открытых замечаний — ${list.filter((r) => r.kind === "defect" && r.status !== "done").length}` : ""),
      span: 8,
      values: {},
    },
    footnote: "Записи журнала не оплачиваются и в табель не попадают. Оплачиваемые работы — во вкладке «ТО / Ремонт».",
  });

  const wb = XLSX.utils.book_new();
  xlAppendSheet(wb, ws, "Журнал", { landscape: true });
  const tag = logFilterTruck
    ? `${logFilterTruck}_${logFilterFrom || "всё"}`
    : (logFilterFrom || logFilterTo ? `${logFilterFrom || "начало"}-${logFilterTo || "сегодня"}` : "все");
  xlSaveFile(wb, xlFileName(["Бортовой-журнал", "Досатуй", tag]));
}
