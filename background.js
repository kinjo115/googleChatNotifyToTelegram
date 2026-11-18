const SESSION_KEYS = "seenKeys";
const SESSION_PRIMED = "primed";
const SEEN_VERSION = "5";

let seen = new Set();
let primed = false;
let lastError = "";
let loaded = false;
let lastNote = 0;
const inflight = new Set();

async function loadSession() {
  if (loaded) return;
  const stored = await chrome.storage.session.get({
    [SESSION_KEYS]: [],
    [SESSION_PRIMED]: false,
    seenVersion: "",
  });
  if (stored.seenVersion !== SEEN_VERSION) {
    seen = new Set();
    primed = true;
    loaded = true;
    await saveSession();
    return;
  } else {
    seen = new Set(stored[SESSION_KEYS] || []);
    primed = Boolean(stored[SESSION_PRIMED]);
  }
  loaded = true;
}

async function saveSession() {
  const keys = [...seen];
  await chrome.storage.session.set({
    [SESSION_KEYS]: keys.slice(-500),
    [SESSION_PRIMED]: primed,
    seenVersion: SEEN_VERSION,
  });
  if (keys.length > 500) seen = new Set(keys.slice(-500));
}

async function settings() {
  return chrome.storage.local.get({
    telegramBotToken: "",
    telegramChatId: "",
    enabled: true,
  });
}

function clip(text) {
  if (text.length <= 3900) return text;
  return text.slice(0, 3900) + "\n…";
}

async function sendTelegram(text) {
  const config = await settings();
  if (!config.enabled) return;
  if (!config.telegramBotToken || !config.telegramChatId) {
    throw new Error("Add the Telegram bot token and chat id in the extension options.");
  }
  const response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: config.telegramChatId,
      text: clip(text),
      disable_web_page_preview: true,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) {
    throw new Error(body.description || `Telegram HTTP ${response.status}`);
  }
}

async function rememberError(error) {
  lastError = error;
  await chrome.storage.local.set({ lastError: error });
  await chrome.action.setBadgeText({ text: "!" });
  await chrome.action.setBadgeBackgroundColor({ color: "#b91c1c" });
}

async function clearError() {
  lastError = "";
  await chrome.storage.local.set({ lastError: "" });
  await chrome.action.setBadgeText({ text: "" });
}

async function noteScan(stats) {
  const now = Date.now();
  if (now - lastNote < 8000) return;
  lastNote = now;
  await chrome.storage.local.set({
    lastScanAt: now,
    scanTopics: Number(stats.topics) || 0,
    scanMessages: Number(stats.messages) || 0,
    scanUnread: Number(stats.unread) || 0,
    scanFlagged: Number(stats.flagged) || 0,
  });
}

async function forwardNew(rows) {
  const config = await settings();
  if (!config.enabled) {
    for (const row of rows) seen.add(row.key);
    await saveSession();
    return;
  }
  for (const row of rows) {
    if (seen.has(row.key) || inflight.has(row.key)) continue;
    inflight.add(row.key);
    try {
      await sendTelegram(`Google Chat\n${row.name}\n${row.preview}`);
      seen.add(row.key);
      await saveSession();
      await chrome.storage.local.set({ lastSentAt: Date.now() });
      await clearError();
    } catch (error) {
      await rememberError(error.message || String(error));
      break;
    } finally {
      inflight.delete(row.key);
    }
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "test-telegram") {
    sendTelegram("Google Chat notifier is connected.\nNew Google Chat messages will show up here.")
      .then(async () => {
        await clearError();
        sendResponse({ ok: true });
      })
      .catch(async (error) => {
        await rememberError(error.message || String(error));
        sendResponse({ ok: false, error: error.message || String(error) });
      });
    return true;
  }

  if (message?.type === "watch-error") {
    rememberError(message.error || "Chat watcher failed.");
    return;
  }

  if (message?.type !== "unread-snapshot") return;

  const listCount = Number(message.listCount) || 0;
  const rows = Array.isArray(message.rows) ? message.rows : [];
  const stats = message.stats || {};
  loadSession()
    .then(async () => {
      await noteScan(stats);
      if (listCount < 1 && !stats.topics) return;
      if (!primed) {
        primed = true;
        await saveSession();
        console.log("[chat-telegram] Watching for new messages.");
      }
      await forwardNew(rows);
    })
    .catch((error) => {
      console.error("[chat-telegram]", error);
    });
});

chrome.storage.local.onChanged.addListener((changes) => {
  if (changes.telegramBotToken || changes.telegramChatId || changes.enabled) {
    lastError = "";
    chrome.action.setBadgeText({ text: "" });
  }
});
