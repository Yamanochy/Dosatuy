// ============================================================
// ЧАТ — общий чат команды (водители + руководители)
// ============================================================

let chatCache = []; // сообщения, по возрастанию времени
let chatUnsub = null;
let chatScrollPinned = true; // прилипание к низу при новых сообщениях
const CHAT_LASTREAD_KEY = "vahta-chat-lastread";

function subscribeChat() {
  if (chatUnsub) return;
  chatUnsub = db.collection("chatMessages")
    .orderBy("createdAt", "desc")
    .limit(200)
    .onSnapshot((snap) => {
      chatCache = snap.docs.map((d) => ({ id: d.id, ...d.data() })).reverse();
      if (currentTab === "chat") renderChatMessages();
      updateChatNavBadge();
    }, (err) => console.error(err));
}

// ---------- значок непрочитанных на вкладке «Чат» в самом приложении ----------
function getLastReadTime() {
  return parseInt(localStorage.getItem(CHAT_LASTREAD_KEY) || "0", 10);
}
function unreadChatCount() {
  const lastRead = getLastReadTime();
  return chatCache.filter((m) => {
    if (!m.createdAt || !m.createdAt.toDate) return false; // ещё не подтверждено сервером
    if (currentUser && m.senderUid === currentUser.uid) return false; // свои не считаем
    return m.createdAt.toDate().getTime() > lastRead;
  }).length;
}
function markChatAsRead() {
  const last = chatCache[chatCache.length - 1];
  const t = last && last.createdAt && last.createdAt.toDate ? last.createdAt.toDate().getTime() : Date.now();
  localStorage.setItem(CHAT_LASTREAD_KEY, String(t));
  updateChatNavBadge();
}
function updateChatNavBadge() {
  const btn = document.querySelector('.tabbtn[data-tab="chat"]');
  if (!btn) return;
  let dot = btn.querySelector(".chat-unread-dot");
  const count = unreadChatCount();
  if (count > 0) {
    if (!dot) {
      dot = el("span", "chat-unread-dot absolute top-0.5 right-2.5 bg-rose-500 text-white text-[10px] leading-none rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 font-bold");
      btn.appendChild(dot);
    }
    dot.textContent = count > 9 ? "9+" : String(count);
  } else if (dot) {
    dot.remove();
  }
}

