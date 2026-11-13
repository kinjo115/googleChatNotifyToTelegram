const SCAN_MS = 2500;
const LIVE_MS = 60 * 60 * 1000;
const JUST_MS = 3 * 60 * 1000;
const FLAG_MS = 2 * 60 * 60 * 1000;
const RECENT_MS = 15 * 60 * 1000;

let timer = 0;
let waitingSince = 0;
let baselineUntil = 0;
const armedTopic = new Map();
const armedRoomTime = new Map();
const armedNav = new Map();
const armedMessage = new Set();
const armedLegacy = new Set();
const recent = new Map();

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

function isRecent(ts, windowMs) {
  if (!ts) return false;
  const delta = Date.now() - ts;
  return delta >= -15000 && delta <= windowMs;
}

function unreadCount(topic) {
  const attrs = [
    "data-unread-reply-count-to-display",
    "data-unread-reply-count",
    "data-unread-self-mention-count-to-display",
    "data-unread-self-mention-count",
  ];
  let best = 0;
  for (const attr of attrs) best = Math.max(best, positiveCount(topic, attr));
  const selector = attrs.map((attr) => `[${attr}]`).join(", ");
  for (const el of topic.querySelectorAll(selector)) {
    for (const attr of attrs) best = Math.max(best, positiveCount(el, attr));
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

function stampValue(el) {
  const value = Number(el.getAttribute("data-absolute-timestamp") || "");
  return Number.isFinite(value) && value > 0 ? value : 0;
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
  for (const stamp of topic.querySelectorAll("[data-absolute-timestamp]")) {
    if (stamp.closest('[role="textbox"], [contenteditable="true"]')) continue;
    const value = stampValue(stamp);
    if (value > max) max = value;
  }
  return max;
}

function lastReplyTime(topic) {
  const time = replyTime(topic);
  return time ? String(time) : "";
}

function topicEntries() {
  const grouped = new Map();
  for (const node of document.querySelectorAll("c-wiz[data-topic-id]")) {
    if (node.closest("[data-shortcut-type]")) continue;
    const id = node.getAttribute("data-topic-id") || "";
    if (!id) continue;
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(node);
  }
  const entries = [];
  for (const [id, nodes] of grouped) {
    let node = nodes[0];
    let time = 0;
    let count = 0;
    for (const candidate of nodes) {
      const candidateTime = replyTime(candidate);
      const candidateCount = unreadCount(candidate);
      if (candidateTime >= time) {
        time = candidateTime;
        node = candidate;
      }
      if (candidateCount > count) count = candidateCount;
    }
    entries.push({ id, node, time, count });
  }
  return entries;
}

function topicChanged(topicId, time, count, baselining) {
  const prev = armedTopic.get(topicId);
  const storedTime = Math.max(prev ? prev.time : 0, time || 0);
  if (!prev) {
    armedTopic.set(topicId, { time: time || 0, count });
    if (baselining) return false;
    return count > 0 && isRecent(time, JUST_MS);
  }
  if (baselining) {
    armedTopic.set(topicId, { time: storedTime, count });
    return false;
  }
  const timeMoved = time > prev.time + 5000;
  const countGrew = count > prev.count;
  const timeGrew = !countGrew && timeMoved && prev.time > 0 && isRecent(time, LIVE_MS);
  armedTopic.set(topicId, { time: storedTime, count });
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
  const scopeIsOwn = scope && scope.getAttribute("data-is-viewer-message-creator") === "true";
  if (!forwardOwn && (scopeIsOwn || (matched && (isYou(sender) || containerIsOwn(container))))) return null;
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

function navTextUnread(item) {
  return /unread\s+(followed\s+)?thread|\bunread\s+message\b|읽지 않은\s*(대화|메시지|답글)?/i.test(textOf(item));
}

function navIsUnread(item) {
  if (item.hasAttribute("data-shortcut-type") || item.closest("[data-shortcut-type]")) return false;
  if (navTextUnread(item)) return true;
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
  if (!badge && navTextUnread(item)) {
    badge = linesOf(item).find((line) => /unread|읽지/i.test(line)) || "Unread thread";
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

function retain(row) {
  if (!row || !row.key || recent.has(row.key)) return;
  recent.set(row.key, { row, at: Date.now() });
}

function addRecent(byKey) {
  const now = Date.now();
  for (const [key, item] of recent) {
    if (now - item.at > RECENT_MS) {
      recent.delete(key);
      continue;
    }
    addRow(byKey, item.row);
  }
}

function messageHost(el) {
  if (el.matches && el.matches("[data-id]")) return el;
  return el.closest("[data-id]");
}

function hostTime(host) {
  let max = 0;
  for (const stamp of host.querySelectorAll("[data-absolute-timestamp]")) {
    if (stamp.closest('[role="textbox"], [contenteditable="true"]')) continue;
    const value = stampValue(stamp);
    if (value > max) max = value;
  }
  return max;
}

function collectMessageHosts() {
  const byId = new Map();
  for (const el of document.querySelectorAll('[data-is-new="true"], div.nF6pT[data-id]')) {
    const host = messageHost(el);
    if (!host) continue;
    const id = host.getAttribute("data-id") || "";
    if (!id) continue;
    const flagged = el.getAttribute("data-is-new") === "true" || host.getAttribute("data-is-new") === "true" || Boolean(host.querySelector('[data-is-new="true"]'));
    const prev = byId.get(id);
    if (!prev || (flagged && !prev.flagged)) byId.set(id, { id, host, flagged, ts: hostTime(host) });
  }
  return [...byId.values()];
}

function collectRows(forwardOwn) {
  if (!baselineUntil) baselineUntil = Date.now() + 8000;
  const baselining = Date.now() < baselineUntil;
  const byKey = new Map();
  const groups = new Set();
  const coveredTimes = [];
  const coveredTopics = new Set();

  const hosts = collectMessageHosts();
  if (baselining) {
    for (const item of hosts) armedMessage.add(item.id);
  } else {
    const fresh = [];
    for (const item of hosts) {
      if (armedMessage.has(item.id)) continue;
      const windowMs = item.flagged ? FLAG_MS : JUST_MS;
      if (!isRecent(item.ts, windowMs)) {
        armedMessage.add(item.id);
        continue;
      }
      fresh.push(item);
    }
    fresh.sort((a, b) => b.ts - a.ts);
    for (const item of fresh.slice(0, 8)) {
      armedMessage.add(item.id);
      const groupId = groupIdOf(item.host);
      const topic = item.host.closest("[data-topic-id]");
      const topicId = topic ? topic.getAttribute("data-topic-id") || "" : "";
      const row = rowFromLive(groupId, topicId || item.id, item.ts, item.host, forwardOwn);
      if (!row) continue;
      row.key = `msg|${item.id}`;
      addRow(byKey, row);
      if (item.ts) coveredTimes.push(item.ts);
      if (topicId) coveredTopics.add(topicId);
      if (row.groupId) groups.add(row.groupId);
    }
  }

  for (const entry of topicEntries()) {
    const groupId = groupIdOf(entry.node);
    const changed = topicChanged(entry.id, entry.time, entry.count, baselining);
    if (!changed || coveredTopics.has(entry.id)) continue;
    let row = entry.count > 0 ? rowFromTopic(entry.node, entry.count, forwardOwn) : null;
    if (!row && entry.time) row = rowFromLive(groupId, entry.id, entry.time, entry.node, forwardOwn);
    if (entry.time) coveredTimes.push(entry.time);
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
      const value = stampValue(stamp);
      if (value > maxTs) maxTs = value;
    }
    const prev = armedRoomTime.get(groupId);
    if (prev === undefined || baselining) armedRoomTime.set(groupId, Math.max(prev || 0, maxTs));
    else if (maxTs > prev + 5000) {
      armedRoomTime.set(groupId, maxTs);
      if (isRecent(maxTs, LIVE_MS) && !timeCovered(coveredTimes, maxTs)) {
        addRow(byKey, rowFromLive(groupId, "", maxTs, main, forwardOwn));
      }
    }
  }

  const openGroup = main ? main.getAttribute("data-group-id") || "" : "";
  const seenNav = new Set();
  for (const item of document.querySelectorAll('[role="listitem"][data-group-id]')) {
    const groupId = item.getAttribute("data-group-id") || "";
    if (!groupId || !navIsUnread(item)) continue;
    const threadUnread = navTextUnread(item);
    if (groupId === openGroup && !threadUnread) continue;
    seenNav.add(groupId);
    const row = rowFromNav(item, forwardOwn);
    if (!row) continue;
    if (baselining) {
      armedNav.set(groupId, row.key);
      continue;
    }
    const prevKey = armedNav.get(groupId);
    armedNav.set(groupId, row.key);
    if (prevKey === row.key || groups.has(groupId)) continue;
    addRow(byKey, row);
  }
  for (const id of [...armedNav.keys()]) {
    if (!seenNav.has(id)) armedNav.delete(id);
  }

  for (const el of document.querySelectorAll("[data-is-unread]")) {
    const value = el.getAttribute("data-is-unread");
    if (value === "false" || value === "0") continue;
    const row = rowFromLegacy(el, forwardOwn);
    if (!row || armedLegacy.has(row.key)) continue;
    armedLegacy.add(row.key);
    if (!baselining) addRow(byKey, row);
  }

  let listCount = document.querySelectorAll('[role="listitem"][data-group-id]').length;
  if (!listCount && main) listCount = 1;
  if (baselining) return { listCount, rows: [] };
  for (const row of byKey.values()) retain(row);
  addRecent(byKey);
  const rows = [...byKey.values()].map(({ name, preview, key }) => ({ name, preview, key }));
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

let publishing = false;

async function publish() {
  if (publishing || !shellReady()) return;
  publishing = true;
  try {
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
  } finally {
    publishing = false;
  }
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
      "data-is-new",
      "aria-label",
      "data-unread-reply-count",
      "data-unread-reply-count-to-display",
      "data-unread-self-mention-count",
      "data-unread-self-mention-count-to-display",
      "data-last-reply-time-msec",
      "data-last-reply-time-msec-to-display",
      "data-absolute-timestamp",
    ],
  });
}
