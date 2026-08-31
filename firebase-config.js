// ============================================================
// FIREBASE — вставь сюда свой firebaseConfig из шага 1.7 инструкции
// (Project settings → Your apps → значок </> → Register app)
// ============================================================
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyA4BZspRcmA8I_j6mUtIvIHJcTd22k48fg",
  authDomain: "dosatuy.firebaseapp.com",
  projectId: "dosatuy",
  storageBucket: "dosatuy.firebasestorage.app",
  messagingSenderId: "630795971089",
  appId: "1:630795971089:web:3b80b4d2436bbcc9ac5fb0",
};

firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();
const db = firebase.firestore();
const funcs = firebase.functions();

// Офлайн-кэш Firestore: без этого запросы к базе зависают без сети
// и приложение остаётся на белом экране, если открыть его офлайн.
db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

// Код, который нужно ввести при регистрации с ролью «Руководитель»,
// чтобы случайный человек не мог сам себе выдать права руководителя.
// Смени на свой секрет.
const MANAGER_CODE = "dosatuy2026";
