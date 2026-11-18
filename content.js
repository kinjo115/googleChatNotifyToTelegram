const SCAN_MS = 2500;
const RECENT_MS = 15 * 60 * 1000;

let timer = 0;
let waitingSince = 0;
const armedTopic = new Map();
const armedNav = new Map();
let armedGlobal = "";
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

function numberIn(text) {
  const match = String(text || "").match(/(\d{1,4})/);
  if (!match) return 0;
  const value = parseInt(match[1], 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
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

function cleanLabel(el) {
  if (!el) return "";
  const label = (el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
  if (label) return label;
  return textOf(el).replace(/\s+/g, " ").trim();
}

function isBadgeText(label) {
  const text = String(label || "").replace(/\s+/g, " ").trim();
  if (!text || text.length > 90) return false;
  if (/mark as unread|toggle|filter|more unread|もっと見る|더 보/i.test(text)) return false;
  if (/\d+\s*(unread|未読)/i.test(text)) return true;
  if (/^(unread|未読|新しいメッセージ|新着)\b/i.test(text)) return true;
  if (/\b(unread message|unread thread|unread reply|unread followed)/i.test(text)) return true;
  return false;
}

function topicBadgeCount(topic) {
  let best = unreadCount(topic);
  for (const el of topic.querySelectorAll(".ktmas, .TeR7uc, .vh3AFf, [aria-label], [jsname='sp9p4']")) {
    if (isHidden(el)) continue;
    const label = cleanLabel(el);
    if (!isBadgeText(label)) continue;
    best = Math.max(best, numberIn(label) || 1);
  }
  return best;
}

function unreadLabel(topic, count) {
  for (const el of topic.querySelectorAll("[aria-label]")) {
    const label = (el.getAttribute("aria-label") || "").trim();
    if (!isBadgeText(label) || label.length > 40) continue;
    return label;
  }
  const chip = textOf(topic.querySelector('[jsname="sp9p4"]')).replace(/,\s*$/, "");
  if (chip && chip.length < 40 && isBadgeText(chip)) return chip;
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
      const candidateCount = topicBadgeCount(candidate);
      if (candidateTime > time) time = candidateTime;
      if (candidateCount > count) {
        count = candidateCount;
        node = candidate;
      }
    }
    entries.push({ id, node, time, count });
  }
  return entries;
}

function withoutStamp(el) {
  if (!el) return "";
  const clone = el.cloneNode(true);
  for (const stamp of clone.querySelectorAll("[data-absolute-timestamp]")) stamp.remove();
  return textOf(clone);
}

function replySnippet(topic, forwardOwn) {
  let best = null;
  let bestTs = -1;
  for (const node of topic.querySelectorAll('[jsname="GBXEWb"]')) {
    const stamp = node.querySelector("[data-absolute-timestamp]");
    const ts = stamp ? Number(stamp.getAttribute("data-absolute-timestamp") || "") : 0;
    const value = Number.isFinite(ts) ? ts : 0;
    if (!best || value >= bestTs) {
      best = node;
      bestTs = value;
    }
  }
  if (!best) return "";
  const bits = [];
  const children = [...best.children];
  const source = children.length ? children : [best];
  for (const child of source) {
    const text = withoutStamp(child);
    if (!text || isMeta(text)) continue;
    bits.push(text);
  }
  if (!bits.length) return "";
  if (!forwardOwn && isYou(bits[0])) return "";
  return bits.join(": ");
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
    const snippet = replySnippet(topic, forwardOwn);
    const onlySelf = replies.length > 0 && replies.every((node) => isYou(senderName(node)));
    if (snippet) preview = snippet;
    else if (onlySelf && !forwardOwn) return null;
    else {
      const rootBody = messageBody(root || topic);
      preview = [unreadLabel(topic, count), rootBody].filter(Boolean).join("\n");
    }
  }
  preview = clip(preview, 700);
  if (!preview) return null;
  const place = conversationName(groupId);
  let name = place || (!isYou(sender) ? sender : "") || "Google Chat";
  if (place && sender && !isYou(sender) && sender !== place) name = `${place} · ${sender}`;
  const badge = unreadLabel(topic, count);
  const key = [groupId || "group", topicId || "topic", String(count), lastReplyTime(topic) || "", badge].join("|");
  return { name: clip(name, 160), preview, key, groupId };
}

function navTextUnread(item) {
  return linesOf(item).some((line) => isBadgeText(line));
}

