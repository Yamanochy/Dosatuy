// ============================================================
// ТАБЕЛЬ — автоматический расчёт смен и оплаты
// 1 ТТН = 1 смена = 6 000 ₽. ТО/ремонт: один — 6 000 ₽ ему,
// двое — по 3 000 ₽ каждому. Данные берутся из вкладки «ТТН»
// (оба режима — ТТН и ТО/Ремонт), считать вручную не нужно.
// ============================================================

let timesheetMonthDate = new Date();
let timesheetExpanded = {}; // { "имя водителя": true } — раскрытые карточки

function inSelectedMonth(isoDate, year, month) {
  if (!isoDate) return false;
  const parts = isoDate.split("-");
  if (parts.length < 2) return false;
  const y = parseInt(parts[0], 10), m = parseInt(parts[1], 10) - 1;
  return y === year && m === month;
}

function pluralShift(n) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "а";
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return "ы";
  return "";
}

function computeTimesheet(year, month) {
  const perDriver = {};
  function ensure(name) {
    if (!perDriver[name]) perDriver[name] = { name, shifts: [], shiftPay: 0, maint: [], maintPay: 0 };
    return perDriver[name];
  }
  docsCache.forEach((d) => {
    if (!inSelectedMonth(d.ttnDate, year, month)) return;
    const rec = ensure(d.driverName || "—");
    rec.shifts.push(d);
    rec.shiftPay += 6000;
  });
  maintenanceCache.forEach((m) => {
    if (!inSelectedMonth(m.date, year, month)) return;
    const workers = [m.primaryWorker, m.secondaryWorker].filter(Boolean);
    const share = workers.length === 2 ? 3000 : 6000;
    workers.forEach((w) => {
      const rec = ensure(w);
      rec.maint.push(m);
      rec.maintPay += share;
    });
  });
  return perDriver;
}

function renderTimesheet() {
  app.innerHTML = "";
  const wrap = el("div", "space-y-3");

  const year = timesheetMonthDate.getFullYear();
  const month = timesheetMonthDate.getMonth();

  const monthRow = el("div", "bg-white rounded-2xl shadow-sm px-4 py-3 flex items-center justify-between");
  const prevBtn = el("button", "text-slate-400 text-2xl w-9 h-9 flex items-center justify-center", "‹");
  const nextBtn = el("button", "text-slate-400 text-2xl w-9 h-9 flex items-center justify-center", "›");
  const label = el("div", "font-bold text-slate-700", `${MONTHS_RU[month]} ${year}`);
  prevBtn.onclick = () => { timesheetMonthDate = new Date(year, month - 1, 1); render(); };
  nextBtn.onclick = () => { timesheetMonthDate = new Date(year, month + 1, 1); render(); };
  monthRow.appendChild(prevBtn);
  monthRow.appendChild(label);
  monthRow.appendChild(nextBtn);
  wrap.appendChild(monthRow);

  const perDriver = computeTimesheet(year, month);
  const names = Object.keys(perDriver).sort((a, b) => a.localeCompare(b, "ru"));
  const isManager = currentProfile?.role === "manager";
  const visibleNames = isManager
    ? names
    : names.filter((n) => n.toLowerCase() === (currentProfile?.name || "").toLowerCase());

  if (!visibleNames.length) {
    wrap.appendChild(el("div", "text-center text-slate-400 text-sm py-8",
      "За этот месяц пока нет записей — смены появятся здесь автоматически после добавления ТТН."));
  }

  visibleNames.forEach((name) => {
    const rec = perDriver[name];
    const total = rec.shiftPay + rec.maintPay;
    const expanded = !!timesheetExpanded[name];

    const card = el("div", "bg-white rounded-2xl shadow-sm overflow-hidden");
    const header = el("div", "p-4 flex items-center justify-between cursor-pointer");
    header.innerHTML = `
      <div class="min-w-0">
        <div class="font-bold text-slate-800 truncate">${escapeHtml(name)}</div>
        <div class="text-xs text-slate-400">${rec.shifts.length} смен${pluralShift(rec.shifts.length)}${rec.maint.length ? ` · ${rec.maint.length} ТО/ремонт` : ""}</div>
      </div>
      <div class="text-right shrink-0 pl-2">
        <div class="text-lg font-bold text-emerald-600">${total.toLocaleString("ru-RU")} ₽</div>
        <div class="text-xs text-slate-400">${expanded ? "свернуть ▲" : "подробнее ▼"}</div>
      </div>`;
    header.onclick = () => { timesheetExpanded[name] = !expanded; render(); };
    card.appendChild(header);

    if (expanded) {
      const detail = el("div", "border-t border-slate-100 divide-y divide-slate-50");
      rec.shifts.slice()
        .sort((a, b) => (a.ttnDate || "").localeCompare(b.ttnDate || ""))
        .forEach((d) => {
          const row = el("div", "px-4 py-2 flex items-center justify-between text-xs gap-2");
          row.innerHTML = `<span class="text-slate-500 truncate">${fmtRU(parseISO(d.ttnDate))} · ТТН № ${escapeHtml(d.ttnNumber)} · ${escapeHtml(d.truck || "")}</span><span class="font-semibold text-slate-700 shrink-0">6 000 ₽</span>`;
          detail.appendChild(row);
        });
      rec.maint.slice()
        .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
        .forEach((m) => {
          const workers = [m.primaryWorker, m.secondaryWorker].filter(Boolean);
          const share = workers.length === 2 ? 3000 : 6000;
          const row = el("div", "px-4 py-2 flex items-center justify-between text-xs gap-2");
          row.innerHTML = `<span class="text-slate-500 truncate">${fmtRU(parseISO(m.date))} · ${m.type === "Ремонт" ? "🔧 Ремонт" : "🛠️ ТО"} · ${escapeHtml(m.truck || "")}</span><span class="font-semibold text-slate-700 shrink-0">${share.toLocaleString("ru-RU")} ₽</span>`;
          detail.appendChild(row);
        });
      card.appendChild(detail);
    }

    wrap.appendChild(card);
  });

  app.appendChild(wrap);
}
