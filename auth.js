// ============================================================
// АВТОРИЗАЦИЯ — регистрация/вход водителей и руководителей
// ============================================================

let currentUser = null;     // объект firebase auth
let currentProfile = null;  // { name, email, role } из Firestore
let pendingAuthMessage = ""; // переживает повторный onAuthStateChanged(null) после signOut()

const authScreen = document.getElementById("auth-screen");
const shell = document.getElementById("app-shell");

function elA(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function renderAuthScreen(mode = "login", errorMsg = "") {
  shell.classList.add("hidden");
  authScreen.classList.remove("hidden");
  authScreen.innerHTML = "";

  const wrap = elA("div", "min-h-screen flex items-center justify-center px-4");
  const card = elA("div", "bg-white rounded-2xl shadow-lg p-6 w-full max-w-sm");

  card.innerHTML = `
    <div class="text-center mb-5">
      <img src="icon-192.png" alt="" class="w-16 h-16 rounded-2xl shadow mx-auto mb-2" />
      <div class="font-extrabold text-lg text-slate-800">Вахта 45×45</div>
      <div class="text-xs text-slate-400">п. Досатуй — личный кабинет</div>
    </div>`;

  const err = elA("div", "text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2 mb-3" + (errorMsg ? "" : " hidden"), errorMsg);
  err.id = "auth-error";
  card.appendChild(err);

  const form = elA("div", "space-y-3");

  if (mode === "register") {
    form.innerHTML = `
      <input id="af-name" placeholder="ФИО" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
      <input id="af-email" type="email" placeholder="Email" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
      <input id="af-pass" type="password" placeholder="Пароль (мин. 6 символов)" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
      <select id="af-role" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
        <option value="driver">Водитель</option>
        <option value="manager">Руководитель</option>
      </select>
      <input id="af-code" placeholder="Код руководителя (если применимо)" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm hidden" />
      <button id="af-submit" class="w-full py-2.5 rounded-lg bg-slate-800 text-white font-semibold text-sm">Зарегистрироваться</button>
      <div class="text-center text-xs text-slate-400 pt-1">Уже есть аккаунт? <a href="#" id="af-toggle" class="text-slate-700 font-semibold underline">Войти</a></div>`;
  } else {
    form.innerHTML = `
      <input id="af-email" type="email" placeholder="Email" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
      <input id="af-pass" type="password" placeholder="Пароль" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
      <button id="af-submit" class="w-full py-2.5 rounded-lg bg-slate-800 text-white font-semibold text-sm">Войти</button>
      <div class="text-center text-xs text-slate-400 pt-1">Нет аккаунта? <a href="#" id="af-toggle" class="text-slate-700 font-semibold underline">Зарегистрироваться</a></div>`;
  }

  card.appendChild(form);
  wrap.appendChild(card);
  authScreen.appendChild(wrap);

  document.getElementById("af-toggle").onclick = (e) => {
    e.preventDefault();
    renderAuthScreen(mode === "login" ? "register" : "login");
  };

  const roleSel = document.getElementById("af-role");
  if (roleSel) {
    roleSel.onchange = () => {
      document.getElementById("af-code").classList.toggle("hidden", roleSel.value !== "manager");
    };
  }

  document.getElementById("af-submit").onclick = () => {
    const email = document.getElementById("af-email").value.trim();
    const pass = document.getElementById("af-pass").value;
    if (mode === "register") {
      const name = document.getElementById("af-name").value.trim();
      const role = document.getElementById("af-role").value;
      const code = document.getElementById("af-code").value.trim();
      if (!name || !email || pass.length < 6) {
        return showAuthError("Заполни ФИО, email и пароль (мин. 6 символов).");
      }
      if (role === "manager" && code !== MANAGER_CODE) {
        return showAuthError("Неверный код руководителя.");
      }
      auth.createUserWithEmailAndPassword(email, pass)
        .then((cred) => db.collection("users").doc(cred.user.uid).set({
          name, email, role, createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        }))
        .catch((e) => showAuthError(translateAuthError(e)));
    } else {
      if (!email || !pass) return showAuthError("Введи email и пароль.");
      auth.signInWithEmailAndPassword(email, pass)
        .catch((e) => showAuthError(translateAuthError(e)));
    }
  };
}

function showAuthError(msg) {
  const e = document.getElementById("auth-error");
  e.textContent = msg;
  e.classList.remove("hidden");
}

function translateAuthError(e) {
  const map = {
    "auth/email-already-in-use": "Этот email уже зарегистрирован.",
    "auth/invalid-email": "Некорректный email.",
    "auth/weak-password": "Пароль слишком простой (мин. 6 символов).",
    "auth/user-not-found": "Пользователь не найден.",
    "auth/wrong-password": "Неверный пароль.",
    "auth/invalid-credential": "Неверный email или пароль.",
    "auth/user-disabled": "Доступ к приложению отключён. Обратись к руководителю.",
  };
  return map[e.code] || ("Ошибка: " + e.message);
}

function logout() {
  auth.signOut();
}

auth.onAuthStateChanged((user) => {
  if (user) {
    currentUser = user;
    db.collection("users").doc(user.uid).get().then((doc) => {
      currentProfile = doc.exists ? doc.data() : { name: user.email, role: "driver" };
      if (currentProfile.disabled) {
        // доступ отключён руководителем — не пускаем дальше, даже если
        // старый токен формально ещё не истёк.
        // ВАЖНО: signOut() асинхронно вызовет этот же обработчик ещё раз,
        // уже с user=null — сообщение кладём в переменную, которая
        // переживёт этот второй вызов, а не теряется вместе с аргументом
        pendingAuthMessage = "Доступ к приложению отключён. Обратись к руководителю.";
        auth.signOut();
        renderAuthScreen("login", pendingAuthMessage);
        return;
      }
      authScreen.classList.add("hidden");
      shell.classList.remove("hidden");
      startApp();
    }).catch(() => {
      // офлайн и в локальном кэше Firestore ещё нет этого документа —
      // не оставляем белый экран, показываем с тем, что есть
      currentProfile = { name: user.email, role: "driver" };
      authScreen.classList.add("hidden");
      shell.classList.remove("hidden");
      startApp();
    });
  } else {
    currentUser = null;
    currentProfile = null;
    renderAuthScreen("login", pendingAuthMessage);
    pendingAuthMessage = ""; // показали один раз — дальше обычный пустой логин
  }
});