function navIsUnread(item) {
  if (item.hasAttribute("data-shortcut-type") || item.closest("[data-shortcut-type]")) return false;
  if (navTextUnread(item)) return true;
  for (const el of item.querySelectorAll("[aria-label]")) {
    const label = el.getAttribute("aria-label") || "";
    if (!isBadgeText(label) || isHidden(el)) continue;
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
    if (isBadgeText(label)) {
      badge = label;
      break;
    }
  }
  if (!badge && navTextUnread(item)) {
    badge = linesOf(item).find((line) => isBadgeText(line)) || "Unread thread";
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

function globalId(el, label) {
  const shortcut = el.closest("[data-shortcut-type]");
  if (shortcut) return "shortcut:" + (shortcut.getAttribute("data-shortcut-type") || "");
  return "label:" + label.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
}

function collectGlobalBadges() {
  const byId = new Map();
  for (const el of document.querySelectorAll("[aria-label], .TeR7uc, .vpiSif, .vh3AFf")) {
    if (el.classList.contains("eLNT1d")) continue;
    const label = cleanLabel(el);
    if (!isBadgeText(label) || isHidden(el)) continue;
    if (!el.closest("[data-shortcut-type]") && (el.closest("c-wiz[data-topic-id]") || el.closest('[role="listitem"][data-group-id]'))) {
      continue;
    }
    const count = numberIn(label) || 1;
    const id = globalId(el, label);
    const prev = byId.get(id);
    if (!prev || count > prev.count) byId.set(id, { id, count, label });
  }
  return [...byId.values()];
}

function rowFromGlobals(badges) {
  const signature = badges.map((badge) => badge.id + "=" + badge.count).sort().join("|");
  const preview = clip(badges.map((badge) => badge.label).slice(0, 6).join("\n"), 700);
  return { name: "Google Chat", preview, key: "badge|" + signature, groupId: "" };
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
  const fresh = new Map();
  const coveredGroups = new Set();
  const hosts = collectMessageHosts();
  const topics = topicEntries();
  const globals = collectGlobalBadges();
  let unread = 0;
  let flagged = 0;
  for (const item of hosts) if (item.flagged) flagged += 1;

  const topicHits = [];
  for (const entry of topics) {
    if (entry.count < 1) {
      armedTopic.delete(entry.id);
      continue;
    }
    unread += 1;
    const label = unreadLabel(entry.node, entry.count);
    const signature = [entry.count, entry.time || 0, label].join(":");
    if (armedTopic.get(entry.id) === signature) continue;
    const row = rowFromTopic(entry.node, entry.count, forwardOwn);
    if (!row) continue;
    row.key = [row.groupId || "group", entry.id, entry.count, entry.time || 0, label].join("|");
    topicHits.push({ entry, signature, row });
  }
  topicHits.sort((a, b) => b.entry.time - a.entry.time);
  for (const hit of topicHits.slice(0, 8)) {
    armedTopic.set(hit.entry.id, hit.signature);
    addRow(fresh, hit.row);
    if (hit.row.groupId) coveredGroups.add(hit.row.groupId);
  }

  for (const item of document.querySelectorAll('[role="listitem"][data-group-id]')) {
    const groupId = item.getAttribute("data-group-id") || "";
    if (!groupId || item.hasAttribute("data-shortcut-type") || item.closest("[data-shortcut-type]")) continue;
    if (!navIsUnread(item)) {
      armedNav.delete(groupId);
      continue;
    }
    if (!unread) unread += 1;
    const row = rowFromNav(item, forwardOwn);
    if (!row) continue;
    if (armedNav.get(groupId) === row.key) continue;
    if (coveredGroups.has(groupId)) {
      armedNav.set(groupId, row.key);
      continue;
    }
    if (fresh.size >= 8) continue;
    armedNav.set(groupId, row.key);
    addRow(fresh, row);
    coveredGroups.add(groupId);
  }

  const globalSignature = globals.map((badge) => badge.id + "=" + badge.count).sort().join("|");
  if (fresh.size) {
    armedGlobal = globalSignature;
  } else if (globalSignature !== armedGlobal) {
    armedGlobal = globalSignature;
    if (globalSignature) addRow(fresh, rowFromGlobals(globals));
    if (!unread) unread = globals.length;
  }

  const main = document.querySelector('[role="main"][data-group-id]');
  let listCount = document.querySelectorAll('[role="listitem"][data-group-id]').length;
  if (!listCount && main) listCount = 1;
  const stats = {
    topics: topics.length,
    messages: hosts.length,
    unread,
    flagged,
    warming: false,
  };
  for (const row of fresh.values()) retain(row);
  addRecent(fresh);
  const rows = [...fresh.values()].map(({ name, preview, key }) => ({ name, preview, key }));
  return { listCount, rows, stats };
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
    let snapshot;
    try {
      snapshot = collectRows(forwardOwn);
    } catch (error) {
      chrome.runtime.sendMessage({ type: "watch-error", error: String(error && error.message ? error.message : error) }).catch(() => {});
      return;
    }
    if (snapshot.listCount < 1 && !(snapshot.stats && snapshot.stats.topics)) return;
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
