// ============================================================
// ТАБЕЛЬ — автоматический расчёт смен и оплаты
// 1 ТТН = 1 смена = 6 000 ₽. ТО/ремонт: один — 6 000 ₽ ему,
// двое — по 3 000 ₽ каждому. Данные берутся из вкладки «ТТН»
// (оба режима — ТТН и ТО/Ремонт), считать вручную не нужно.
//
// Два режима периода:
//   • по месяцу  — стрелки ‹ ›, как было раньше (по умолчанию);
//   • по периоду — как только задана хотя бы одна дата в фильтре,
//     период перебивает месяц и считается ровно по датам.
// Плюс фильтр по водителям: можно оставить только нужных.
// Выгрузка в Excel идёт ровно по тем же фильтрам, что видны на
// экране — что показано, то и скачается.
// ============================================================

let timesheetMonthDate = new Date();
let timesheetExpanded = {}; // { nameKey: true } — раскрытые карточки
let tsFrom = "";            // фильтр «с даты», ISO "YYYY-MM-DD"
let tsTo = "";              // фильтр «по дату»
let tsDrivers = {};         // { nameKey: true } — выбранные водители; пусто = все

function inSelectedMonth(isoDate, year, month) {
  if (!isoDate) return false;
  const parts = isoDate.split("-");
  if (parts.length < 2) return false;
  const y = parseInt(parts[0], 10), m = parseInt(parts[1], 10) - 1;
  return y === year && m === month;
}

function inDateRange(isoDate, fromV, toV) {
  if (!isoDate) return false;
  if (fromV && isoDate < fromV) return false;
  if (toV && isoDate > toV) return false;
  return true;
}

function pluralShift(n) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "а";
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return "ы";
  return "";
}

// склонение «водитель»: 1 водитель, 2–4 водителя, 5+ водителей.
// Своё, а не xlPlural из xl-sheet.js — экран должен рисоваться даже
// если файл оформления Excel почему-то не подгрузился.
function pluralDriver(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "ь";
  if ([2, 3, 4].includes(m10) && ![12, 13, 14].includes(m100)) return "я";
  return "ей";
}

// Полный список людей, которые вообще встречаются в системе:
// водители из настроек + все, кто попадался в ТТН и в ТО/ремонтах
// (в том числе те, кто уже не работает — за старый период реестр
// тоже должен собираться). Ключ — nameKey, значение — самое полное
// написание ФИО, чтобы в реестре было «Мусаев Абдула Могомедович»,
// даже если в части ТТН записано короче.
function timesheetRoster() {
  const byKey = {};
  function add(name) {
    const n = String(name || "").trim();
    if (!n) return;
    const k = nameKey(n);
    if (!k) return;
    if (!byKey[k] || n.length > byKey[k].length) byKey[k] = n;
  }
  (STATE.drivers || []).forEach((d) => add(d.name));
  docsCache.forEach((d) => add(d.driverName));
  maintenanceCache.forEach((m) => { add(m.primaryWorker); add(m.secondaryWorker); });
  return byKey;
}

// Считает табель по любому условию на дату. Группировка — по nameKey,
// иначе один и тот же человек с отчеством и без расползается на две
// карточки (и на две строки в реестре, который уходит руководителю).
function computeTimesheetBy(matchFn) {
  const perDriver = {};
  const roster = timesheetRoster();
  function ensure(rawName) {
    const n = String(rawName || "").trim() || "—";
    const k = nameKey(n) || "—";
    if (!perDriver[k]) {
      perDriver[k] = { key: k, name: roster[k] || n, shifts: [], shiftPay: 0, maint: [], maintPay: 0 };
    }
    return perDriver[k];
  }
  docsCache.forEach((d) => {
    if (!matchFn(d.ttnDate)) return;
    const rec = ensure(d.driverName);
    rec.shifts.push(d);
    rec.shiftPay += 6000;
  });
  maintenanceCache.forEach((m) => {
    if (!matchFn(m.date)) return;
    const workers = [m.primaryWorker, m.secondaryWorker].filter(Boolean);
    const share = maintShare(m, workers.length);
    workers.forEach((w) => {
      const rec = ensure(w);
      rec.maint.push(m);
      rec.maintPay += share;
    });
  });
  return perDriver;
}

