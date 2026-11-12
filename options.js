const tokenInput = document.querySelector("#token");
const chatIdInput = document.querySelector("#chatId");
const enabledInput = document.querySelector("#enabled");
const forwardOwnInput = document.querySelector("#forwardOwn");
const status = document.querySelector("#status");

function show(text) {
  status.textContent = text;
}

async function load() {
  const stored = await chrome.storage.local.get({
    telegramBotToken: "",
    telegramChatId: "",
    enabled: true,
    forwardOwn: false,
  });
  tokenInput.value = stored.telegramBotToken;
  chatIdInput.value = stored.telegramChatId;
  enabledInput.checked = stored.enabled !== false;
  forwardOwnInput.checked = Boolean(stored.forwardOwn);
}

document.querySelector("#form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await chrome.storage.local.set({
    telegramBotToken: tokenInput.value.trim(),
    telegramChatId: chatIdInput.value.trim(),
    enabled: enabledInput.checked,
    forwardOwn: forwardOwnInput.checked,
  });
  show("Saved.");
});

document.querySelector("#find").addEventListener("click", async () => {
  const token = tokenInput.value.trim();
  if (!token) {
    show("Paste the bot token first.");
    return;
  }
  show("Checking Telegram…");
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
    const body = await response.json();
    if (!body.ok) throw new Error(body.description || "Telegram rejected the token.");
    const found = new Map();
    for (const update of body.result || []) {
      const chat = update.message?.chat || update.edited_message?.chat;
      if (!chat?.id) continue;
      const title = chat.title || chat.username || [chat.first_name, chat.last_name].filter(Boolean).join(" ");
      found.set(String(chat.id), title);
    }
    if (found.size === 0) {
      show("No messages yet. Open the bot in Telegram, send it a message, then click Find chat id again.");
      return;
    }
    const lines = [...found.entries()].map(([id, title]) => `${id}${title ? ` (${title})` : ""}`);
    if (found.size === 1) chatIdInput.value = [...found.keys()][0];
    show(lines.join("\n"));
  } catch (error) {
    show(error.message || String(error));
  }
});

document.querySelector("#test").addEventListener("click", async () => {
  await chrome.storage.local.set({
    telegramBotToken: tokenInput.value.trim(),
    telegramChatId: chatIdInput.value.trim(),
    enabled: enabledInput.checked,
    forwardOwn: forwardOwnInput.checked,
  });
  show("Sending…");
  const result = await chrome.runtime.sendMessage({ type: "test-telegram" });
  show(result?.ok ? "Test message sent." : result?.error || "Could not send the test message.");
});

load();
