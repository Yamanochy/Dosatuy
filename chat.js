// ============================================================
// ЧАТ — общий чат команды (водители + руководители)
// ============================================================

let chatCache = []; // сообщения, по возрастанию времени
let chatUnsub = null;
let chatScrollPinned = true; // прилипание к низу при новых сообщениях

function subscribeChat() {
  if (chatUnsub) return;
  chatUnsub = db.collection("chatMessages")
    .orderBy("createdAt", "desc")
    .limit(200)
    .onSnapshot((snap) => {
      chatCache = snap.docs.map((d) => ({ id: d.id, ...d.data() })).reverse();
      if (currentTab === "chat") renderChatMessages();
    }, (err) => console.error(err));
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

  const header = el("div", "bg-white rounded-2xl shadow-sm px-4 py-3 mb-3 flex items-center gap-2");
  header.innerHTML = `<span class="text-xl">💬</span><span class="font-bold text-slate-700">Общий чат команды</span>`;
  const pushStatus = pushPermissionStatus();
  if (pushStatus === "default") {
    const bellBtn = el("button", "ml-auto text-xs font-semibold bg-slate-800 text-white px-3 py-1.5 rounded-full flex items-center gap-1", "🔔 Включить уведомления");
    bellBtn.onclick = async () => {
      bellBtn.textContent = "…";
      const ok = await enablePushNotifications();
      bellBtn.textContent = ok ? "🔔 Уведомления включены" : "🔔 Включить уведомления";
      if (ok) { bellBtn.disabled = true; bellBtn.classList.add("opacity-60"); }
    };
    header.appendChild(bellBtn);
  } else if (pushStatus === "granted") {
    header.appendChild(el("span", "ml-auto text-xs text-emerald-600 font-semibold", "🔔 включены"));
  } else if (pushStatus === "denied") {
    header.appendChild(el("span", "ml-auto text-xs text-slate-400", "🔕 запрещены в браузере"));
  }
  wrap.appendChild(header);

  const list = el("div", "space-y-2");
  list.id = "chat-list";
  wrap.appendChild(list);

  app.appendChild(wrap);
  renderChatMessages();
  renderChatInputBar();
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
    const row = el("div", `flex ${isMine ? "justify-end" : "justify-start"}`);
    const bubble = el("div", `max-w-[75%] rounded-2xl px-3 py-2 ${isMine ? "bg-slate-800 text-white rounded-br-sm" : "bg-white text-slate-800 rounded-bl-sm shadow-sm"}`);
    const roleTag = m.senderRole === "manager" ? " · рук." : "";
    bubble.innerHTML = `
      ${!isMine ? `<div class="text-[11px] font-semibold ${isMine ? "text-slate-300" : "text-slate-400"} mb-0.5">${escapeHtml(m.senderName || "")}${roleTag}</div>` : ""}
      <div class="text-sm whitespace-pre-wrap break-words">${escapeHtml(m.text)}</div>
      <div class="text-[10px] ${isMine ? "text-slate-300" : "text-slate-400"} text-right mt-0.5">${fmtChatTime(m.createdAt)}</div>`;
    row.appendChild(bubble);
    list.appendChild(row);
  });

  if (wasNearBottom) {
    window.scrollTo({ top: document.body.scrollHeight });
  }
}

function renderChatInputBar() {
  const existing = document.getElementById("chat-input-bar");
  if (existing) existing.remove();

  const bar = el("div", "fixed left-0 right-0 bottom-[64px] px-3 pb-2 z-10");
  bar.id = "chat-input-bar";
  const inner = el("div", "max-w-md mx-auto bg-white rounded-2xl shadow-lg p-2 flex items-end gap-2 border border-slate-100");
  inner.innerHTML = `
    <textarea id="chat-text" rows="1" placeholder="Написать сообщение…"
      class="flex-1 resize-none max-h-24 border-0 focus:ring-0 outline-none text-sm px-2 py-2"></textarea>
    <button id="chat-send" class="shrink-0 bg-slate-800 text-white rounded-full w-10 h-10 flex items-center justify-center text-lg">➤</button>`;
  bar.appendChild(inner);
  document.body.appendChild(bar);

  const textarea = document.getElementById("chat-text");
  const sendBtn = document.getElementById("chat-send");

  textarea.addEventListener("input", () => {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 96) + "px";
  });

  async function send() {
    const text = textarea.value.trim();
    if (!text) return;
    textarea.value = "";
    textarea.style.height = "auto";
    sendBtn.disabled = true;
    try {
      await db.collection("chatMessages").add({
        text,
        senderUid: currentUser.uid,
        senderName: currentProfile.name,
        senderRole: currentProfile.role,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) {
      alert("Не удалось отправить: " + e.message);
    }
    sendBtn.disabled = false;
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
