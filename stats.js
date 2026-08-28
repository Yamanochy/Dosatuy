// ============================================================
// СТАТИСТИКА — графики по уже накопленным данным (ТТН + ТО/ремонт)
// ============================================================

let statsChartInstances = [];

function destroyStatsCharts() {
  statsChartInstances.forEach((c) => { try { c.destroy(); } catch (e) {} });
  statsChartInstances = [];
}

function statCard(label, value, icon) {
  const c = el("div", "bg-white rounded-2xl shadow-sm p-3 text-center");
  c.innerHTML = `<div class="text-xl">${icon}</div><div class="text-base font-bold text-slate-800 mt-1">${value}</div><div class="text-[10px] text-slate-400 mt-0.5">${label}</div>`;
  return c;
}

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
  statsRow.appendChild(statCard("рейсов", totalTrips, "🚛"));
  statsRow.appendChild(statCard("вес груза", (totalWeight / 1000).toFixed(1) + " т", "⚖️"));
  wrap.appendChild(statsRow);

  const trendCard = el("div", "bg-white rounded-2xl shadow-sm p-4");
  trendCard.innerHTML = `<div class="font-bold text-slate-700 mb-2 text-sm">Рейсов по месяцам</div><div id="chart-trend-wrap"><canvas id="chart-trend" height="150"></canvas></div>`;
  wrap.appendChild(trendCard);

  const truckCard = el("div", "bg-white rounded-2xl shadow-sm p-4");
  truckCard.innerHTML = `<div class="font-bold text-slate-700 mb-2 text-sm">Самосвалы в этом месяце</div><div id="chart-trucks-wrap"><canvas id="chart-trucks" height="120"></canvas></div>`;
  wrap.appendChild(truckCard);

  if (currentProfile?.role === "manager") {
    const entries = Object.values(monthData)
      .map((r) => ({ name: r.name, trips: r.shifts.length, total: r.shiftPay + r.maintPay }))
      .sort((a, b) => b.trips - a.trips);
    if (entries.length) {
      const topCard = el("div", "bg-white rounded-2xl shadow-sm p-4");
      topCard.innerHTML = `<div class="font-bold text-slate-700 mb-2 text-sm">🏆 Топ за месяц</div>`;
      const list = el("div", "space-y-1.5");
      entries.slice(0, 6).forEach((e, i) => {
        const medal = ["🥇", "🥈", "🥉"][i] || `${i + 1}.`;
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
      const msg = '<div class="text-xs text-slate-400 text-center py-6">📡 Не удалось загрузить графики — нужен интернет</div>';
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
