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
function driverVahta(driver) { return driver.vahta || STATE.vahta || 45; }
function driverOtdyh(driver) { return driver.otdyh || STATE.otdyh || 45; }
function cyclePos(driver, date) {
  const V = driverVahta(driver), R = driverOtdyh(driver);
  const start = parseISO(driver.start);
  const diff = daysBetween(start, date);
  const cycle = V + R;
  return ((diff % cycle) + cycle) % cycle;
}
function driverStatus(driver, date) {
  const pos = cyclePos(driver, date);
  return pos < driverVahta(driver) ? "vahta" : "otdyh";
}
function daysLeftInStage(driver, date) {
  const pos = cyclePos(driver, date);
  const V = driverVahta(driver), R = driverOtdyh(driver);
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
let tempTrucks = null; // черновик списка машин при редактировании в Настройках

function render() {
  const today = toDateOnly(new Date());
  if (currentTab !== "chat") removeChatInputBar();
  if (currentTab === "dashboard") renderDashboard(today);
  else if (currentTab === "timesheet") renderTimesheet();
  else if (currentTab === "stats") renderStatistics();
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
// собирает предупреждения для Дашборда: активные водители без свежих ТТН
// (видно только руководителю) и грузовики с давним/отсутствующим ТО (видно всем)
function computeDashboardWarnings(today) {
  const warnings = [];
  const docs = (typeof docsCache !== "undefined") ? docsCache : [];
  const maint = (typeof maintenanceCache !== "undefined") ? maintenanceCache : [];

  if (currentProfile?.role === "manager") {
    const cutoff = addDays(today, -2);
    STATE.drivers
      .filter(d => driverStatus(d, today) === "vahta")
      .forEach(d => {
        const hasRecent = docs.some(doc =>
          doc.driverName === d.name && doc.ttnDate && parseISO(doc.ttnDate) >= cutoff);
        if (!hasRecent) warnings.push(`${d.name} на вахте, но ТТН от него нет уже 2+ дня`);
      });
  }

  STATE.trucks.forEach(truck => {
    const toEntries = maint.filter(m => m.truck === truck && m.type === "ТО" && m.date);
    if (!toEntries.length) return; // ни разу не фиксировали — не пугаем сразу
    const lastTO = toEntries.map(m => parseISO(m.date)).sort((a, b) => b - a)[0];
    const daysSince = daysBetween(lastTO, today);
    if (daysSince > 45) warnings.push(`${truck}: последнее ТО было ${daysSince} дн. назад`);
  });

  return warnings;
}

function renderDashboard(today) {
  app.innerHTML = "";
  const wrap = el("div", "space-y-4");

  const warnings = computeDashboardWarnings(today);
  if (warnings.length) {
    const warnCard = el("div", "bg-amber-50 border border-amber-200 rounded-2xl p-3 space-y-1.5");
    const title = el("div", "font-bold text-amber-700 text-sm flex items-center gap-1.5", "⚠️ Обрати внимание");
    warnCard.appendChild(title);
    warnings.forEach(w => warnCard.appendChild(el("div", "text-xs text-amber-700", "• " + escapeHtml(w))));
    wrap.appendChild(warnCard);
  }

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

// ---------- вспомогательное (используется в Табеле) ----------
function monthEnd(y, m) {
  return new Date(y, m + 1, 0).getDate();
}
const MONTHS_RU = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];

// ---------- КАЛЕНДАРЬ ПО ДНЯМ ----------
// ---------- НАСТРОЙКИ ----------
function renderSettings() {
  app.innerHTML = "";
  const wrap = el("div", "space-y-4");

  if (tempTrucks === null) tempTrucks = STATE.trucks.slice();

  function captureTruckInputs() {
    const inputs = document.querySelectorAll("[data-truck-idx]");
    if (!inputs.length) return tempTrucks.slice();
    const vals = [];
    inputs.forEach(inp => { vals[parseInt(inp.dataset.truckIdx, 10)] = inp.value; });
    return vals;
  }

  const trucksCard = el("div", "bg-white rounded-2xl shadow-sm p-4");
  trucksCard.innerHTML = `<div class="font-bold text-slate-700 mb-1">Машины</div>
    <div class="text-xs text-slate-400 mb-3">Список грузовиков, которые водители видят при выборе в ТТН и ТО/ремонте.</div>`;
  tempTrucks.forEach((truck, idx) => {
    const row = el("div", "flex gap-2 items-center mb-2");
    const input = el("input", "flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-800");
    input.value = truck;
    input.dataset.truckIdx = idx;
    row.appendChild(input);
    const delBtn = el("button", "text-slate-300 hover:text-rose-500 shrink-0 px-1 text-lg", "✕");
    delBtn.onclick = () => {
      tempTrucks = captureTruckInputs();
      tempTrucks.splice(idx, 1);
      render();
    };
    row.appendChild(delBtn);
    trucksCard.appendChild(row);
  });
  const addTruckBtn = el("button", "text-sm text-slate-600 font-semibold mt-1", "➕ Добавить машину");
  addTruckBtn.onclick = () => {
    tempTrucks = captureTruckInputs();
    tempTrucks.push("");
    render();
  };
  trucksCard.appendChild(addTruckBtn);
  wrap.appendChild(trucksCard);

  const driversCard = el("div", "bg-white rounded-2xl shadow-sm p-4");
  driversCard.innerHTML = `<div class="font-bold text-slate-700 mb-1">Водители</div>
    <div class="text-xs text-slate-400 mb-3">У каждого можно задать свою длину вахты и отдыха — если кто-то работает дольше 45 дней.</div>`;
  STATE.drivers.forEach(driver => {
    const row = el("div", "border-t border-slate-100 py-3 first:border-t-0 first:pt-0");
    row.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <input data-id="${driver.id}" data-field="name" value="${driver.name}" placeholder="ФИО водителя" class="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-800 font-medium" />
        <button data-del-driver="${driver.id}" class="text-slate-300 hover:text-rose-500 shrink-0 px-2 text-lg">✕</button>
      </div>
      <div class="flex gap-2 mb-2">
        <select data-id="${driver.id}" data-field="truck" class="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-800 bg-white">
          ${STATE.trucks.map(t => `<option value="${t}" ${t === driver.truck ? "selected" : ""}>${t}</option>`).join("")}
        </select>
        <select data-id="${driver.id}" data-field="role" class="border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-800 bg-white">
          <option value="Основной" ${driver.role === "Основной" ? "selected" : ""}>Основной</option>
          <option value="Напарник" ${driver.role === "Напарник" ? "selected" : ""}>Напарник</option>
        </select>
      </div>
      <div class="flex gap-2 mb-2">
        <input data-id="${driver.id}" data-field="crew" value="${driver.crew || ""}" placeholder="Экипаж (напр. A)" class="w-28 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-800" />
        <input data-id="${driver.id}" data-field="start" type="date" value="${driver.start}" class="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-800" />
      </div>
      <div class="flex gap-2 items-center">
        <label class="text-xs text-slate-400 flex items-center gap-1">Вахта
          <input data-id="${driver.id}" data-field="vahta" type="number" min="1" value="${driverVahta(driver)}" class="w-16 border border-slate-200 rounded-lg px-2 py-1 text-sm text-slate-800" /> дн.
        </label>
        <label class="text-xs text-slate-400 flex items-center gap-1">Отдых
          <input data-id="${driver.id}" data-field="otdyh" type="number" min="1" value="${driverOtdyh(driver)}" class="w-16 border border-slate-200 rounded-lg px-2 py-1 text-sm text-slate-800" /> дн.
        </label>
      </div>`;
    driversCard.appendChild(row);
    row.querySelector("[data-del-driver]").onclick = () => {
      if (confirm(`Удалить ${driver.name || "этого водителя"} из списка?`)) {
        STATE.drivers = STATE.drivers.filter(d => d.id !== driver.id);
        render();
      }
    };
  });

  const addDriverBtn = el("button", "text-sm text-slate-600 font-semibold mt-1", "➕ Добавить водителя");
  addDriverBtn.onclick = () => {
    STATE.drivers.push({
      id: Date.now(),
      name: "",
      truck: STATE.trucks[0] || "",
      crew: "",
      role: "Основной",
      start: fmtISO(new Date()),
      vahta: 45,
      otdyh: 45,
    });
    render();
    setTimeout(() => {
      const inputs = document.querySelectorAll('[data-field="name"]');
      const last = inputs[inputs.length - 1];
      if (last) last.focus();
    }, 0);
  };
  driversCard.appendChild(addDriverBtn);
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
    document.querySelectorAll("[data-field]").forEach(inp => {
      const id = parseInt(inp.dataset.id, 10);
      const driver = STATE.drivers.find(d => d.id === id);
      if (!driver) return;
      const field = inp.dataset.field;
      if (field === "vahta" || field === "otdyh") {
        driver[field] = parseInt(inp.value, 10) || 45;
      } else {
        driver[field] = inp.value;
      }
    });
    // пустые (без ФИО) записи не сохраняем — так добавленный, но не заполненный
    // водитель не остаётся висеть в списке и не появляется в выборе для ТТН
    STATE.drivers = STATE.drivers.filter(d => d.name && d.name.trim());
    const cleanedTrucks = captureTruckInputs().map(t => t.trim()).filter(Boolean);
    if (cleanedTrucks.length) {
      STATE.trucks = cleanedTrucks;
      tempTrucks = cleanedTrucks.slice();
    }
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
      tempTrucks = null;
      render();
      saveCloudSettings(STATE).catch((e) => alert("Не удалось сбросить в общей базе: " + e.message));
    }
  };

  // ---------- аккаунты пользователей (логины + сброс пароля) ----------
  const accountsCard = el("div", "bg-white rounded-2xl shadow-sm p-4");
  accountsCard.innerHTML = `
    <div class="font-bold text-slate-700 mb-1">Аккаунты пользователей</div>
    <div class="text-xs text-slate-400 mb-3">Пароли не хранятся и не показываются — так устроена любая безопасная система. Можно отправить водителю письмо для установки нового пароля.</div>
    <div id="accounts-list" class="text-sm text-slate-400">Загрузка…</div>`;
  wrap.appendChild(accountsCard);

  db.collection("users").get().then((snap) => {
    const listEl = accountsCard.querySelector("#accounts-list");
    listEl.innerHTML = "";
    if (snap.empty) { listEl.textContent = "Пока нет зарегистрированных пользователей."; return; }
    snap.forEach((doc) => {
      const u = doc.data();
      const row = el("div", "border-t border-slate-100 py-2.5 first:border-t-0 first:pt-0 flex items-center gap-2");
      const info = el("div", "flex-1 min-w-0");
      info.innerHTML = `
        <div class="font-semibold text-slate-700 truncate">${escapeHtml(u.name || "—")}${u.role === "manager" ? " · рук." : ""}</div>
        <div class="text-xs text-slate-400 truncate">${escapeHtml(u.email || "—")}</div>`;
      row.appendChild(info);
      const resetPwBtn = el("button", "shrink-0 text-xs text-slate-500 bg-slate-100 px-2.5 py-1.5 rounded-lg font-medium", "Сброс пароля");
      resetPwBtn.onclick = async () => {
        if (!u.email) return alert("У этого аккаунта не указан email.");
        if (!confirm(`Отправить письмо для смены пароля на ${u.email}?`)) return;
        resetPwBtn.textContent = "…";
        try {
          await auth.sendPasswordResetEmail(u.email);
          alert("Письмо отправлено на " + u.email);
        } catch (e) {
          alert("Не удалось отправить: " + e.message);
        }
        resetPwBtn.textContent = "Сброс пароля";
      };
      row.appendChild(resetPwBtn);
      listEl.appendChild(row);
    });
  }).catch((e) => {
    accountsCard.querySelector("#accounts-list").textContent = "Не удалось загрузить: " + e.message;
  });

  app.appendChild(wrap);
}

// ---------- навигация ----------
function wireNav() {
  document.querySelectorAll(".tabbtn").forEach(btn => {
    btn.onclick = () => {
      currentTab = btn.dataset.tab;
      addFormOpen = false;
      if (typeof maintFormOpen !== "undefined") maintFormOpen = false;
      tempTrucks = null;
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
  if (typeof subscribeChat === "function") subscribeChat();
  if (typeof subscribeDocs === "function") subscribeDocs();
  if (typeof subscribeMaintenance === "function") subscribeMaintenance();
  if (typeof clearUnreadBadge === "function") clearUnreadBadge();

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
    <button class="tabbtn relative flex flex-col items-center gap-0.5 px-2 py-1 text-slate-400 text-[10px] font-medium" data-tab="timesheet"><span class="tabicon text-xl transition-transform">🧾</span>Табель</button>
    <button class="tabbtn relative flex flex-col items-center gap-0.5 px-2 py-1 text-slate-400 text-[10px] font-medium" data-tab="stats"><span class="tabicon text-xl transition-transform">📊</span>Статистика</button>
    <button class="tabbtn relative flex flex-col items-center gap-0.5 px-2 py-1 text-slate-400 text-[10px] font-medium" data-tab="documents"><span class="tabicon text-xl transition-transform">📄</span>ТТН</button>
    <button class="tabbtn relative flex flex-col items-center gap-0.5 px-2 py-1 text-slate-400 text-[10px] font-medium" data-tab="chat"><span class="tabicon text-xl transition-transform">💬</span>Чат</button>
    ${isManager ? `<button class="tabbtn relative flex flex-col items-center gap-0.5 px-2 py-1 text-slate-400 text-[10px] font-medium" data-tab="settings"><span class="tabicon text-xl transition-transform">⚙️</span>Настройки</button>` : ""}`;
}

