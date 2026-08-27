// ============================================================
// ЛОГИКА ГРАФИКА ВАХТ 45×45
// ============================================================

const STORAGE_KEY = "vahta-dosatuy-settings-v1";

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.drivers) && parsed.drivers.length) return parsed;
    }
  } catch (e) {}
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function saveSettings(s) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

function resetSettings() {
  localStorage.removeItem(STORAGE_KEY);
  return loadSettings();
}

let STATE = loadSettings();

// ---------- облачная синхронизация настроек (Firestore) ----------
// Firestore — источник истины; localStorage — локальный кэш для
// мгновенной прорисовки при старте и работы офлайн.
function settingsDocRef() {
  return db.collection("settings").doc("schedule");
}
let settingsUnsub = null;
function subscribeCloudSettings() {
  if (settingsUnsub) return;
  settingsUnsub = settingsDocRef().onSnapshot((doc) => {
    if (doc.exists) {
      const data = doc.data();
      STATE = {
        vahta: data.vahta,
        otdyh: data.otdyh,
        drivers: data.drivers,
        trucks: data.trucks,
      };
      saveSettings(STATE); // обновляем локальный кэш
      render();
    } else if (currentProfile?.role === "manager") {
      // документа в базе ещё нет — заводим его тем, что уже есть на этом
      // устройстве (включая уже внесённые правки), чтобы их не потерять
      settingsDocRef().set(STATE).catch((e) => console.error("seed settings error", e));
    }
  }, (err) => console.error("settings sync error", err));
}
function saveCloudSettings(newState) {
  return settingsDocRef().set(newState);
}

