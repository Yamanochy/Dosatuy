// ============================================================
// РАСХОДЫ — счета за запчасти, шиномонтаж, ремонтные работы и прочее
//
// Только руководитель: и вносит, и видит. Водителям суммы расходов
// знать незачем, поэтому и в правилах Firestore коллекция закрыта.
//
// Сумму по счёту вписывают руками, файл счёта (PDF или фото) кладут
// рядом как подтверждение. Автоматически приложение складывает:
// по статьям, по машинам и за период.
//
// Почему сумма вручную: приложение — это страница в браузере, сервера,
// который прочитал бы PDF, у неё нет. Распознавание можно сделать
// Cloud Function'ом, но оно работает только с текстовыми PDF (не со
// сканами) и у наших счетов нет единого формата — «Итого», «Всего к
// оплате», «Сумма с НДС». Ошибка распознавания тихо испортила бы
// цифру расходов, ради которой всё и затевалось.
// ============================================================

let expensesCache = [];
let expensesUnsub = null;
let expFormOpen = false;
let expEditId = null;
let expSelectedFiles = [];   // новые файлы (PDF или фото)
let expKeptFiles = [];       // уже загруженные файлы при правке
let expFilterFrom = "";
let expFilterTo = "";
let expFilterCat = "";
let expFilterTruck = "";
let expOnlyUnpaid = false;

const EXP_MAX_FILES = 3;
const EXP_MAX_FILE_MB = 10;

function isManagerUser() {
  return currentProfile?.role === "manager";
}

function subscribeExpenses() {
  if (expensesUnsub || !isManagerUser()) return;
  expensesUnsub = db.collection("expenseDocs").orderBy("date", "desc")
    .onSnapshot((snap) => {
      expensesCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (currentTab === "stats" && statsMode === "expenses" && !expFormOpen && !expEditId) render();
    }, (err) => {
      // правила для новой коллекции ещё не загружены — раздел просто пуст
      console.warn("Расходы недоступны:", err && err.message);
    });
}

// сегодняшняя дата по МЕСТНОМУ времени (см. тот же разбор в logbook.js)
function expTodayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function expMoney(n) {
  return Math.round(Number(n) || 0).toLocaleString("ru-RU");
}

// машины: из Настроек + те, что уже встречаются в счетах
function expTrucks() {
  const set = new Set((STATE.trucks || []).filter(Boolean));
  expensesCache.forEach((e) => { if (e.truck) set.add(e.truck); });
  return [...set].sort((a, b) => a.localeCompare(b, "ru"));
}

function expFiltered() {
  let list = applyDateFilter(expensesCache, expFilterFrom, expFilterTo, "date");
  if (expFilterCat) list = list.filter((e) => e.category === expFilterCat);
  if (expFilterTruck) {
    list = list.filter((e) => (expFilterTruck === "__none__" ? !e.truck : e.truck === expFilterTruck));
  }
  if (expOnlyUnpaid) list = list.filter((e) => !e.paid);
  return list.slice().sort((a, b) => {
    const d = String(b.date || "").localeCompare(String(a.date || ""));
    if (d) return d;
    const ta = a.uploadedAt && a.uploadedAt.seconds ? a.uploadedAt.seconds : 0;
    const tb = b.uploadedAt && b.uploadedAt.seconds ? b.uploadedAt.seconds : 0;
    return tb - ta;
  });
}

function expSum(list) {
  return list.reduce((s, e) => s + (Number(e.amount) || 0), 0);
}

function expPeriodLabel() {
  if (!expFilterFrom && !expFilterTo) return "За всё время";
  const a = expFilterFrom ? fmtRU(parseISO(expFilterFrom)) : "начало";
  const b = expFilterTo ? fmtRU(parseISO(expFilterTo)) : fmtRU(new Date());
  return `${a} — ${b}`;
}

