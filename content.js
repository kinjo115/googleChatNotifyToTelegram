const SCAN_MS = 2500;
const FRESH_MS = 90 * 1000;

let timer = 0;
let waitingSince = 0;
const armedTopic = new Map();
const armedRoomTime = new Map();

function linesOf(el) {
  return (el.innerText || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isMeta(line) {
  if (/^\d{1,4}$/.test(line)) return true;
  if (/^(오전|오후)\s*\d{1,2}:\d{2}$/.test(line)) return true;
  if (/^\d{1,2}:\d{2}(\s*[AP]M)?$/i.test(line)) return true;
  if (/^(어제|오늘|yesterday|today|mon|tue|wed|thu|fri|sat|sun|월|화|수|목|금|토|일)$/i.test(line)) return true;
  if (/^\d{1,2}월\s*\d{1,2}일$/.test(line)) return true;
  if (/^\d{1,2}\/\d{1,2}$/.test(line)) return true;
  if (/^(space|스페이스)$/i.test(line)) return true;
  return false;
}

function isYou(name) {
  return /^(you|나|회원님)$/i.test((name || "").trim());
}

function isOwn(preview) {
  return /^(you|나|회원님)\s*[:：]/i.test(preview);
}

function textOf(el) {
  if (!el) return "";
  return (el.innerText || "")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clip(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

function positiveCount(el, attr) {
  if (!el) return 0;
  const value = parseInt(el.getAttribute(attr) || "", 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function groupIdOf(el) {
  const host = el.closest("[data-group-id]");
  return host ? host.getAttribute("data-group-id") || "" : "";
}

function findGroupItem(groupId) {
  if (!groupId) return null;
  for (const item of document.querySelectorAll('[role="listitem"][data-group-id]')) {
    if (item.getAttribute("data-group-id") === groupId) return item;
  }
  return null;
}

function conversationName(groupId) {
  const item = findGroupItem(groupId);
  if (!item) return "";
  const fromBdi = textOf(item.querySelector("bdi"));
  if (fromBdi) return fromBdi;
  const fromPerson = textOf(item.querySelector('[jsname="oU6v8b"]'));
  if (fromPerson) return fromPerson;
  return linesOf(item).find((line) => !isMeta(line)) || "";
}

function senderName(scope) {
  if (!scope) return "";
  return textOf(scope.querySelector('[jsname="oU6v8b"]'));
}

function messageBody(scope) {
  if (!scope) return "";
  return textOf(scope.querySelector('[jsname="bgckF"]'));
}

function isHidden(el) {
  if (!el) return true;
  let node = el;
  for (let depth = 0; depth < 5 && node && node !== document.body; depth += 1) {
    if (node.classList && node.classList.contains("eLNT1d")) return true;
    node = node.parentElement;
  }
  try {
    const style = window.getComputedStyle(el);
    return style.display === "none" || style.visibility === "hidden";
  } catch {
    return false;
  }
}

function isFresh(ts) {
  if (!ts) return false;
  const delta = Date.now() - ts;
  return delta >= -15000 && delta <= FRESH_MS;
}

function unreadCount(topic) {
  let best = Math.max(
    positiveCount(topic, "data-unread-reply-count-to-display"),
    positiveCount(topic, "data-unread-reply-count")
  );
  for (const el of topic.querySelectorAll("[data-unread-reply-count], [data-unread-reply-count-to-display]")) {
    best = Math.max(
      best,
      positiveCount(el, "data-unread-reply-count-to-display"),
      positiveCount(el, "data-unread-reply-count")
    );
  }
  return best;
}

function queryByDataId(scope, id) {
  const escaped = window.CSS && CSS.escape ? CSS.escape(id) : id.replace(/"/g, "");
  return scope.querySelector(`[data-id="${escaped}"]`);
}

function unreadLabel(topic, count) {
  for (const el of topic.querySelectorAll("[aria-label]")) {
    const label = (el.getAttribute("aria-label") || "").trim();
    if (!/unread|읽지/i.test(label) || label.length > 40) continue;
    if (/toggle|filter|shortcut|more\s/i.test(label)) continue;
    return label;
  }
  const chip = textOf(topic.querySelector('[jsname="sp9p4"]')).replace(/,\s*$/, "");
  if (chip && chip.length < 40 && /unread|읽지/i.test(chip)) return chip;
  return count === 1 ? "1 unread reply" : `${count} unread replies`;
}

function replyTime(topic) {
  const shown = Number(topic.getAttribute("data-last-reply-time-msec-to-display") || "");
  let max = Number.isFinite(shown) && shown > 0 ? shown : 0;
  const own = Number(topic.getAttribute("data-last-reply-time-msec") || "");
  if (Number.isFinite(own) && own > max) max = own;
  for (const el of topic.querySelectorAll("[data-last-reply-time-msec]")) {
    const value = Number(el.getAttribute("data-last-reply-time-msec") || "");
    if (Number.isFinite(value) && value > max) max = value;
  }
  return max;
}

function lastReplyTime(topic) {
  const time = replyTime(topic);
  return time ? String(time) : "";
}

function topicNodes() {
  const byId = new Map();
  for (const node of document.querySelectorAll("c-wiz[data-topic-id]")) {
    if (node.closest("[data-shortcut-type]")) continue;
    const id = node.getAttribute("data-topic-id") || "";
    if (!id) continue;
    const prev = byId.get(id);
    if (!prev || replyTime(node) >= replyTime(prev)) byId.set(id, node);
  }
  return [...byId.values()];
}

function topicChanged(topicId, time, count) {
  const prev = armedTopic.get(topicId);
  if (!prev) {
    armedTopic.set(topicId, { time: time || 0, count: count || 0 });
    return false;
  }
  const countGrew = count > prev.count && isFresh(time);
  const timeGrew = time > prev.time && isFresh(time);
  armedTopic.set(topicId, { time: Math.max(prev.time, time || 0), count });
  return countGrew || timeGrew;
}

function messageContainer(stampEl) {
  let node = stampEl.parentElement;
  for (let depth = 0; depth < 12 && node; depth += 1) {
    if (node.matches && node.matches("c-wiz, [role='main']")) break;
    const bodies = node.querySelectorAll('[jsname="bgckF"]').length;
    if (bodies > 1) break;
    const stamps = node.querySelectorAll("[data-absolute-timestamp]").length;
    if (bodies === 1 && stamps === 1 && node.querySelector('[jsname="oU6v8b"]')) return node;
    node = node.parentElement;
  }
  return null;
}

function containerIsOwn(container) {
  if (!container) return false;
  if (container.getAttribute("data-is-viewer-message-creator") === "true") return true;
  const flagged = container.querySelector('[data-is-viewer-message-creator="true"]');
  return Boolean(flagged && flagged.querySelector('[jsname="bgckF"]'));
}

function latestMessage(scope) {
  let best = null;
  if (!scope) return null;
  for (const stamp of scope.querySelectorAll("[data-absolute-timestamp]")) {
    if (isHidden(stamp) || stamp.closest('[role="textbox"], [contenteditable="true"]')) continue;
    const ts = Number(stamp.getAttribute("data-absolute-timestamp") || "");
    if (!Number.isFinite(ts) || (best && ts < best.ts)) continue;
    const container = messageContainer(stamp);
    const body = messageBody(container);
    const sender = senderName(container);
    if (!body && !sender) continue;
    best = { ts, container, body, sender };
  }
  return best;
}

function timeCovered(times, time) {
  for (const value of times) {
    if (Math.abs(value - time) < 3000) return true;
  }
  return false;
}

function rowFromLive(groupId, topicId, time, scope, forwardOwn) {
  const latest = latestMessage(scope);
  const matched = latest && time && Math.abs(latest.ts - time) < 5000;
  const sender = matched ? latest.sender : "";
  const container = matched ? latest.container : null;
  if (matched && !forwardOwn && (isYou(sender) || containerIsOwn(container))) return null;
  let preview = "New message";
  if (matched && latest.body) {
    preview = sender && !isYou(sender) ? `${sender}: ${latest.body}` : latest.body;
  }
  preview = clip(preview, 700);
  if (!forwardOwn && isOwn(preview)) return null;
  const place = conversationName(groupId);
  let name = place || (!isYou(sender) ? sender : "") || "Google Chat";
  if (place && sender && !isYou(sender) && sender !== place) name = `${place} · ${sender}`;
  const key = ["live", groupId || "group", topicId || "room", String(time)].join("|");
  return { name: clip(name, 160), preview, key, groupId };
}

function rowFromTopic(topic, count, forwardOwn) {
  const topicId = topic.getAttribute("data-topic-id") || "";
  const groupId = groupIdOf(topic);
  const root = (topicId && queryByDataId(topic, topicId)) || topic.querySelector("[data-id]");
  const sender = senderName(root || topic);
  const replies = [...topic.querySelectorAll("[data-id]")].filter((el) => {
    return el.getAttribute("data-is-initial-message-of-thread") !== "true" && el !== root;
  });
  const parts = [];
  for (const node of replies.slice(-count)) {
    const who = senderName(node);
    if (!forwardOwn && isYou(who)) continue;
    const body = messageBody(node);
    if (!body) continue;
    parts.push(who ? `${who}: ${body}` : body);
  }
  let preview = parts.join("\n");
  if (!preview) {
    const onlySelf = replies.length > 0 && replies.every((node) => isYou(senderName(node)));
    if (onlySelf && !forwardOwn) return null;
    const rootBody = messageBody(root || topic);
    preview = [unreadLabel(topic, count), rootBody].filter(Boolean).join("\n");
  }
  preview = clip(preview, 700);
  if (!preview) return null;
  const place = conversationName(groupId);
  let name = place || (!isYou(sender) ? sender : "") || "Google Chat";
  if (place && sender && !isYou(sender) && sender !== place) name = `${place} · ${sender}`;
  const key = [groupId || "group", topicId || "topic", String(count), lastReplyTime(topic) || preview].join("|");
  return { name: clip(name, 160), preview, key, groupId };
}

function navIsUnread(item) {
  if (item.hasAttribute("data-shortcut-type") || item.closest("[data-shortcut-type]")) return false;
  for (const el of item.querySelectorAll("[aria-label]")) {
    const label = el.getAttribute("aria-label") || "";
    if (!/unread|읽지 않/i.test(label)) continue;
    if (/toggle|filter|shortcut|more unread|더 보/i.test(label)) continue;
    if (isHidden(el)) continue;
    return true;
  }
  for (const el of item.querySelectorAll("[data-is-unread]")) {
    const value = el.getAttribute("data-is-unread");
    if (value !== "false" && value !== "0" && !isHidden(el)) return true;
  }
  return false;
}

function rowFromNav(item, forwardOwn) {
  const groupId = item.getAttribute("data-group-id") || "";
  const name = conversationName(groupId) || linesOf(item).find((line) => !isMeta(line)) || "";
  const lines = linesOf(item).filter((line) => line !== name && !isMeta(line));
  let preview = lines.join("\n").trim();
  let badge = "";
  for (const el of item.querySelectorAll("[aria-label]")) {
    const label = (el.getAttribute("aria-label") || "").trim();
    if (isHidden(el)) continue;
    if (/unread|읽지 않/i.test(label) && !/toggle|filter|shortcut|more unread/i.test(label)) {
      badge = label;
      break;
    }
  }
  if (!preview) preview = badge || "Unread";
  preview = clip(preview, 700);
  if (!name || !preview) return null;
  if (!forwardOwn && (isOwn(preview) || isYou(name))) return null;
  const stamp = item.getAttribute("data-display-timestamp")
    || item.querySelector("[data-display-timestamp]")?.getAttribute("data-display-timestamp")
    || "";
  const key = [groupId, stamp || preview, badge].join("|");
  return { name: clip(name, 160), preview, key, groupId };
}

function rowFromLegacy(el, forwardOwn) {
  if (el.closest("[data-shortcut-type], [data-topic-id], [data-group-id]")) return null;
  const lines = linesOf(el).filter((line) => !isMeta(line));
  const name = lines[0] || "";
  const preview = clip(lines.slice(1).join("\n").trim(), 700);
  if (!name || !preview) return null;
  if (!forwardOwn && (isOwn(preview) || isYou(name))) return null;
  return { name: clip(name, 160), preview, key: `${name}\n${preview}`, groupId: "" };
}

function addRow(byKey, row) {
  if (!row || !row.key || !row.preview) return;
  const prev = byKey.get(row.key);
  if (!prev || row.preview.length > prev.preview.length) byKey.set(row.key, row);
}

function collectRows(forwardOwn) {
  const byKey = new Map();
  const groups = new Set();
  const coveredTimes = [];

  for (const topic of topicNodes()) {
    const topicId = topic.getAttribute("data-topic-id") || "";
    const groupId = groupIdOf(topic);
    const count = unreadCount(topic);
    const time = replyTime(topic);
    if (!topicChanged(topicId, time, count)) continue;
    let row = count > 0 ? rowFromTopic(topic, count, forwardOwn) : null;
    if (!row && time) row = rowFromLive(groupId, topicId, time, topic, forwardOwn);
    if (time) coveredTimes.push(time);
    const latest = latestMessage(topic);
    if (latest) coveredTimes.push(latest.ts);
    if (!row) continue;
    addRow(byKey, row);
    if (row.groupId) groups.add(row.groupId);
  }

  const main = document.querySelector('[role="main"][data-group-id]');
  if (main) {
    const groupId = main.getAttribute("data-group-id") || "";
    let maxTs = 0;
    for (const stamp of main.querySelectorAll("[data-absolute-timestamp]")) {
      if (isHidden(stamp) || stamp.closest('[role="textbox"], [contenteditable="true"]')) continue;
      const ts = Number(stamp.getAttribute("data-absolute-timestamp") || "");
      if (Number.isFinite(ts) && ts > maxTs) maxTs = ts;
    }
    const prev = armedRoomTime.get(groupId);
    if (prev === undefined) armedRoomTime.set(groupId, maxTs);
    else if (maxTs > prev) {
      armedRoomTime.set(groupId, maxTs);
      if (isFresh(maxTs) && !timeCovered(coveredTimes, maxTs)) {
        addRow(byKey, rowFromLive(groupId, "", maxTs, main, forwardOwn));
      }
    }
  }

  const openGroup = main ? main.getAttribute("data-group-id") || "" : "";
  for (const item of document.querySelectorAll('[role="listitem"][data-group-id]')) {
    const groupId = item.getAttribute("data-group-id") || "";
    if (!groupId || groupId === openGroup || groups.has(groupId) || !navIsUnread(item)) continue;
    addRow(byKey, rowFromNav(item, forwardOwn));
  }

  for (const el of document.querySelectorAll("[data-is-unread]")) {
    const value = el.getAttribute("data-is-unread");
    if (value === "false" || value === "0") continue;
    addRow(byKey, rowFromLegacy(el, forwardOwn));
  }

  let listCount = document.querySelectorAll('[role="listitem"][data-group-id]').length;
  const rows = [...byKey.values()].map(({ name, preview, key }) => ({ name, preview, key }));
  if (!listCount && document.querySelector('[role="main"][data-group-id]')) listCount = 1;
  return { listCount, rows };
}

function shellReady() {
  if (!document.getElementById("dynamite-main-content")) return false;
  if (!document.querySelector('[role="listitem"][data-group-id]')) return false;
  const main = document.querySelector('[role="main"][data-group-id]');
  const topics = document.querySelectorAll("c-wiz[data-topic-id]").length;
  if (main && topics < 1) {
    if (!waitingSince) waitingSince = Date.now();
    if (Date.now() - waitingSince < 8000) return false;
  }
  return true;
}

async function publish() {
  if (!shellReady()) return;
  let forwardOwn = false;
  try {
    const stored = await chrome.storage.local.get({ forwardOwn: false });
    forwardOwn = Boolean(stored.forwardOwn);
  } catch {
    return;
  }
  const snapshot = collectRows(forwardOwn);
  if (snapshot.listCount < 1) return;
  chrome.runtime.sendMessage({ type: "unread-snapshot", ...snapshot }).catch(() => {});
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    publish();
  }, 600);
}

if (window === window.top) {
  publish();
  setInterval(publish, SCAN_MS);

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      "data-is-unread",
      "aria-label",
      "data-unread-reply-count",
      "data-unread-reply-count-to-display",
      "data-last-reply-time-msec",
      "data-last-reply-time-msec-to-display",
      "data-absolute-timestamp",
    ],
  });
}
