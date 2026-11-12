const status = document.querySelector("#status");

async function render() {
  const stored = await chrome.storage.local.get({
    telegramBotToken: "",
    telegramChatId: "",
    enabled: true,
    lastError: "",
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
