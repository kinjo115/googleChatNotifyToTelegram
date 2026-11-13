const status = document.querySelector("#status");

function age(ts) {
  if (!ts) return "";
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  return `${Math.round(min / 60)} hr ago`;
}

async function render() {
  const stored = await chrome.storage.local.get({
    telegramBotToken: "",
    telegramChatId: "",
    enabled: true,
    lastError: "",
    lastScanAt: 0,
    lastSentAt: 0,
    scanTopics: 0,
    scanUnread: 0,
    scanFlagged: 0,
  });
  const tabs = await chrome.tabs.query({ url: "https://chat.google.com/*" });
  const lines = [];
  if (!stored.telegramBotToken || !stored.telegramChatId) {
    lines.push("Add the Telegram bot token and chat id in Settings.");
  } else if (stored.enabled === false) {
    lines.push("Forwarding is off.");
  } else {
    lines.push("Forwarding is on.");
  }
  lines.push(tabs.length ? "Google Chat is open." : "Open Google Chat and leave that tab running.");
  if (stored.lastScanAt) {
    lines.push(`Last look ${age(stored.lastScanAt)}: ${stored.scanTopics} threads, ${stored.scanUnread} unread, ${stored.scanFlagged} new.`);
    if (!stored.scanTopics) lines.push("Refresh the Chat tab. The watcher cannot see conversations yet.");
  } else if (tabs.length) {
    lines.push("Waiting for the Chat tab to finish loading.");
  }
  lines.push(stored.lastSentAt ? `Last Telegram send ${age(stored.lastSentAt)}.` : "No Telegram send yet.");
  if (stored.lastError) lines.push(stored.lastError);
  status.textContent = lines.join("\n");
}

document.querySelector("#open").addEventListener("click", async () => {
  const tabs = await chrome.tabs.query({ url: "https://chat.google.com/*" });
  if (tabs[0]?.id) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    if (tabs[0].windowId) await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: "https://chat.google.com/" });
  }
  window.close();
});

document.querySelector("#options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

render();
