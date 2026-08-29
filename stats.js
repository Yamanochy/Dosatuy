// ============================================================
// СТАТИСТИКА — графики по уже накопленным данным (ТТН + ТО/ремонт)
// ============================================================

let statsChartInstances = [];

function destroyStatsCharts() {
  statsChartInstances.forEach((c) => { try { c.destroy(); } catch (e) {} });
  statsChartInstances = [];
}

function statCard(label, value, icon) {
  const c = el("div", "bg-white rounded-xl border border-slate-200 p-3 text-center");
  c.innerHTML = `<div class="text-diesel flex items-center justify-center h-6">${icon}</div><div class="text-base font-bold font-num text-slate-800 mt-1">${value}</div><div class="text-[10px] text-slate-400 mt-0.5">${label}</div>`;
  return c;
}

const ICON_DUMPTRUCK = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 17h1M21 17h1M3 17V10a1 1 0 0 1 1-1h5l2-3h3v6h6a1 1 0 0 1 1 1v4"/><path d="M16 17H8"/><circle cx="6.5" cy="17" r="2"/><circle cx="17.5" cy="17" r="2"/></svg>';
const ICON_SCALE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M7 21h10"/><path d="M5 7h5M5 7l-2.5 5a2.5 2.5 0 0 0 5 0L5 7z"/><path d="M19 7h-5M19 7l2.5 5a2.5 2.5 0 0 1-5 0L19 7z"/></svg>';
const ICON_TROPHY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline -mt-0.5 mr-1"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M7 5H4a3 3 0 0 0 3 5M17 5h3a3 3 0 0 1-3 5"/></svg>';

function renderStatistics() {
  app.innerHTML = "";
  destroyStatsCharts();
  const wrap = el("div", "space-y-3");

  const today = toDateOnly(new Date());
  const year = today.getFullYear(), month = today.getMonth();
  const monthData = computeTimesheet(year, month);

  let totalTrips = 0, totalWeight = 0;
  Object.values(monthData).forEach((r) => {
    totalTrips += r.shifts.length;
  });
  docsCache.forEach((d) => {
    if (inSelectedMonth(d.ttnDate, year, month) && d.weight) totalWeight += Number(d.weight) || 0;
  });

  const titleRow = el("div", "text-sm text-slate-400 font-semibold px-1", `${MONTHS_RU[month]} ${year}`);
  wrap.appendChild(titleRow);

  const statsRow = el("div", "grid grid-cols-2 gap-2");
  statsRow.appendChild(statCard("рейсов", totalTrips, ICON_DUMPTRUCK));
  const weightLabel = totalWeight.toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " т";
  statsRow.appendChild(statCard("вес груза", weightLabel, ICON_SCALE));
  wrap.appendChild(statsRow);

  const trendCard = el("div", "bg-white rounded-xl border border-slate-200 p-4");
  trendCard.innerHTML = `<div class="font-bold text-slate-700 mb-2 text-sm">Рейсов по месяцам</div><div id="chart-trend-wrap"><canvas id="chart-trend" height="150"></canvas></div>`;
  wrap.appendChild(trendCard);

  const truckCard = el("div", "bg-white rounded-xl border border-slate-200 p-4");
  truckCard.innerHTML = `<div class="font-bold text-slate-700 mb-2 text-sm">Самосвалы в этом месяце</div><div id="chart-trucks-wrap"><canvas id="chart-trucks" height="120"></canvas></div>`;
  wrap.appendChild(truckCard);

  if (currentProfile?.role === "manager") {
    const entries = Object.values(monthData)
      .map((r) => ({ name: r.name, trips: r.shifts.length, total: r.shiftPay + r.maintPay }))
      .sort((a, b) => b.trips - a.trips);
    if (entries.length) {
      const topCard = el("div", "bg-white rounded-xl border border-slate-200 p-4");
      topCard.innerHTML = `<div class="font-bold font-display text-slate-700 mb-2 text-sm flex items-center">${ICON_TROPHY}Топ за месяц</div>`;
      const list = el("div", "space-y-1.5");
      entries.slice(0, 6).forEach((e, i) => {
        const medal = `<span class="font-num text-slate-400">${i + 1}.</span>`;
        const row = el("div", "flex items-center justify-between text-sm");
        row.innerHTML = `<span class="text-slate-700">${medal} ${escapeHtml(e.name)}</span><span class="font-semibold text-slate-500">${e.trips} рейс${pluralShift(e.trips)}</span>`;
        list.appendChild(row);
      });
      topCard.appendChild(list);
      wrap.appendChild(topCard);
    }
  }

  app.appendChild(wrap);

  // рисуем графики после того, как canvas реально в DOM
  setTimeout(() => {
    if (typeof Chart === "undefined") {
      // библиотека графиков не загрузилась (нет сети / заблокирован CDN) —
      // показываем понятное сообщение вместо пустого места
      const msg = '<div class="text-xs text-slate-400 text-center py-6"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline -mt-0.5 mr-1"><path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 5.6-1M5 12.5a10 10 0 0 1 3-1.9M12 20h.01M19 9a13.5 13.5 0 0 0-3-2.1M22 12.5a13.5 13.5 0 0 0-2.5-2.2"/></svg>Не удалось загрузить графики — нужен интернет</div>';
      const w1 = document.getElementById("chart-trend-wrap");
      const w2 = document.getElementById("chart-trucks-wrap");
      if (w1) w1.innerHTML = msg;
      if (w2) w2.innerHTML = msg;
      return;
    }

    const months = [];
    for (let i = 5; i >= 0; i--) months.push(new Date(year, month - i, 1));

    const tripsPerMonth = months.map((d) => {
      const md = computeTimesheet(d.getFullYear(), d.getMonth());
      return Object.values(md).reduce((s, r) => s + r.shifts.length, 0);
    });

    const ctxTrend = document.getElementById("chart-trend");
    if (ctxTrend) {
      statsChartInstances.push(new Chart(ctxTrend, {
        type: "bar",
        data: {
          labels: months.map((d) => MONTHS_RU[d.getMonth()].slice(0, 3)),
          datasets: [{ data: tripsPerMonth, backgroundColor: "#1e293b", borderRadius: 6, maxBarThickness: 28 }],
        },
        options: {
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
        },
      }));
    }

    const truckCounts = {};
    STATE.trucks.forEach((t) => { truckCounts[t] = 0; });
    docsCache.forEach((d) => {
      if (inSelectedMonth(d.ttnDate, year, month) && truckCounts[d.truck] !== undefined) truckCounts[d.truck]++;
    });
    const ctxTrucks = document.getElementById("chart-trucks");
    if (ctxTrucks) {
      statsChartInstances.push(new Chart(ctxTrucks, {
        type: "bar",
        data: {
          labels: Object.keys(truckCounts),
          datasets: [{ data: Object.values(truckCounts), backgroundColor: ["#0ea5e9", "#10b981"], borderRadius: 6, maxBarThickness: 28 }],
        },
        options: {
          indexAxis: "y",
          plugins: { legend: { display: false } },
          scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
        },
      }));
    }
  }, 0);
}