// ============================================================
// РАЗДЕЛ
// ============================================================
function renderExpensesSection(wrap) {
  subscribeExpenses();

  const editDoc = expEditId ? expensesCache.find((e) => e.id === expEditId) : null;
  if (expEditId && !editDoc) { expEditId = null; expSelectedFiles = []; expKeptFiles = []; }

  if (editDoc) {
    wrap.appendChild(renderExpenseForm(editDoc));
  } else {
    const addBtn = el("button", "w-full py-3 rounded-xl bg-diesel text-white font-semibold shadow-sm flex items-center justify-center gap-2",
      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg><span>Добавить счёт</span>`);
    addBtn.onclick = () => { expFormOpen = true; expSelectedFiles = []; render(); };
    wrap.appendChild(addBtn);
    if (expFormOpen) wrap.appendChild(renderExpenseForm(null));
  }

  // ---------- фильтр ----------
  const cats = expenseCategories();
  const trucks = expTrucks();
  const filterCard = el("div", "bg-white rounded-xl border border-slate-200 p-3 space-y-2");
  filterCard.innerHTML = `
    <div class="flex items-end gap-2">
      <label class="text-xs text-slate-500 flex-1">С даты
        <input id="exp-from" type="date" value="${expFilterFrom}" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
      </label>
      <label class="text-xs text-slate-500 flex-1">По дату
        <input id="exp-to" type="date" value="${expFilterTo}" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
      </label>
    </div>
    <div class="flex gap-2">
      <label class="text-xs text-slate-500 flex-1">Статья
        <select id="exp-cat" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white">
          <option value="">Все статьи</option>
          ${cats.map((c) => `<option value="${escapeHtml(c)}" ${c === expFilterCat ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
        </select>
      </label>
      <label class="text-xs text-slate-500 flex-1">Машина
        <select id="exp-truck" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white">
          <option value="">Все машины</option>
          <option value="__none__" ${expFilterTruck === "__none__" ? "selected" : ""}>Без машины (общее)</option>
          ${trucks.map((t) => `<option value="${escapeHtml(t)}" ${t === expFilterTruck ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}
        </select>
      </label>
    </div>`;
  const row = el("div", "flex items-center justify-between gap-2 pt-1");
  const unpaidBtn = el("button",
    `text-xs font-semibold px-2.5 py-1.5 rounded-lg border ${expOnlyUnpaid ? "bg-brick text-white border-brick" : "bg-white text-slate-500 border-slate-200"}`,
    "Только неоплаченные");
  unpaidBtn.onclick = () => { expOnlyUnpaid = !expOnlyUnpaid; render(); };
  row.appendChild(unpaidBtn);
  const clearBtn = el("button", "text-xs text-slate-400 underline", "Сбросить");
  clearBtn.onclick = () => {
    expFilterFrom = ""; expFilterTo = ""; expFilterCat = ""; expFilterTruck = ""; expOnlyUnpaid = false;
    render();
  };
  row.appendChild(clearBtn);
  filterCard.appendChild(row);
  wrap.appendChild(filterCard);
  setTimeout(() => {
    const f = document.getElementById("exp-from"), t = document.getElementById("exp-to");
    const c = document.getElementById("exp-cat"), tr = document.getElementById("exp-truck");
    if (f) f.onchange = () => { expFilterFrom = f.value; render(); };
    if (t) t.onchange = () => { expFilterTo = t.value; render(); };
    if (c) c.onchange = () => { expFilterCat = c.value; render(); };
    if (tr) tr.onchange = () => { expFilterTruck = tr.value; render(); };
  }, 0);

  const list = expFiltered();
  const total = expSum(list);
  const unpaid = list.filter((e) => !e.paid);

  // ---------- итог ----------
  const sumCard = el("div", "bg-diesel rounded-xl px-4 py-3 text-white");
  sumCard.innerHTML = `
    <div class="flex items-center justify-between gap-2">
      <div class="min-w-0">
        <div class="text-[11px] uppercase tracking-wide text-white/50">Расходы · ${escapeHtml(expPeriodLabel())}</div>
        <div class="text-xs text-white/70 font-num">${list.length} ${xlPlural(list.length, "счёт", "счёта", "счетов")}</div>
      </div>
      <div class="text-2xl font-bold font-num text-route shrink-0 pl-2">${expMoney(total)} ₽</div>
    </div>
    ${unpaid.length ? `<div class="mt-2 pt-2 border-t border-white/10 text-xs text-white/70">Не оплачено: <span class="font-num font-bold text-brick-300" style="color:#F2A93B">${expMoney(expSum(unpaid))} ₽</span> (${unpaid.length})</div>` : ""}`;
  wrap.appendChild(sumCard);

  // ---------- разбивка по статьям ----------
  if (list.length) {
    const byCat = {};
    list.forEach((e) => {
      const k = e.category || "Без статьи";
      byCat[k] = (byCat[k] || 0) + (Number(e.amount) || 0);
    });
    const cards = el("div", "bg-white rounded-xl border border-slate-200 p-3 space-y-2");
    cards.appendChild(el("div", "text-xs font-bold text-slate-500 uppercase tracking-wide", "По статьям"));
    Object.entries(byCat).sort((a, b) => b[1] - a[1]).forEach(([name, sum]) => {
      const pct = total ? Math.round((sum / total) * 100) : 0;
      const r = el("div", "");
      r.innerHTML = `
        <div class="flex items-center justify-between text-sm">
          <span class="text-slate-700 truncate pr-2">${escapeHtml(name)}</span>
          <span class="font-num font-semibold text-slate-800 shrink-0">${expMoney(sum)} ₽</span>
        </div>
        <div class="h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden">
          <div class="h-full bg-route rounded-full" style="width:${pct}%"></div>
        </div>`;
      cards.appendChild(r);
    });
    wrap.appendChild(cards);

    // ---------- разбивка по машинам ----------
    const byTruck = {};
    list.forEach((e) => {
      const k = e.truck || "Общее (без машины)";
      byTruck[k] = (byTruck[k] || 0) + (Number(e.amount) || 0);
    });
    if (Object.keys(byTruck).length > 1) {
      const tc = el("div", "bg-white rounded-xl border border-slate-200 p-3 space-y-1.5");
      tc.appendChild(el("div", "text-xs font-bold text-slate-500 uppercase tracking-wide mb-1", "По машинам"));
      Object.entries(byTruck).sort((a, b) => b[1] - a[1]).forEach(([name, sum]) => {
        const r = el("div", "flex items-center justify-between text-sm");
        r.innerHTML = `<span class="text-slate-700 truncate pr-2">${escapeHtml(name)}${truckPlate(name) ? ` <span class="text-slate-300 font-num">${escapeHtml(truckPlate(name))}</span>` : ""}</span><span class="font-num font-semibold text-slate-800 shrink-0">${expMoney(sum)} ₽</span>`;
        tc.appendChild(r);
      });
      wrap.appendChild(tc);
    }

    const exp = el("button", "w-full py-2.5 rounded-xl bg-white border border-diesel text-diesel text-sm font-semibold flex items-center justify-center gap-2",
      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13m0 0-4-4m4 4 4-4"/><path d="M4 19h16"/></svg>Скачать расходы (${list.length})`);
    exp.onclick = () => exportExpensesExcel(list);
    wrap.appendChild(exp);
  }

  if (!list.length) {
    wrap.appendChild(el("div", "text-center text-slate-400 text-sm py-8",
      expensesCache.length
        ? "По этому фильтру счетов нет."
        : "Счетов пока нет. Добавь первый — приложение само разложит расходы по статьям и машинам."));
    return;
  }

  list.forEach((e) => wrap.appendChild(expenseCard(e)));
}

// ---------- карточка счёта ----------
function expenseCard(rec) {
  const card = el("div", `bg-white rounded-xl border overflow-hidden ${rec.paid ? "border-slate-200" : "border-brick/40"}`);
  const body = el("div", "p-3");

  const top = el("div", "flex items-start justify-between gap-2");
  top.innerHTML = `
    <div class="min-w-0">
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-diesel/10 text-diesel border border-diesel/25">${escapeHtml(rec.category || "Без статьи")}</span>
        ${rec.paid
          ? `<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-shift/15 text-shift border border-shift/30">ОПЛАЧЕН</span>`
          : `<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-brick text-white">НЕ ОПЛАЧЕН</span>`}
        <span class="text-xs text-slate-400 font-num">${rec.date ? fmtRU(parseISO(rec.date)) : ""}</span>
      </div>
      <div class="font-bold text-slate-800 mt-1 truncate">${escapeHtml(rec.supplier || "Поставщик не указан")}</div>
      <div class="text-xs text-slate-500">${rec.invoiceNumber ? `счёт № ${escapeHtml(rec.invoiceNumber)}` : "без номера"}${rec.truck ? ` · ${escapeHtml(rec.truck)}` : ""}</div>
    </div>
    <div class="text-right shrink-0 pl-2">
      <div class="text-lg font-bold font-num text-slate-800">${expMoney(rec.amount)} ₽</div>
      ${rec.vat ? `<div class="text-[10px] text-slate-400">с НДС</div>` : `<div class="text-[10px] text-slate-400">без НДС</div>`}
    </div>`;
  body.appendChild(top);

  if (rec.note) {
    body.appendChild(el("div", "text-sm text-slate-600 mt-1.5 whitespace-pre-wrap break-words", escapeHtml(rec.note)));
  }

  // ---------- файлы счёта ----------
  const files = rec.files || [];
  if (files.length) {
    const fw = el("div", "mt-2 space-y-1.5");
    files.forEach((f) => {
      if (f.kind === "image") {
        const img = el("img", "w-full max-h-48 object-contain rounded-lg bg-slate-50 cursor-pointer");
        img.src = f.url;
        img.onclick = () => {
          if (typeof openLightbox === "function") {
            openLightbox(files.filter((x) => x.kind === "image").map((x) => x.url));
          }
        };
        fw.appendChild(img);
      } else {
        const a = el("a", "flex items-center gap-2 px-2.5 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm text-diesel font-semibold");
        a.href = f.url;
        a.target = "_blank";
        a.rel = "noopener";
        a.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><path d="M6 2h9l5 5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 20V3.5A1.5 1.5 0 0 1 6 2z"/><path d="M14 2v5h5"/></svg><span class="truncate">${escapeHtml(f.name || "Счёт.pdf")}</span>`;
        fw.appendChild(a);
      }
    });
    body.appendChild(fw);
  }

  body.appendChild(el("div", "text-[10px] text-slate-300 mt-1.5", `внёс(ла): ${escapeHtml(rec.uploadedByName || "")}`));
  if (rec.editedByName) {
    body.appendChild(el("div", "text-[10px] text-route", `исправил(а): ${escapeHtml(rec.editedByName)}`));
  }
  card.appendChild(body);

  // ---------- действия ----------
  const actions = el("div", "border-t border-slate-100 px-3 py-2 flex items-center gap-2 flex-wrap");
  if (!rec.paid) {
    const pay = el("button", "text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-shift text-white", "Отметить оплаченным");
    pay.onclick = async () => {
      if (!navigator.onLine) return alert("Для этого нужен интернет.");
      pay.disabled = true; pay.textContent = "…";
      try {
        await db.collection("expenseDocs").doc(rec.id).update({
          paid: true,
          paidDate: expTodayISO(),
          paidByName: currentProfile.name,
        });
      } catch (e) {
        pay.disabled = false; pay.textContent = "Отметить оплаченным";
        alert("Не получилось: " + e.message);
      }
    };
    actions.appendChild(pay);
  } else {
    const unpay = el("button", "text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-500", "Вернуть в неоплаченные");
    unpay.onclick = async () => {
      if (!navigator.onLine) return alert("Для этого нужен интернет.");
      try {
        await db.collection("expenseDocs").doc(rec.id).update({ paid: false, paidDate: null, paidByName: null });
      } catch (e) { alert("Не получилось: " + e.message); }
    };
    actions.appendChild(unpay);
  }

  const edit = el("button", "text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-500", "Исправить");
  edit.onclick = () => {
    expEditId = rec.id;
    expFormOpen = false;
    expSelectedFiles = [];
    expKeptFiles = (rec.files || []).slice();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  actions.appendChild(edit);

  const del = el("button", "text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-400 ml-auto", "Удалить");
  del.onclick = () => {
    if (confirm("Удалить этот счёт из расходов?")) db.collection("expenseDocs").doc(rec.id).delete();
  };
  actions.appendChild(del);
  card.appendChild(actions);

  return card;
}