// прежняя сигнатура — ею пользуется вкладка «Статистика»
function computeTimesheet(year, month) {
  return computeTimesheetBy((iso) => inSelectedMonth(iso, year, month));
}

function renderTimesheet() {
  app.innerHTML = "";
  const wrap = el("div", "space-y-3");

  const periodMode = !!(tsFrom || tsTo);
  const year = timesheetMonthDate.getFullYear();
  const month = timesheetMonthDate.getMonth();

  // ---------- строка периода ----------
  const headRow = el("div", "bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between gap-2");
  if (periodMode) {
    const fromLabel = tsFrom ? fmtRU(parseISO(tsFrom)) : "начало";
    const toLabel = tsTo ? fmtRU(parseISO(tsTo)) : fmtRU(new Date());
    headRow.appendChild(el("div", "min-w-0",
      `<div class="text-[11px] uppercase tracking-wide text-slate-400">Период</div>
       <div class="font-bold text-slate-700 font-num text-sm truncate">${fromLabel} — ${toLabel}</div>`));
    const backBtn = el("button", "text-xs text-slate-400 underline shrink-0", "к месяцу");
    backBtn.onclick = () => { tsFrom = ""; tsTo = ""; render(); };
    headRow.appendChild(backBtn);
  } else {
    const prevBtn = el("button", "text-slate-400 text-2xl w-9 h-9 flex items-center justify-center", "‹");
    const nextBtn = el("button", "text-slate-400 text-2xl w-9 h-9 flex items-center justify-center", "›");
    prevBtn.onclick = () => { timesheetMonthDate = new Date(year, month - 1, 1); render(); };
    nextBtn.onclick = () => { timesheetMonthDate = new Date(year, month + 1, 1); render(); };
    headRow.appendChild(prevBtn);
    headRow.appendChild(el("div", "font-bold text-slate-700", `${MONTHS_RU[month]} ${year}`));
    headRow.appendChild(nextBtn);
  }
  wrap.appendChild(headRow);

  // ---------- фильтр по датам ----------
  const filterCard = el("div", "bg-white rounded-xl border border-slate-200 p-3 flex items-end gap-2");
  filterCard.innerHTML = `
    <label class="text-xs text-slate-500 flex-1">С даты
      <input id="ts-filter-from" type="date" value="${tsFrom}" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
    </label>
    <label class="text-xs text-slate-500 flex-1">По дату
      <input id="ts-filter-to" type="date" value="${tsTo}" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
    </label>`;
  const clearBtn = el("button", "text-xs text-slate-400 underline shrink-0 pb-1.5", "Сбросить");
  clearBtn.onclick = () => { tsFrom = ""; tsTo = ""; tsDrivers = {}; render(); };
  filterCard.appendChild(clearBtn);
  wrap.appendChild(filterCard);
  setTimeout(() => {
    const fFrom = document.getElementById("ts-filter-from");
    const fTo = document.getElementById("ts-filter-to");
    if (fFrom) fFrom.onchange = () => { tsFrom = fFrom.value; render(); };
    if (fTo) fTo.onchange = () => { tsTo = fTo.value; render(); };
  }, 0);

  // ---------- данные за период ----------
  const matchFn = periodMode
    ? (iso) => inDateRange(iso, tsFrom, tsTo)
    : (iso) => inSelectedMonth(iso, year, month);
  const perDriver = computeTimesheetBy(matchFn);
  const roster = timesheetRoster();

  // ---------- фильтр по водителям ----------
  // чипсы строим по всему списку людей, а не только по тем, у кого есть
  // записи в периоде — иначе выбранный водитель исчезал бы из фильтра
  // при смене даты и его нельзя было бы снять
  const rosterKeys = Object.keys(roster).sort((a, b) => roster[a].localeCompare(roster[b], "ru"));
  const pickedKeys = Object.keys(tsDrivers).filter((k) => tsDrivers[k]);

  if (rosterKeys.length > 1) {
    const drvCard = el("div", "bg-white rounded-xl border border-slate-200 p-3");
    const drvHead = el("div", "flex items-center justify-between mb-2");
    drvHead.appendChild(el("div", "text-xs text-slate-500",
      pickedKeys.length ? `Водители: выбрано ${pickedKeys.length}` : "Водители: все"));
    if (pickedKeys.length) {
      const allBtn = el("button", "text-xs text-slate-400 underline", "показать всех");
      allBtn.onclick = () => { tsDrivers = {}; render(); };
      drvHead.appendChild(allBtn);
    }
    drvCard.appendChild(drvHead);

    const chips = el("div", "flex flex-wrap gap-1.5");
    rosterKeys.forEach((k) => {
      const rec = perDriver[k];
      const cnt = rec ? rec.shifts.length + rec.maint.length : 0;
      const on = !!tsDrivers[k];
      const short = roster[k].trim().split(/\s+/).slice(0, 2).join(" ");
      const chip = el("button",
        `px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
          on ? "bg-diesel text-white border-diesel"
             : cnt ? "bg-white text-slate-600 border-slate-200"
                   : "bg-white text-slate-300 border-slate-100"}`,
        `${escapeHtml(short)} <span class="font-num ${on ? "text-white/60" : "text-slate-400"}">${cnt}</span>`);
      chip.onclick = () => {
        if (tsDrivers[k]) delete tsDrivers[k]; else tsDrivers[k] = true;
        render();
      };
      chips.appendChild(chip);
    });
    drvCard.appendChild(chips);
    wrap.appendChild(drvCard);
  }

  // ---------- что показываем ----------
  const allKeys = Object.keys(perDriver).sort((a, b) => perDriver[a].name.localeCompare(perDriver[b].name, "ru"));
  const visibleKeys = pickedKeys.length ? allKeys.filter((k) => tsDrivers[k]) : allKeys;
  const isManager = currentProfile?.role === "manager";
  // табель открыт всем — водители видят и свои деньги, и напарников

  const periodLine = periodMode
    ? `Период: ${tsFrom ? fmtRU(parseISO(tsFrom)) : "начало"} — ${tsTo ? fmtRU(parseISO(tsTo)) : fmtRU(new Date())}`
    : `Месяц: ${MONTHS_RU[month]} ${year}`;
  const fileTag = periodMode
    ? `${tsFrom ? fmtRU(parseISO(tsFrom)) : "начало"}-${tsTo ? fmtRU(parseISO(tsTo)) : fmtRU(new Date())}`
    : `${MONTHS_RU[month]}_${year}`;

  // ---------- кнопка выгрузки ----------
  if (visibleKeys.length && isManager) {
    const regBtn = el("button", "w-full py-2.5 rounded-xl bg-white border border-diesel text-diesel text-sm font-semibold flex items-center justify-center gap-2",
      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13m0 0-4-4m4 4 4-4"/><path d="M4 19h16"/></svg>Скачать табель (${visibleKeys.length})`);
    regBtn.onclick = () => exportTimesheetToExcel(perDriver, visibleKeys, periodLine, fileTag, pickedKeys.length > 0);
    wrap.appendChild(regBtn);
    wrap.appendChild(el("div", "text-[11px] text-slate-400 -mt-1 px-1",
      periodMode
        ? "В файл попадёт ровно то, что показано на экране."
        : `Период не задан — выгрузится ${MONTHS_RU[month].toLowerCase()} ${year}. Поставь даты выше, чтобы скачать за нужные дни.`));
  }

  // ---------- итог по выбранным ----------
  if (visibleKeys.length) {
    let tShifts = 0, tMaint = 0, tMoney = 0;
    visibleKeys.forEach((k) => {
      const r = perDriver[k];
      tShifts += r.shifts.length;
      tMaint += r.maint.length;
      tMoney += r.shiftPay + r.maintPay;
    });
    const sumCard = el("div", "bg-diesel rounded-xl px-4 py-3 flex items-center justify-between text-white");
    sumCard.innerHTML = `
      <div class="min-w-0">
        <div class="text-[11px] uppercase tracking-wide text-white/50">Итого · ${visibleKeys.length} водител${pluralDriver(visibleKeys.length)}</div>
        <div class="text-xs text-white/70 font-num">${tShifts} смен${pluralShift(tShifts)}${tMaint ? ` · ${tMaint} ТО/ремонт` : ""}</div>
      </div>
      <div class="text-xl font-bold font-num text-route shrink-0 pl-2">${tMoney.toLocaleString("ru-RU")} ₽</div>`;
    wrap.appendChild(sumCard);
  }

  if (!allKeys.length) {
    wrap.appendChild(el("div", "text-center text-slate-400 text-sm py-8",
      periodMode
        ? "За выбранный период записей нет — проверь даты."
        : "За этот месяц пока нет записей — смены появятся здесь автоматически после добавления ТТН."));
  } else if (!visibleKeys.length) {
    wrap.appendChild(el("div", "text-center text-slate-400 text-sm py-8",
      "У выбранных водителей за этот период записей нет — сними фильтр или выбери других."));
  }

  // ---------- карточки водителей ----------
  visibleKeys.forEach((k) => {
    const rec = perDriver[k];
    const name = rec.name;
    const total = rec.shiftPay + rec.maintPay;
    const expanded = !!timesheetExpanded[k];
    const isMe = k === nameKey(currentProfile?.name);

    const card = el("div", `bg-white rounded-xl border overflow-hidden ${isMe ? "border-route" : "border-slate-200"}`);
    const header = el("div", "p-4 flex items-center justify-between cursor-pointer");
    header.innerHTML = `
      <div class="min-w-0">
        <div class="font-bold text-slate-800 truncate">${escapeHtml(name)}${isMe ? ` <span class="text-[10px] font-num bg-route/20 text-route-600 px-1.5 py-0.5 rounded align-middle">ТЫ</span>` : ""}</div>
        <div class="text-xs text-slate-400">${rec.shifts.length} смен${pluralShift(rec.shifts.length)}${rec.maint.length ? ` · ${rec.maint.length} ТО/ремонт` : ""}</div>
      </div>
      <div class="text-right shrink-0 pl-2">
        <div class="text-lg font-bold text-shift font-num">${total.toLocaleString("ru-RU")} ₽</div>
        <div class="text-xs text-slate-400">${expanded ? "свернуть ▲" : "подробнее ▼"}</div>
      </div>`;
    header.onclick = () => { timesheetExpanded[k] = !expanded; render(); };
    card.appendChild(header);

    if (expanded) {
      const detail = el("div", "border-t border-slate-100 divide-y divide-slate-50");
      rec.shifts.slice()
        .sort((a, b) => (a.ttnDate || "").localeCompare(b.ttnDate || ""))
        .forEach((d) => {
          const row = el("div", "px-4 py-2 flex items-center justify-between text-xs gap-2");
          row.innerHTML = `<span class="text-slate-500 truncate">${fmtRU(parseISO(d.ttnDate))} · ТТН № ${escapeHtml(d.ttnNumber)} · ${escapeHtml(d.truck || "")}</span><span class="font-semibold text-slate-700 shrink-0 font-num">6 000 ₽</span>`;
          detail.appendChild(row);
        });
      rec.maint.slice()
        .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
        .forEach((m) => {
          const workers = [m.primaryWorker, m.secondaryWorker].filter(Boolean);
          const share = maintShare(m, workers.length);
          const row = el("div", "px-4 py-2 flex items-center justify-between text-xs gap-2");
          row.innerHTML = `<span class="text-slate-500 truncate">${fmtRU(parseISO(m.date))} · <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline -mt-0.5 mr-0.5"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L2 19l3 3 7.3-7.3a4 4 0 0 0 5.4-5.4l-2.8 2.8-2-2z"/></svg>${m.type === "Ремонт" ? escapeHtml(m.repairTypeName || "Ремонт") : "ТО"} · ${escapeHtml(m.truck || "")}</span><span class="font-semibold text-slate-700 shrink-0 font-num">${share.toLocaleString("ru-RU")} ₽</span>`;
          detail.appendChild(row);
        });
      card.appendChild(detail);
    }

    wrap.appendChild(card);
  });

  app.appendChild(wrap);
}

// ---------- экспорт табеля в Excel ----------
// Оформление то же, что у реестра перевозок (вкладка «ТТН»): заголовок,
// тёмная шапка, границы, строка ИТОГО, блок подписи. Общий файл
// оформления — xl-sheet.js. Выгружается ровно выбранный период и
// выбранные водители.
function exportTimesheetToExcel(perDriver, visibleKeys, periodLine, fileTag, filteredByDriver) {
  if (typeof XLSX === "undefined" || typeof xlBuildSheet !== "function") {
    alert("Не удалось загрузить модуль Excel — проверь подключение к интернету и попробуй ещё раз.");
    return;
  }
  if (!visibleKeys.length) {
    alert("За выбранный период записей нет.");
    return;
  }

  const subtitle = "Перевозка железной руды · п. Досатуй, Забайкальский край";
  const money = { align: "right", numFmt: "#,##0" };
  const count = { align: "center" };
  const sum = (pick) => visibleKeys.reduce((s, k) => s + pick(perDriver[k]), 0);
  const pickLine = filteredByDriver
    ? `Выборка: ${visibleKeys.length} ${xlPlural(visibleKeys.length, "водитель", "водителя", "водителей")} из списка`
    : "Выборка: все водители";

  // ---- лист 1: сводный табель ----
  const ws1 = xlBuildSheet({
    title: "ТАБЕЛЬ УЧЁТА СМЕН И ОПЛАТЫ",
    subtitle,
    lines: [periodLine, pickLine],
    columns: [
      { title: "№", width: 5, align: "center" },
      { title: "ФИО", width: 32, wrap: true },
      { title: "Смен", width: 9, ...count },
      { title: "Оплата за смены, ₽", width: 17, ...money },
      { title: "ТО / ремонт", width: 11, ...count },
      { title: "Оплата за ТО / ремонт, ₽", width: 17, ...money },
      { title: "Итого, ₽", width: 15, ...money },
    ],
    rows: visibleKeys.map((k, i) => {
      const r = perDriver[k];
      return [i + 1, r.name, r.shifts.length, r.shiftPay, r.maint.length, r.maintPay, r.shiftPay + r.maintPay];
    }),
    total: {
      label: `ИТОГО: ${visibleKeys.length} чел.`, span: 2,
      values: {
        2: sum((r) => r.shifts.length), 3: sum((r) => r.shiftPay),
        4: sum((r) => r.maint.length), 5: sum((r) => r.maintPay),
        6: sum((r) => r.shiftPay + r.maintPay),
      },
    },
    signatures: [{ label: "Директор ООО ГК «Крона»", name: "Мандров Сергей Николаевич" }],
    footnote: "Табель сформирован автоматически по ТТН и записям о ТО/ремонте. 1 ТТН = 1 смена.",
  });

  // ---- лист 2: детализация по датам ----
  const detail = [];
  visibleKeys.forEach((k) => {
    const r = perDriver[k];
    r.shifts.forEach((d) => {
      detail.push([d.ttnDate || "", r.name, "Смена",
                   d.ttnNumber ? `ТТН № ${d.ttnNumber}` : "ТТН",
                   d.truck || "", truckPlate(d.truck), 6000]);
    });
    r.maint.forEach((m) => {
      const workers = [m.primaryWorker, m.secondaryWorker].filter(Boolean);
      const share = maintShare(m, workers.length);
      detail.push([m.date || "", r.name,
                   m.type === "Ремонт" ? "Ремонт" : "ТО",
                   m.type === "Ремонт" ? (m.repairTypeName || "Ремонт") : "Техобслуживание",
                   m.truck || "", truckPlate(m.truck), share]);
    });
  });
  detail.sort((a, b) => (a[0] || "").localeCompare(b[0] || "") || a[1].localeCompare(b[1], "ru"));
  const ws2 = xlBuildSheet({
    title: "ДЕТАЛИЗАЦИЯ ТАБЕЛЯ",
    subtitle,
    lines: [periodLine],
    columns: [
      { title: "№", width: 5, align: "center" },
      { title: "Дата", width: 12, align: "center" },
      { title: "ФИО", width: 30, wrap: true },
      { title: "Тип", width: 12, align: "center" },
      { title: "Документ / вид работ", width: 26, wrap: true },
      { title: "Машина", width: 18 },
      { title: "Гос. номер", width: 13, align: "center" },
      { title: "Сумма, ₽", width: 13, ...money },
    ],
    rows: detail.map((row, i) => [i + 1, row[0] ? fmtRU(parseISO(row[0])) : "",
                                 row[1], row[2], row[3], row[4], row[5], row[6]]),
    total: {
      label: `ИТОГО: ${detail.length} ${xlPlural(detail.length, "запись", "записи", "записей")}`,
      span: 7,
      values: { 7: detail.reduce((s, row) => s + row[6], 0) },
    },
  });

  const wb = XLSX.utils.book_new();
  xlAppendSheet(wb, ws1, "Табель", { landscape: true });
  xlAppendSheet(wb, ws2, "Детализация", { landscape: true });
  xlSaveFile(wb, xlFileName(["Табель", "Досатуй", fileTag]));
}