// ---------- дата-математика ----------
function toDateOnly(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function fmtISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtRU(d) {
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function daysBetween(d1, d2) {
  return Math.round((toDateOnly(d2) - toDateOnly(d1)) / 86400000);
}
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
function weekdayShort(d) {
  const idx = (d.getDay() + 6) % 7; // Mon=0
  return WEEKDAYS[idx];
}
function isWeekend(d) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

// ---------- логика вахты ----------
function cyclePos(driver, date) {
  const V = STATE.vahta, R = STATE.otdyh;
  const start = parseISO(driver.start);
  const diff = daysBetween(start, date);
  const cycle = V + R;
  return ((diff % cycle) + cycle) % cycle;
}
function driverStatus(driver, date) {
  const pos = cyclePos(driver, date);
  return pos < STATE.vahta ? "vahta" : "otdyh";
}
function daysLeftInStage(driver, date) {
  const pos = cyclePos(driver, date);
  const V = STATE.vahta, R = STATE.otdyh;
  return pos < V ? V - pos : V + R - pos;
}
function stageEndDate(driver, date) {
  return addDays(date, daysLeftInStage(driver, date));
}
function driversForTruck(truck) {
  return STATE.drivers.filter(d => d.truck === truck);
}
// сводка по каждому водителю на грузовике на дату: статус, дней до смены, дата смены
function truckDriverRows(truck, date) {
  return driversForTruck(truck).map(d => ({
    driver: d,
    status: driverStatus(d, date),
    daysLeft: daysLeftInStage(d, date),
    switchDate: stageEndDate(d, date),
  })).sort((a, b) => {
    if (a.status !== b.status) return a.status === "vahta" ? -1 : 1;
    return a.daysLeft - b.daysLeft;
  });
}
// имена водителей грузовика, которые на вахте в конкретный день (для календаря)
function activeNamesForTruck(truck, date) {
  return driversForTruck(truck)
    .filter(d => driverStatus(d, date) === "vahta")
    .map(d => d.name);
}

// ============================================================
// РЕНДЕР
// ============================================================
const app = document.getElementById("app");
let currentTab = "dashboard";

function render() {
  const today = toDateOnly(new Date());
  if (currentTab !== "chat") removeChatInputBar();
  if (currentTab === "dashboard") renderDashboard(today);
  else if (currentTab === "overview") renderOverview(today);
  else if (currentTab === "calendar") renderCalendar(today);
  else if (currentTab === "documents") renderDocuments();
  else if (currentTab === "chat") renderChat();
  else if (currentTab === "settings" && currentProfile.role === "manager") renderSettings();
  else { currentTab = "dashboard"; renderDashboard(today); }
  document.querySelectorAll(".tabbtn").forEach(b => {
    b.classList.toggle("tab-active", b.dataset.tab === currentTab);
  });
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

// ---------- ДАШБОРД ----------
function renderDashboard(today) {
  app.innerHTML = "";
  const wrap = el("div", "space-y-4");

  const dateCard = el("div", "bg-white rounded-2xl shadow-sm p-4 flex items-center justify-between");
  dateCard.innerHTML = `
    <div>
      <div class="text-xs uppercase tracking-wide text-slate-400 font-semibold">Сегодня</div>
      <div class="text-xl font-bold text-slate-800">${fmtRU(today)}</div>
      <div class="text-sm text-slate-400">${today.toLocaleDateString("ru-RU", { weekday: "long" })}</div>
    </div>
    <div class="text-4xl">📅</div>`;
  wrap.appendChild(dateCard);

  STATE.trucks.forEach(truck => {
    const rows = truckDriverRows(truck, today);
    const onVahtaCount = rows.filter(r => r.status === "vahta").length;

    const card = el("div", "bg-white rounded-2xl shadow-sm overflow-hidden");
    const header = el("div", "bg-gradient-to-r from-slate-800 to-slate-700 text-white px-4 py-3 flex items-center gap-2");
    header.innerHTML = `
      <span class="text-2xl">🚛</span>
      <span class="font-bold text-lg">${truck}</span>
      <span class="ml-auto text-xs bg-white/15 px-2 py-1 rounded-full">${onVahtaCount} на вахте</span>`;
    card.appendChild(header);

    const body = el("div", "divide-y divide-slate-100");
    if (!rows.length) {
      body.appendChild(el("div", "p-4 text-sm text-slate-400", "Нет водителей, назначенных на эту машину."));
    }
    rows.forEach(r => {
      const isVahta = r.status === "vahta";
      const urgent = isVahta && r.daysLeft <= 5;
      const row = el("div", "p-4 flex items-center gap-3");
      row.innerHTML = `
        <span class="w-2.5 h-2.5 rounded-full shrink-0 ${isVahta ? "bg-emerald-500" : "bg-slate-300"}"></span>
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-slate-800 truncate">${escapeHtml(r.driver.name)}</div>
          <div class="text-xs text-slate-400">${isVahta ? "На вахте" : "Дома"}${r.driver.role ? " · " + escapeHtml(r.driver.role) : ""}</div>
        </div>
        <div class="text-right shrink-0">
          <div class="text-xs ${urgent ? "text-amber-600 font-bold" : "text-slate-400"}">${isVahta ? "дней до смены" : "выходит через"}</div>
          <div class="text-lg font-bold ${urgent ? "text-amber-600" : "text-slate-700"}">${r.daysLeft}</div>
          <div class="text-[11px] text-slate-400">${fmtRU(r.switchDate)}</div>
        </div>`;
      body.appendChild(row);
    });
    card.appendChild(body);
    wrap.appendChild(card);
  });

  // ближайшие пересменки — по каждому водителю индивидуально
  const upcoming = STATE.drivers
    .map(d => ({ driver: d, switchDate: stageEndDate(d, today), status: driverStatus(d, today) }))
    .sort((a, b) => a.switchDate - b.switchDate)
    .slice(0, 6);

  const upCard = el("div", "bg-white rounded-2xl shadow-sm p-4");
  upCard.innerHTML = `<div class="font-bold text-slate-700 mb-3 flex items-center gap-2"><span>🔄</span>Ближайшие пересменки</div>`;
  const list = el("div", "space-y-2");
  upcoming.forEach(u => {
    const row = el("div", "flex items-center justify-between text-sm bg-slate-50 rounded-xl px-3 py-2");
    const action = u.status === "vahta" ? "уезжает" : "заступает";
    row.innerHTML = `<span class="font-semibold text-slate-600 truncate">${escapeHtml(u.driver.name)}</span><span class="text-slate-400 text-xs">${action}</span><span class="text-slate-700 font-medium">${fmtRU(u.switchDate)}</span>`;
    list.appendChild(row);
  });
  upCard.appendChild(list);
  wrap.appendChild(upCard);

  app.appendChild(wrap);
}

// ---------- ОБЗОР ПО МЕСЯЦАМ ----------
function monthEnd(y, m) {
  return new Date(y, m + 1, 0).getDate();
}
const MONTHS_RU = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];

function buildPeriods(startDate, count) {
  const periods = [];
  let y = startDate.getFullYear(), m = startDate.getMonth();
  for (let i = 0; i < count; i++) {
    periods.push({ label: `${MONTHS_RU[m]}`, half: "1–15", date: new Date(y, m, 1) });
    periods.push({ label: `${MONTHS_RU[m]}`, half: `15–${monthEnd(y, m)}`, date: new Date(y, m, 15) });
    m++;
    if (m === 12) { m = 0; y++; }
  }
  return periods;
}

function renderOverview(today) {
  app.innerHTML = "";
  const startMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const periods = buildPeriods(startMonth, 12);

  const wrap = el("div", "bg-white rounded-2xl shadow-sm p-3 overflow-x-auto");
  const table = el("table", "text-xs border-collapse w-full");

  // month header row
  const monthRow = el("tr");
  monthRow.appendChild(el("th", "sticky left-0 bg-white z-10 text-left px-2 py-1 min-w-[130px]", "Водитель"));
  let i = 0;
  while (i < periods.length) {
    const label = periods[i].label;
    let span = 1;
    if (periods[i + 1] && periods[i + 1].label === label) span = 2;
    const th = el("th", "px-1 py-1 text-center font-bold text-slate-600 bg-slate-100", label);
    th.colSpan = span;
    monthRow.appendChild(th);
    i += span;
  }
  table.appendChild(monthRow);

  // half-period row
  const halfRow = el("tr");
  halfRow.appendChild(el("th", "sticky left-0 bg-white z-10"));
  periods.forEach(p => {
    halfRow.appendChild(el("th", "px-1 py-1 text-center text-slate-400 font-normal bg-slate-50 min-w-[34px]", p.half));
  });
  table.appendChild(halfRow);

  STATE.drivers.forEach(driver => {
    const tr = el("tr", "border-t border-slate-100");
    const nameCell = el("td", "sticky left-0 bg-white px-2 py-1.5 font-medium text-slate-700 whitespace-nowrap");
    nameCell.innerHTML = `<span class="inline-block w-2 h-2 rounded-full mr-1 ${driver.role === "Основной" ? "bg-emerald-500" : "bg-sky-500"}"></span>${driver.name}<div class="text-[10px] text-slate-400">${driver.truck}</div>`;
    tr.appendChild(nameCell);
    periods.forEach(p => {
      const status = driverStatus(driver, p.date);
      const cell = el("td", "text-center py-1.5");
      if (status === "vahta") {
        cell.innerHTML = `<span class="inline-block w-3.5 h-3.5 rounded-sm ${driver.role === "Основной" ? "bg-emerald-500" : "bg-sky-500"}"></span>`;
      }
      tr.appendChild(cell);
    });
    table.appendChild(tr);
  });

  wrap.appendChild(table);
  app.appendChild(wrap);

  const legend = el("div", "flex items-center gap-4 text-xs text-slate-500 mt-3 px-1");
  legend.innerHTML = `<span class="flex items-center gap-1"><span class="w-3 h-3 rounded-sm bg-emerald-500 inline-block"></span>основной на вахте</span>
    <span class="flex items-center gap-1"><span class="w-3 h-3 rounded-sm bg-sky-500 inline-block"></span>напарник на вахте</span>
    <span class="flex items-center gap-1"><span class="w-3 h-3 rounded-sm border border-slate-300 inline-block"></span>дома</span>`;
  app.appendChild(legend);
}

// ---------- КАЛЕНДАРЬ ПО ДНЯМ ----------
let calendarDaysShown = 60;

function renderCalendar(today) {
  app.innerHTML = "";
  const wrap = el("div", "space-y-2");

  const startDate = addDays(today, -3);
  for (let i = 0; i < calendarDaysShown; i++) {
    const d = addDays(startDate, i);
    const isToday = daysBetween(d, today) === 0;
    const weekend = isWeekend(d);

    const rows = STATE.trucks.map(truck => {
      const names = activeNamesForTruck(truck, d);
      return { truck, names: names.join(" + ") };
    });

    // определяем день пересменки (сравнение состава на вахте с предыдущим днём)
    let switchInfo = null;
    if (i > 0) {
      const prevD = addDays(d, -1);
      STATE.trucks.forEach(truck => {
        const a = activeNamesForTruck(truck, d).sort().join(",");
        const b = activeNamesForTruck(truck, prevD).sort().join(",");
        if (a !== b) switchInfo = truck;
      });
    }

    const row = el("div", `rounded-xl px-3 py-2 flex items-center gap-3 ${
      isToday ? "bg-amber-100 ring-2 ring-amber-300" : weekend ? "bg-slate-100" : "bg-white"
    } shadow-sm`);

    const dateCol = el("div", "w-16 shrink-0");
    dateCol.innerHTML = `<div class="font-bold text-slate-700 text-sm">${d.getDate()}.${String(d.getMonth()+1).padStart(2,"0")}</div><div class="text-[11px] text-slate-400">${weekdayShort(d)}</div>`;
    row.appendChild(dateCol);

    const infoCol = el("div", "flex-1 text-xs space-y-0.5");
    infoCol.innerHTML = rows.map(r => `<div><span class="font-semibold text-slate-500">${r.truck.replace("Шакман ","")}</span> <span class="text-slate-700">${r.names || "— никого нет на вахте —"}</span></div>`).join("");
    row.appendChild(infoCol);

    if (switchInfo) {
      row.appendChild(el("div", "text-lg", "🔄"));
    } else if (isToday) {
      row.appendChild(el("div", "text-xs font-bold text-amber-600 shrink-0", "СЕГОДНЯ"));
    }

    wrap.appendChild(row);
  }

  const moreBtn = el("button", "w-full py-3 rounded-xl bg-white shadow-sm text-slate-500 text-sm font-medium", "Показать ещё дни ↓");
  moreBtn.onclick = () => { calendarDaysShown += 60; render(); };
  wrap.appendChild(moreBtn);

  app.appendChild(wrap);
}

// ---------- НАСТРОЙКИ ----------
function renderSettings() {
  app.innerHTML = "";
  const wrap = el("div", "space-y-4");

  const paramCard = el("div", "bg-white rounded-2xl shadow-sm p-4");
  paramCard.innerHTML = `<div class="font-bold text-slate-700 mb-3">Параметры вахты</div>`;
  const paramGrid = el("div", "grid grid-cols-2 gap-3");
  paramGrid.innerHTML = `
    <label class="text-sm text-slate-500">Вахта, дней
      <input id="inp-vahta" type="number" min="1" value="${STATE.vahta}" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-slate-800" />
    </label>
    <label class="text-sm text-slate-500">Отдых, дней
      <input id="inp-otdyh" type="number" min="1" value="${STATE.otdyh}" class="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-slate-800" />
    </label>`;
  paramCard.appendChild(paramGrid);
  wrap.appendChild(paramCard);

  const driversCard = el("div", "bg-white rounded-2xl shadow-sm p-4");
  driversCard.innerHTML = `<div class="font-bold text-slate-700 mb-3">Водители и даты начала вахты</div>`;
  STATE.drivers.forEach(driver => {
    const row = el("div", "border-t border-slate-100 py-3 first:border-t-0 first:pt-0");
    row.innerHTML = `
      <div class="text-xs text-slate-400 mb-1">${driver.truck} · экипаж ${driver.crew} · ${driver.role}</div>
      <div class="flex gap-2">
        <input data-id="${driver.id}" data-field="name" value="${driver.name}" class="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-800" />
        <input data-id="${driver.id}" data-field="start" type="date" value="${driver.start}" class="border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-800" />
      </div>`;
    driversCard.appendChild(row);
  });
  wrap.appendChild(driversCard);

  const btnRow = el("div", "flex gap-3");
  const saveBtn = el("button", "flex-1 py-3 rounded-xl bg-slate-800 text-white font-semibold shadow-sm", "Сохранить");
  const resetBtn = el("button", "px-4 py-3 rounded-xl bg-white text-slate-500 font-semibold shadow-sm", "Сбросить");
  btnRow.appendChild(saveBtn);
  btnRow.appendChild(resetBtn);
  wrap.appendChild(btnRow);

  const toast = el("div", "text-center text-sm text-emerald-600 font-semibold hidden", "Сохранено ✓");
  toast.id = "settings-toast";
  wrap.appendChild(toast);

  saveBtn.onclick = () => {
    STATE.vahta = parseInt(document.getElementById("inp-vahta").value, 10) || STATE.vahta;
    STATE.otdyh = parseInt(document.getElementById("inp-otdyh").value, 10) || STATE.otdyh;
    document.querySelectorAll("[data-field]").forEach(inp => {
      const id = parseInt(inp.dataset.id, 10);
      const driver = STATE.drivers.find(d => d.id === id);
      if (driver) driver[inp.dataset.field] = inp.value;
    });
    saveSettings(STATE); // локальный кэш — мгновенно
    saveBtn.disabled = true;
    saveBtn.textContent = "Сохраняю…";
    saveCloudSettings(STATE)
      .then(() => {
        const t = document.getElementById("settings-toast");
        t.classList.remove("hidden");
        setTimeout(() => t.classList.add("hidden"), 1800);
      })
      .catch((e) => alert("Не удалось сохранить в общую базу: " + e.message))
      .finally(() => {
        saveBtn.disabled = false;
        saveBtn.textContent = "Сохранить";
      });
  };
  resetBtn.onclick = () => {
    if (confirm("Сбросить все настройки к заводским значениям? Изменения увидят все устройства.")) {
      STATE = resetSettings();
      render();
      saveCloudSettings(STATE).catch((e) => alert("Не удалось сбросить в общей базе: " + e.message));
    }
  };

  app.appendChild(wrap);
}

// ---------- навигация ----------
function wireNav() {
  document.querySelectorAll(".tabbtn").forEach(btn => {
    btn.onclick = () => {
      currentTab = btn.dataset.tab;
      calendarDaysShown = 60;
      addFormOpen = false;
      render();
      window.scrollTo(0, 0);
    };
  });
}

function startApp() {
  renderUserBar();
  buildNav();
  wireNav();
  currentTab = "dashboard";
  render();
  subscribeCloudSettings();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

function renderUserBar() {
  const bar = document.getElementById("user-bar");
  if (!bar) return;
  const roleLabel = currentProfile.role === "manager" ? "Руководитель" : "Водитель";
  bar.innerHTML = `
    <span class="text-slate-300">${escapeHtml(currentProfile.name)}</span>
    <span class="text-slate-500 text-[10px] uppercase tracking-wide bg-white/10 px-2 py-0.5 rounded-full ml-2">${roleLabel}</span>
    <button id="logout-btn" class="ml-auto text-slate-400 text-xs underline">Выйти</button>`;
  document.getElementById("logout-btn").onclick = logout;
}

function buildNav() {
  const nav = document.getElementById("nav");
  const isManager = currentProfile.role === "manager";
  nav.innerHTML = `
    <button class="tabbtn relative flex flex-col items-center gap-0.5 px-2 py-1 text-slate-400 text-[10px] font-medium" data-tab="dashboard"><span class="tabicon text-xl transition-transform">🏠</span>Дашборд</button>
    <button class="tabbtn relative flex flex-col items-center gap-0.5 px-2 py-1 text-slate-400 text-[10px] font-medium" data-tab="overview"><span class="tabicon text-xl transition-transform">🗓️</span>Обзор</button>
    <button class="tabbtn relative flex flex-col items-center gap-0.5 px-2 py-1 text-slate-400 text-[10px] font-medium" data-tab="calendar"><span class="tabicon text-xl transition-transform">📆</span>По дням</button>
    <button class="tabbtn relative flex flex-col items-center gap-0.5 px-2 py-1 text-slate-400 text-[10px] font-medium" data-tab="documents"><span class="tabicon text-xl transition-transform">📄</span>ТТН</button>
    <button class="tabbtn relative flex flex-col items-center gap-0.5 px-2 py-1 text-slate-400 text-[10px] font-medium" data-tab="chat"><span class="tabicon text-xl transition-transform">💬</span>Чат</button>
    ${isManager ? `<button class="tabbtn relative flex flex-col items-center gap-0.5 px-2 py-1 text-slate-400 text-[10px] font-medium" data-tab="settings"><span class="tabicon text-xl transition-transform">⚙️</span>Настройки</button>` : ""}`;
}