// ============================================================
// ФОРМА СЧЁТА
// ============================================================
function renderExpenseForm(editDoc) {
  const card = el("div", `bg-white rounded-xl border-2 ${editDoc ? "border-route" : "border-diesel"} p-4 space-y-3`);
  const cats = expenseCategories();
  if (editDoc && editDoc.category && !cats.includes(editDoc.category)) cats.push(editDoc.category);
  const trucks = expTrucks();
  if (editDoc && editDoc.truck && !trucks.includes(editDoc.truck)) trucks.push(editDoc.truck);

  card.innerHTML = `
    <div class="font-bold text-slate-700">${editDoc ? "Исправить счёт" : "Новый счёт"}</div>
    <label class="block text-xs text-slate-500">Дата счёта
      <input id="ex-date" type="date" value="${editDoc ? (editDoc.date || "") : expTodayISO()}" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
    </label>
    <label class="block text-xs text-slate-500">Статья расходов
      <select id="ex-cat" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white">
        <option value="">Выбери статью</option>
        ${cats.map((c) => `<option value="${escapeHtml(c)}" ${editDoc && editDoc.category === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
      </select>
    </label>
    <label class="block text-xs text-slate-500">Поставщик
      <input id="ex-supplier" value="${editDoc ? escapeHtml(editDoc.supplier || "") : ""}" placeholder="напр. ООО «Автодеталь»" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
    </label>
    <div class="flex gap-2">
      <label class="block text-xs text-slate-500 flex-1">Номер счёта
        <input id="ex-num" value="${editDoc ? escapeHtml(editDoc.invoiceNumber || "") : ""}" placeholder="напр. 1542" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
      </label>
      <label class="block text-xs text-slate-500 flex-1">Сумма, ₽
        <input id="ex-amount" type="number" inputmode="decimal" min="0" step="0.01" value="${editDoc && editDoc.amount != null ? editDoc.amount : ""}" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-num" />
      </label>
    </div>
    <label class="flex items-center gap-2 text-xs text-slate-600">
      <input id="ex-vat" type="checkbox" ${!editDoc || editDoc.vat ? "checked" : ""} class="w-4 h-4" />
      Сумма указана с НДС
    </label>
    <label class="block text-xs text-slate-500">Машина <span class="text-slate-300">— если расход на конкретную</span>
      <select id="ex-truck" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white">
        <option value="">Общее, без привязки к машине</option>
        ${trucks.map((t) => `<option value="${escapeHtml(t)}" ${editDoc && editDoc.truck === t ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}
      </select>
    </label>
    <label class="block text-xs text-slate-500">Что купили или сделали
      <textarea id="ex-note" rows="2" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm resize-none" placeholder="коротко: колодки передние, 2 комплекта">${editDoc ? escapeHtml(editDoc.note || "") : ""}</textarea>
    </label>
    <label class="flex items-center gap-2 text-xs text-slate-600">
      <input id="ex-paid" type="checkbox" ${editDoc && editDoc.paid ? "checked" : ""} class="w-4 h-4" />
      Счёт уже оплачен
    </label>
    <div>
      <div class="flex items-center justify-between mb-1">
        <div class="text-xs text-slate-500">Файл счёта — PDF или фото</div>
        <div id="ex-count" class="text-xs text-slate-400 font-medium">0 / ${EXP_MAX_FILES}</div>
      </div>
      <div class="flex gap-2">
        <button type="button" id="ex-pick" class="flex-1 py-2.5 rounded-lg bg-diesel-700 text-white text-sm font-semibold">Выбрать файл</button>
        <button type="button" id="ex-cam" class="flex-1 py-2.5 rounded-lg bg-slate-100 text-slate-600 text-sm font-semibold">Сфотографировать</button>
      </div>
      <input id="ex-file-i" type="file" accept="application/pdf,image/*" multiple class="hidden" />
      <input id="ex-cam-i" type="file" accept="image/*" capture="environment" class="hidden" />
      <div id="ex-files" class="space-y-1.5 mt-2"></div>
      <div id="ex-parse-hint" class="hidden mt-2"></div>
      <div class="text-[11px] text-slate-400 mt-1.5">Если счёт — PDF из бухгалтерии, приложение само прочитает сумму, номер и дату. Со сканом и фотографией так не выйдет: там текста нет.</div>
    </div>
    <div id="ex-err" class="text-xs text-rose-600 hidden"></div>
    <div class="flex gap-2 pt-1">
      <button id="ex-save" class="flex-1 py-2.5 rounded-lg bg-diesel text-white font-semibold text-sm">${editDoc ? "Сохранить" : "Добавить в расходы"}</button>
      <button id="ex-cancel" class="px-4 py-2.5 rounded-lg bg-slate-100 text-slate-500 font-semibold text-sm">Отмена</button>
    </div>`;

  // ---------- файлы ----------
  const fileI = card.querySelector("#ex-file-i");
  const camI = card.querySelector("#ex-cam-i");
  const pickB = card.querySelector("#ex-pick");
  const camB = card.querySelector("#ex-cam");
  const countEl = card.querySelector("#ex-count");
  const listEl = card.querySelector("#ex-files");
  const kept = editDoc ? expKeptFiles : [];

  function total() { return kept.length + expSelectedFiles.length; }
  function paintFiles() {
    countEl.textContent = `${total()} / ${EXP_MAX_FILES}`;
    const full = total() >= EXP_MAX_FILES;
    pickB.disabled = full; camB.disabled = full;
    pickB.classList.toggle("opacity-40", full); camB.classList.toggle("opacity-40", full);
    listEl.innerHTML = "";
    kept.forEach((f, i) => {
      const r = el("div", "flex items-center gap-2 px-2.5 py-2 rounded-lg bg-slate-50 border border-slate-200");
      r.innerHTML = `<span class="text-xs text-slate-600 truncate flex-1">${escapeHtml(f.name || (f.kind === "image" ? "фото" : "счёт.pdf"))}</span>`;
      const rm = el("button", "text-slate-300 text-sm shrink-0", "✕");
      rm.type = "button";
      rm.onclick = () => { kept.splice(i, 1); paintFiles(); };
      r.appendChild(rm);
      listEl.appendChild(r);
    });
    expSelectedFiles.forEach((f, i) => {
      const r = el("div", "flex items-center gap-2 px-2.5 py-2 rounded-lg bg-shift/10 border border-shift/30");
      r.innerHTML = `<span class="text-xs text-slate-700 truncate flex-1">${escapeHtml(f.name)}</span><span class="text-[10px] text-shift shrink-0">новый</span>`;
      const rm = el("button", "text-slate-300 text-sm shrink-0", "✕");
      rm.type = "button";
      rm.onclick = () => { expSelectedFiles.splice(i, 1); paintFiles(); };
      r.appendChild(rm);
      listEl.appendChild(r);
    });
  }
  // ---------- подстановка из PDF ----------
  // Читаем текстовый слой счёта и заполняем ПУСТЫЕ поля. Заполненные
  // руками не трогаем: человек главнее разбора. Что подставили —
  // показываем списком, чтобы было понятно, что именно проверять.
  const hintBox = card.querySelector("#ex-parse-hint");
  function showHint(cls, html) {
    hintBox.className = "text-[11px] rounded-lg px-2.5 py-2 " + cls;
    hintBox.innerHTML = html;
    hintBox.classList.remove("hidden");
  }
  async function tryParseInvoice(file) {
    if (typeof parseInvoiceFile !== "function") return;
    showHint("bg-slate-50 text-slate-500 border border-slate-200", "Читаю счёт…");
    const res = await parseInvoiceFile(file);
    if (!res.ok) {
      if (res.reason === "no-text") {
        showHint("bg-route/10 text-slate-600 border border-route/30",
          "В этом файле нет текста — похоже, скан или фотография. Сумму и номер впиши руками.");
      } else if (res.reason === "error") {
        showHint("bg-route/10 text-slate-600 border border-route/30",
          "Не получилось разобрать счёт — заполни поля руками." + (res.message ? ` (${escapeHtml(res.message)})` : ""));
      } else {
        hintBox.classList.add("hidden");
      }
      return;
    }
    const filled = [];
    const setIfEmpty = (sel, val, label) => {
      if (val == null || val === "") return;
      const inp = card.querySelector(sel);
      if (!inp || String(inp.value).trim() !== "") return;
      inp.value = val;
      inp.classList.add("bg-route/10", "border-route");
      filled.push(label);
    };
    setIfEmpty("#ex-amount", res.amount, "сумму");
    setIfEmpty("#ex-num", res.invoiceNumber, "номер счёта");
    setIfEmpty("#ex-supplier", res.supplier, "поставщика");
    if (res.date) {
      const d = card.querySelector("#ex-date");
      // дату подставляем, даже если там стоит сегодняшняя по умолчанию:
      // дата счёта почти всегда не сегодняшняя
      if (!editDoc && d.value !== res.date) {
        d.value = res.date;
        d.classList.add("bg-route/10", "border-route");
        filled.push("дату");
      }
    }
    if (res.vat !== null) card.querySelector("#ex-vat").checked = res.vat;

    if (filled.length) {
      showHint("bg-shift/10 text-slate-700 border border-shift/30",
        `<b>Подставил из счёта:</b> ${filled.join(", ")}. Проверь глазами — подсвеченные поля можно поправить.`);
    } else {
      showHint("bg-route/10 text-slate-600 border border-route/30",
        "Счёт прочитал, но сумму и номер в нём не нашёл — впиши руками.");
    }
  }

  function addFiles(fl) {
    const errBox = card.querySelector("#ex-err");
    let firstPdf = null;
    for (const f of fl) {
      if (total() >= EXP_MAX_FILES) break;
      if (f.size > EXP_MAX_FILE_MB * 1024 * 1024) {
        errBox.textContent = `Файл «${f.name}» больше ${EXP_MAX_FILE_MB} МБ — такой не загрузится.`;
        errBox.classList.remove("hidden");
        continue;
      }
      expSelectedFiles.push(f);
      if (!firstPdf && (/pdf/i.test(f.type || "") || /\.pdf$/i.test(f.name || ""))) firstPdf = f;
    }
    paintFiles();
    if (firstPdf) tryParseInvoice(firstPdf);
  }
  pickB.onclick = () => { if (total() < EXP_MAX_FILES) fileI.click(); };
  camB.onclick = () => { if (total() < EXP_MAX_FILES) camI.click(); };
  fileI.onchange = (e) => { addFiles(e.target.files); fileI.value = ""; };
  camI.onchange = (e) => { addFiles(e.target.files); camI.value = ""; };
  paintFiles();

  function close() {
    expFormOpen = false; expEditId = null;
    expSelectedFiles = []; expKeptFiles = [];
    render();
  }
  card.querySelector("#ex-cancel").onclick = close;

  card.querySelector("#ex-save").onclick = async () => {
    const err = card.querySelector("#ex-err");
    const btn = card.querySelector("#ex-save");
    const fail = (m) => {
      err.textContent = m; err.classList.remove("hidden");
      btn.disabled = false; btn.textContent = editDoc ? "Сохранить" : "Добавить в расходы";
    };

    const date = card.querySelector("#ex-date").value;
    const category = card.querySelector("#ex-cat").value;
    const supplier = card.querySelector("#ex-supplier").value.trim();
    const invoiceNumber = card.querySelector("#ex-num").value.trim();
    const amount = Number(card.querySelector("#ex-amount").value);
    const vat = card.querySelector("#ex-vat").checked;
    const truck = card.querySelector("#ex-truck").value;
    const note = card.querySelector("#ex-note").value.trim();
    const paid = card.querySelector("#ex-paid").checked;

    if (!date) return fail("Поставь дату счёта.");
    if (!category) return fail("Выбери статью расходов.");
    if (!(amount > 0)) return fail("Впиши сумму счёта — это она попадёт в расходы.");
    if (amount > 100000000) return fail("Сумма выглядит неправильно — проверь, не лишний ли ноль.");
    // счета вносит руководитель за столом, а не водитель в поле, поэтому
    // офлайн-очередь здесь не нужна: лучше честно сказать, что нужен интернет
    if (!navigator.onLine) return fail("Для сохранения счёта нужен интернет.");

    err.classList.add("hidden");
    btn.disabled = true;

    try {
      const files = kept.slice();
      for (let i = 0; i < expSelectedFiles.length; i++) {
        const f = expSelectedFiles[i];
        btn.textContent = `Загружаю файл ${i + 1}/${expSelectedFiles.length}…`;
        files.push(await uploadExpenseFile(f));
      }

      const payload = {
        date, category, supplier, invoiceNumber,
        amount, vat, truck, note, paid,
        paidDate: paid ? (editDoc && editDoc.paidDate ? editDoc.paidDate : expTodayISO()) : null,
        files,
      };

      btn.textContent = "Сохраняю…";
      if (editDoc) {
        // автора и дату внесения не трогаем, правка помечается отдельно
        await db.collection("expenseDocs").doc(editDoc.id).update({
          ...payload,
          editedByUid: currentUser.uid,
          editedByName: currentProfile.name,
          editedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        await db.collection("expenseDocs").add({
          ...payload,
          uploadedByUid: currentUser.uid,
          uploadedByName: currentProfile.name,
          uploadedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      }
      close();
    } catch (e) {
      fail("Не получилось сохранить: " + e.message);
    }
  };

  return card;
}

// Загрузка файла счёта в Cloudinary.
// Картинку прогоняем через то же сжатие, что фото ТТН. PDF и прочие файлы
// шлём как есть в raw/upload: обычный image/upload для PDF у бесплатных
// аккаунтов Cloudinary часто закрыт на отдачу, а raw отдаётся как файл.
function uploadExpenseFile(file) {
  const isImage = (file.type || "").startsWith("image/");
  if (isImage) {
    return resizeImage(file)
      .then((blob) => uploadToCloudinary(blob))
      .then((url) => ({ url, name: file.name || "фото", kind: "image" }));
  }
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  return fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/raw/upload`, {
    method: "POST", body: fd,
  }).then((r) => r.json()).then((data) => {
    if (!data.secure_url) {
      const msg = data.error?.message || "неизвестная ошибка";
      throw new Error(
        `Cloudinary не принял файл (${msg}). Если это повторяется со всеми PDF — ` +
        `в Cloudinary надо открыть пресету «${CLOUDINARY_UPLOAD_PRESET}» загрузку файлов, а не только картинок.`
      );
    }
    return { url: data.secure_url, name: file.name || "счёт.pdf", kind: "file" };
  });
}

// ============================================================
// ВЫГРУЗКА РАСХОДОВ В EXCEL
// ============================================================
function exportExpensesExcel(list) {
  if (typeof XLSX === "undefined" || typeof xlBuildSheet !== "function") {
    alert("Не удалось загрузить модуль Excel — проверь интернет и попробуй ещё раз.");
    return;
  }
  if (!list.length) { alert("Счетов нет."); return; }

  const money = { align: "right", numFmt: "#,##0.00" };
  const lines = [`Период: ${expPeriodLabel()}`];
  if (expFilterCat) lines.push(`Статья: ${expFilterCat}`);
  if (expFilterTruck) lines.push(`Машина: ${expFilterTruck === "__none__" ? "без привязки" : expFilterTruck}`);
  if (expOnlyUnpaid) lines.push("Показаны только неоплаченные");

  const sorted = list.slice().sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

  // ---- лист 1: все счета ----
  const ws1 = xlBuildSheet({
    title: "РАСХОДЫ",
    subtitle: "Перевозка железной руды · п. Досатуй, Забайкальский край",
    lines,
    columns: [
      { title: "№", width: 5, align: "center" },
      { title: "Дата", width: 12, align: "center" },
      { title: "Статья", width: 20, wrap: true },
      { title: "Поставщик", width: 26, wrap: true },
      { title: "Счёт №", width: 12, align: "center" },
      { title: "Машина", width: 16 },
      { title: "Что купили / сделали", width: 34, wrap: true },
      { title: "Сумма, ₽", width: 14, ...money },
      { title: "Оплачен", width: 11, align: "center" },
    ],
    rows: sorted.map((e, i) => [
      i + 1,
      e.date ? fmtRU(parseISO(e.date)) : "",
      e.category || "",
      e.supplier || "",
      e.invoiceNumber || "",
      e.truck || "общее",
      e.note || "",
      Number(e.amount) || 0,
      e.paid ? "да" : "НЕТ",
    ]),
    total: {
      label: `ИТОГО: ${sorted.length} ${xlPlural(sorted.length, "счёт", "счёта", "счетов")}`,
      span: 7,
      values: { 7: expSum(sorted) },
    },
    footnote: "Суммы по счетам внесены вручную; файлы счетов хранятся в приложении.",
  });

  // ---- лист 2: свод по статьям и машинам ----
  const byCat = {}, byTruck = {};
  sorted.forEach((e) => {
    const c = e.category || "Без статьи";
    byCat[c] = (byCat[c] || 0) + (Number(e.amount) || 0);
    const t = e.truck || "Общее (без машины)";
    byTruck[t] = (byTruck[t] || 0) + (Number(e.amount) || 0);
  });
  const catRows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const truckRows = Object.entries(byTruck).sort((a, b) => b[1] - a[1]);
  const totalSum = expSum(sorted);

  const ws2 = xlBuildSheet({
    title: "СВОД ПО СТАТЬЯМ",
    subtitle: "Перевозка железной руды · п. Досатуй, Забайкальский край",
    lines,
    columns: [
      { title: "Статья расходов", width: 30, wrap: true },
      { title: "Счетов", width: 10, align: "center" },
      { title: "Сумма, ₽", width: 16, ...money },
      { title: "Доля", width: 10, align: "center" },
    ],
    rows: catRows.map(([name, sum]) => [
      name,
      sorted.filter((e) => (e.category || "Без статьи") === name).length,
      sum,
      totalSum ? Math.round((sum / totalSum) * 100) + " %" : "",
    ]),
    total: { label: "ИТОГО", span: 2, values: { 2: totalSum } },
  });

  const wb = XLSX.utils.book_new();
  xlAppendSheet(wb, ws1, "Расходы", { landscape: true });
  xlAppendSheet(wb, ws2, "По статьям");

  // ---- лист 3: по машинам ----
  if (truckRows.length > 1) {
    const ws3 = xlBuildSheet({
      title: "СВОД ПО МАШИНАМ",
      subtitle: "Перевозка железной руды · п. Досатуй, Забайкальский край",
      lines,
      columns: [
        { title: "Машина", width: 24 },
        { title: "Гос. номер", width: 14, align: "center" },
        { title: "Счетов", width: 10, align: "center" },
        { title: "Сумма, ₽", width: 16, ...money },
      ],
      rows: truckRows.map(([name, sum]) => [
        name,
        truckPlate(name),
        sorted.filter((e) => (e.truck || "Общее (без машины)") === name).length,
        sum,
      ]),
      total: { label: "ИТОГО", span: 3, values: { 3: totalSum } },
    });
    xlAppendSheet(wb, ws3, "По машинам");
  }

  const tag = (expFilterFrom || expFilterTo)
    ? `${expFilterFrom || "начало"}-${expFilterTo || "сегодня"}`
    : "все";
  xlSaveFile(wb, xlFileName(["Расходы", "Досатуй", tag]));
}