function fmtChatTime(ts) {
  if (!ts || !ts.toDate) return "";
  const d = ts.toDate();
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function renderChat() {
  app.innerHTML = "";
  subscribeChat();
  chatScrollPinned = true;

  const wrap = el("div", "pb-24");

  const header = el("div", "bg-white rounded-xl border border-slate-200 px-4 py-3 mb-3 flex items-center gap-2 flex-wrap");
  header.innerHTML = `<span class="text-xl">💬</span><span class="font-bold text-slate-700">Общий чат команды</span>`;
  const pushStatus = pushPermissionStatus();
  if (pushStatus === "default") {
    const bellBtn = el("button", "ml-auto text-xs font-semibold bg-diesel text-white px-3 py-1.5 rounded-full flex items-center gap-1", "🔔 Включить уведомления");
    bellBtn.onclick = async () => {
      bellBtn.textContent = "…";
      const ok = await enablePushNotifications();
      bellBtn.textContent = ok ? "🔔 Уведомления включены" : "🔔 Включить уведомления";
      if (ok) { bellBtn.disabled = true; bellBtn.classList.add("opacity-60"); }
    };
    header.appendChild(bellBtn);
  } else if (pushStatus === "granted") {
    header.appendChild(el("span", "ml-auto text-xs text-shift font-semibold", "🔔 включены"));
    enablePushNotifications(true); // тихо обновляем подписку на случай, если она "отвалилась"
  } else if (pushStatus === "denied") {
    header.appendChild(el("span", "ml-auto text-xs text-slate-400", "🔕 запрещены в браузере"));
  }
  if (currentProfile?.role === "manager") {
    const clearBtn = el("button", "text-xs text-rose-500 font-semibold shrink-0 basis-full text-right", "🗑 Очистить чат");
    clearBtn.onclick = clearAllChat;
    header.appendChild(clearBtn);
  }
  wrap.appendChild(header);

  const list = el("div", "space-y-2");
  list.id = "chat-list";
  wrap.appendChild(list);

  app.appendChild(wrap);
  renderChatMessages();
  renderChatInputBar();
  markChatAsRead();
}

async function clearAllChat() {
  if (!confirm("Удалить ВСЕ сообщения чата? Это действие нельзя отменить.")) return;
  try {
    const snap = await db.collection("chatMessages").get();
    let batch = db.batch();
    let count = 0;
    const commits = [];
    snap.docs.forEach((doc) => {
      batch.delete(doc.ref);
      count++;
      if (count === 450) { commits.push(batch.commit()); batch = db.batch(); count = 0; }
    });
    if (count > 0) commits.push(batch.commit());
    await Promise.all(commits);
  } catch (e) {
    alert("Не удалось очистить чат: " + e.message);
  }
}


function renderChatMessages() {
  const list = document.getElementById("chat-list");
  if (!list) return;
  const wasNearBottom = chatScrollPinned;

  list.innerHTML = "";
  if (!chatCache.length) {
    list.appendChild(el("div", "text-center text-slate-400 text-sm py-8", "Сообщений пока нет — напиши первым"));
  }
  let lastDay = "";
  chatCache.forEach((m) => {
    const d = m.createdAt && m.createdAt.toDate ? m.createdAt.toDate() : null;
    const dayLabel = d ? d.toLocaleDateString("ru-RU", { day: "2-digit", month: "long" }) : "";
    if (d && dayLabel !== lastDay) {
      lastDay = dayLabel;
      const divider = el("div", "text-center text-[11px] text-slate-400 py-1", dayLabel);
      list.appendChild(divider);
    }
    const isMine = currentUser && m.senderUid === currentUser.uid;
    const canDelete = isMine || currentProfile?.role === "manager";
    const row = el("div", `flex items-end gap-1.5 ${isMine ? "justify-end" : "justify-start"}`);

    if (canDelete) {
      const delBtn = el("button", `text-slate-300 text-xs shrink-0 ${isMine ? "order-1" : "order-2"}`, "✕");
      delBtn.onclick = () => {
        if (confirm("Удалить это сообщение?")) db.collection("chatMessages").doc(m.id).delete();
      };
      row.appendChild(delBtn);
    }

    const bubble = el("div", `max-w-[70%] rounded-xl px-3 py-2 ${isMine ? "bg-diesel text-white rounded-br-sm order-none" : "bg-white text-slate-800 rounded-bl-sm shadow-sm order-1"}`);
    const roleTag = m.senderRole === "manager" ? " · рук." : "";
    let bodyHtml = "";
    if (!isMine) bodyHtml += `<div class="text-[11px] font-semibold text-slate-400 mb-0.5">${escapeHtml(m.senderName || "")}${roleTag}</div>`;
    if (m.imageUrl) {
      bodyHtml += `<img src="${m.imageUrl}" class="rounded-lg max-h-56 w-full object-cover cursor-pointer mb-1" />`;
    }
    if (m.text) {
      bodyHtml += `<div class="text-sm whitespace-pre-wrap break-words">${escapeHtml(m.text)}</div>`;
    }
    bodyHtml += `<div class="text-[10px] ${isMine ? "text-slate-300" : "text-slate-400"} text-right mt-0.5">${fmtChatTime(m.createdAt)}</div>`;
    bubble.innerHTML = bodyHtml;
    if (m.imageUrl) {
      bubble.querySelector("img").onclick = () => openLightbox(m.imageUrl);
    }
    row.appendChild(bubble);
    list.appendChild(row);
  });

  if (wasNearBottom) {
    window.scrollTo({ top: document.body.scrollHeight });
  }
}

let chatPendingImage = null; // File — фото, прикреплённое к следующему сообщению

function renderChatInputBar() {
  const existing = document.getElementById("chat-input-bar");
  if (existing) existing.remove();

  const bar = el("div", "fixed left-0 right-0 bottom-[64px] px-3 pb-2 z-10");
  bar.id = "chat-input-bar";
  const inner = el("div", "max-w-md mx-auto bg-white rounded-xl shadow-lg p-2 border border-slate-100");
  inner.innerHTML = `
    <div id="chat-img-preview" class="hidden relative w-16 h-16 mb-2">
      <img class="w-16 h-16 object-cover rounded-lg" />
      <button id="chat-img-remove" type="button" class="absolute -top-1.5 -right-1.5 bg-diesel text-white rounded-full w-5 h-5 text-xs flex items-center justify-center">✕</button>
    </div>
    <div class="flex items-end gap-2">
      <button id="chat-attach" type="button" class="shrink-0 text-slate-400 w-9 h-9 flex items-center justify-center text-xl">📎</button>
      <input id="chat-photo-input" type="file" accept="image/*" class="hidden" />
      <textarea id="chat-text" rows="1" placeholder="Написать сообщение…"
        class="flex-1 resize-none max-h-24 border-0 focus:ring-0 outline-none text-sm px-2 py-2"></textarea>
      <button id="chat-send" class="shrink-0 bg-diesel text-white rounded-full w-10 h-10 flex items-center justify-center text-lg">➤</button>
    </div>`;
  bar.appendChild(inner);
  document.body.appendChild(bar);

  const textarea = document.getElementById("chat-text");
  const sendBtn = document.getElementById("chat-send");
  const attachBtn = document.getElementById("chat-attach");
  const photoInput = document.getElementById("chat-photo-input");
  const preview = document.getElementById("chat-img-preview");
  const removeBtn = document.getElementById("chat-img-remove");

  attachBtn.onclick = () => photoInput.click();
  photoInput.onchange = (e) => {
    const file = e.target.files[0];
    photoInput.value = "";
    if (!file) return;
    chatPendingImage = file;
    const reader = new FileReader();
    reader.onload = (ev) => {
      preview.querySelector("img").src = ev.target.result;
      preview.classList.remove("hidden");
    };
    reader.readAsDataURL(file);
  };
  removeBtn.onclick = () => {
    chatPendingImage = null;
    preview.classList.add("hidden");
  };

  textarea.addEventListener("input", () => {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 96) + "px";
  });

  let isSending = false; // защита от двойной отправки (Android иногда шлёт Enter дважды)

  async function send() {
    if (isSending) return;
    const text = textarea.value.trim();
    if (!text && !chatPendingImage) return;
    isSending = true;
    textarea.value = "";
    textarea.style.height = "auto";
    sendBtn.disabled = true;
    try {
      let imageUrl = null;
      if (chatPendingImage) {
        sendBtn.textContent = "…";
        const resized = await resizeImage(chatPendingImage);
        imageUrl = await uploadToCloudinary(resized);
      }
      await db.collection("chatMessages").add({
        text,
        imageUrl: imageUrl || null,
        senderUid: currentUser.uid,
        senderName: currentProfile.name,
        senderRole: currentProfile.role,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      chatPendingImage = null;
      preview.classList.add("hidden");
    } catch (e) {
      alert("Не удалось отправить: " + e.message);
    }
    isSending = false;
    sendBtn.disabled = false;
    sendBtn.textContent = "➤";
    textarea.focus();
  }

  sendBtn.onclick = send;
  textarea.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };
}

function removeChatInputBar() {
  const existing = document.getElementById("chat-input-bar");
  if (existing) existing.remove();
}
