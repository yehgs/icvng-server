/**
 * services/chat/chatService.js — the chat engine (no Express here).
 *
 * Lifecycle:  ai ──(escalate)──▶ waiting_agent ──(agent reply / take over)──▶ agent
 *              ▲                       │                                        │
 *              └──── hand back to AI ──┴────────────── resolve / close ◀────────┘
 *
 * Realtime model: stateless short-polling on a per-conversation `seq` cursor
 * (Cloud Run may run many instances, so no in-memory pub/sub). Visitor widgets
 * poll their conversation; the admin console polls /alerts + the open thread.
 * Presence ("user is on chat") = visitorLastSeenAt touched by every visitor poll.
 */
import crypto from "crypto";
import ChatConversation from "../../models/chat-conversation.model.js";
import ChatMessage from "../../models/chat-message.model.js";
import ChatSettings from "../../models/chat-settings.model.js";
import { ROLE_DEFINITIONS } from "../../config/roles.js";
import { ALL_SUPPORTED_LANGUAGES } from "../../config/countries/index.js";
import { getHQCountry, syncByCode } from "../countryService.js";
import { createNotificationInternal } from "../../controllers/notification.controller.js";
import { generateReply } from "./chatAssistant.js";
import { chatStrings, fmt } from "./chatStrings.js";
import { chatScopeFilter, notificationAudiences, isTargetedAt, DESK_ROLES } from "./chatScope.js";

export const PRESENCE_WINDOW_MS = 25_000;
const MAX_TEXT = 2000;

export class ChatError extends Error {
  constructor(message, status = 400, code = "CHAT_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────
export const hashToken = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
export const newToken = () => crypto.randomBytes(24).toString("hex");
export function tokenMatches(token, hash) {
  if (!token || !hash) return false;
  const a = Buffer.from(hashToken(token));
  const b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

let _settings = null, _settingsAt = 0;
export async function getSettings(force = false) {
  if (!force && _settings && Date.now() - _settingsAt < 30_000) return _settings;
  let s = await ChatSettings.findOne({ key: "global" });
  if (!s) s = await ChatSettings.create({ key: "global" });
  _settings = s.toObject();
  _settingsAt = Date.now();
  return _settings;
}
export function invalidateSettings() { _settings = null; }

export const EMAIL_RX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RX = /\+?\d[\d\s().-]{6,}\d/g;

export function normalizeWhatsapp(raw, phonePrefix = "") {
  if (!raw) return "";
  let s = String(raw).trim();
  const plus = s.startsWith("+");
  let d = s.replace(/\D/g, "");
  if (d.length < 8 || d.length > 15) return "";
  const cc = String(phonePrefix || "").replace(/\D/g, "");
  if (!plus && d.startsWith("00")) d = d.slice(2);
  else if (!plus && d.startsWith("0") && cc) d = cc + d.slice(1); // national format 0xx… → +<cc>xx…
  else if (!plus && cc && d.length < 10) d = cc + d; // short local number without a trunk 0
  return `+${d}`;
}

/** Pull an email / phone out of free text (visitor typed it in the chat). */
export function extractContact(text, phonePrefix = "") {
  const out = {};
  const e = String(text || "").match(EMAIL_RX);
  if (e) out.email = e[0].toLowerCase();
  const phones = String(text || "").replace(EMAIL_RX, " ").match(PHONE_RX) || [];
  // prefer an explicit "+<country code>" number, else the first plausible one
  const ordered = [...phones.filter((p) => p.trim().startsWith("+")), ...phones.filter((p) => !p.trim().startsWith("+"))];
  for (const p of ordered) {
    const n = normalizeWhatsapp(p, phonePrefix);
    if (n) { out.whatsapp = n; break; }
  }
  return out;
}

export const roleLabel = (subRole) => ROLE_DEFINITIONS[subRole]?.name || subRole || "";
const brandFor = (country) => country?.seo?.siteName || `I-Coffee ${country?.name || ""}`.trim();
const sanitize = (t) => String(t ?? "").replace(/\u0000/g, "").trim().slice(0, MAX_TEXT);

export function resolveLanguage(requested, country) {
  const def = country?.language?.default || "en";
  if (requested && ALL_SUPPORTED_LANGUAGES.includes(requested)) return requested;
  return def;
}

// ── views ────────────────────────────────────────────────────────────────────
export function messageView(m, { admin = false } = {}) {
  const v = {
    seq: m.seq,
    id: String(m._id),
    senderType: m.senderType,
    text: m.text,
    kind: m.kind,
    createdAt: m.createdAt,
    sender: m.senderType === "agent" || m.senderType === "system" ? { name: m.sender?.name || "", role: m.sender?.role || "", image: m.sender?.image || "" } : undefined,
  };
  if (admin) { v.internal = !!m.internal; v.sender = { name: m.sender?.name || "", role: m.sender?.role || "", image: m.sender?.image || "" }; }
  return v;
}

export function publicView(c) {
  return {
    id: String(c._id),
    status: c.status,
    language: c.language,
    countryCode: c.countryCode,
    humanInvolved: c.status === "waiting_agent" || c.status === "agent" || !!c.assignedTo,
    waitingForAgent: c.status === "waiting_agent",
    agent: c.assignedTo ? { name: c.assignedName, role: c.assignedRoleLabel, image: c.assignedImage } : null,
    visitor: { name: c.visitor?.name || "", email: c.visitor?.email || "", whatsapp: c.visitor?.whatsapp || "" },
    contactMissing: !c.visitor?.email && !c.visitor?.whatsapp,
  };
}

export function adminView(c, me) {
  const online = c.visitorLastSeenAt && Date.now() - new Date(c.visitorLastSeenAt).getTime() < PRESENCE_WINDOW_MS;
  return {
    id: String(c._id),
    countryCode: c.countryCode,
    language: c.language,
    channel: c.channel,
    status: c.status,
    aiEnabled: c.aiEnabled,
    visitor: c.visitor,
    escalation: c.escalation,
    assigned: c.assignedTo ? { id: String(c.assignedTo), name: c.assignedName, role: c.assignedRole, roleLabel: c.assignedRoleLabel, image: c.assignedImage } : null,
    mine: !!me && c.assignedTo && String(c.assignedTo) === String(me._id),
    forMe: !!me && c.status === "waiting_agent" && isTargetedAt(me, c.escalation?.targetRole),
    online: !!online,
    unread: c.unreadForAdmin || 0,
    summary: c.summary,
    tags: c.tags || [],
    priority: c.priority,
    rating: c.rating,
    messageCount: c.messageCount,
    lastMessageAt: c.lastMessageAt,
    lastMessagePreview: c.lastMessagePreview,
    lastSender: c.lastSender,
    createdAt: c.createdAt,
    closedAt: c.closedAt,
  };
}

// ── messages ─────────────────────────────────────────────────────────────────
export async function addMessage(conv, { senderType, sender = {}, text, kind = "text", internal = false, language = "" }) {
  // native driver call: atomic $inc without mongoose adding the select:false (tokenHash) projection
  const updated = await ChatConversation.collection.findOneAndUpdate({ _id: conv._id }, { $inc: { seq: 1 } }, { returnDocument: "after" });
  const msg = await ChatMessage.create({ conversation: conv._id, seq: updated.seq, senderType, sender, text: sanitize(text) || "…", kind, internal, language });
  if (!internal) {
    const set = { lastMessageAt: new Date(), lastMessagePreview: msg.text.slice(0, 140), lastSender: senderType };
    const inc = { messageCount: 1 };
    if (senderType === "visitor") { set.lastVisitorMessageAt = new Date(); inc.unreadForAdmin = 1; }
    await ChatConversation.updateOne({ _id: conv._id }, { $set: set, $inc: inc });
  }
  return msg;
}

async function systemMessage(conv, text, kind = "text", agent = {}) {
  return addMessage(conv, { senderType: "system", sender: agent, text, kind, language: conv.language });
}

// ── notifications / alarm ────────────────────────────────────────────────────
async function notifyStaff(conv, { title, message, priority = "medium", targetRole = null }) {
  try {
    const hq = (await getHQCountry())?.code || "NG";
    const audiences = notificationAudiences({ countryCode: conv.countryCode, hqCode: hq, targetRole });
    for (const a of audiences) {
      await createNotificationInternal({
        type: "CHAT",
        title,
        message,
        link: `/admin/dashboard/chat?c=${conv._id}`,
        resourceId: String(conv._id),
        resourceType: "ChatConversation",
        targetType: "role",
        targetRoles: a.targetRoles,
        targetScope: a.targetScope,
        targetCountry: a.targetCountry || null,
        priority,
        triggeredByName: "Chat",
        sendEmailFlag: false,
      });
    }
  } catch (e) {
    console.warn("[chat] notification failed:", e.message);
  }
}

const who = (c) => c.visitor?.name || c.visitor?.email || c.visitor?.whatsapp || "Visitor";

// ── conversation lifecycle ───────────────────────────────────────────────────
export async function startConversation({ country, language, channel = "web", visitor = {}, user = null, userAgent = "" }) {
  const settings = await getSettings();
  if (!settings.enabled || settings.disabledCountries?.includes(country.code)) {
    throw new ChatError("Chat is unavailable", 403, "CHAT_DISABLED");
  }
  const token = newToken();
  const lang = resolveLanguage(language, country);
  const v = {
    userId: user?._id || null,
    visitorId: String(visitor.visitorId || "").slice(0, 64),
    name: sanitize(visitor.name || user?.name || "").slice(0, 80),
    email: EMAIL_RX.test(visitor.email || user?.email || "") ? String(visitor.email || user?.email).toLowerCase() : "",
    whatsapp: normalizeWhatsapp(visitor.whatsapp, country.phonePrefix),
    pageUrl: String(visitor.pageUrl || "").slice(0, 300),
    userAgent: String(userAgent || "").slice(0, 200),
  };
  const conv = await ChatConversation.create({
    countryCode: country.code, language: lang, channel, visitor: v, tokenHash: hashToken(token),
    aiEnabled: settings.aiEnabled,
  });
  const S = chatStrings(lang);
  const greeting = settings.welcome?.[lang] || fmt(S.welcome, { brand: brandFor(country) });
  await addMessage(conv, { senderType: "ai", sender: { name: brandFor(country) }, text: greeting, language: lang });
  return { conversation: conv, token };
}

/** Resume a logged-in user's open conversation (rotating the token) or null. */
export async function resumeForUser(user, countryCode) {
  if (!user) return null;
  const conv = await ChatConversation.findOne({ "visitor.userId": user._id, countryCode, status: { $in: ["ai", "waiting_agent", "agent"] } }).sort({ lastMessageAt: -1 });
  if (!conv) return null;
  const token = newToken();
  await ChatConversation.updateOne({ _id: conv._id }, { $set: { tokenHash: hashToken(token) } });
  return { conversation: conv, token };
}

export async function authVisitor(id, token) {
  if (!id || !/^[a-f\d]{24}$/i.test(String(id))) return null;
  const conv = await ChatConversation.findById(id).select("+tokenHash");
  if (!conv || !tokenMatches(token, conv.tokenHash)) return null;
  return conv;
}

export async function touchPresence(conv) {
  await ChatConversation.updateOne({ _id: conv._id }, { $set: { visitorLastSeenAt: new Date() } });
}

export async function getMessages(conv, { after = 0, admin = false, limit = 200 } = {}) {
  const q = { conversation: conv._id, seq: { $gt: Number(after) || 0 } };
  if (!admin) q.internal = { $ne: true };
  const msgs = await ChatMessage.find(q).sort({ seq: 1 }).limit(limit).lean();
  return msgs.map((m) => messageView(m, { admin }));
}

export async function saveContact(conv, { name, email, whatsapp }) {
  const country = syncByCode(conv.countryCode);
  const set = {};
  if (name) set["visitor.name"] = sanitize(name).slice(0, 80);
  if (email && EMAIL_RX.test(email)) set["visitor.email"] = String(email).trim().toLowerCase();
  const wa = normalizeWhatsapp(whatsapp, country?.phonePrefix);
  if (wa) set["visitor.whatsapp"] = wa;
  if (!Object.keys(set).length) return false;
  await ChatConversation.updateOne({ _id: conv._id }, { $set: set });
  for (const [k, v] of Object.entries(set)) { const f = k.split(".")[1]; conv.visitor[f] = v; }
  return true;
}

export async function escalate(conv, { role = "SALES", reason = "", summary = "", by = "ai" } = {}) {
  const target = ["SALES", "MANAGER", "IT", "DIRECTOR"].includes(String(role).toUpperCase()) ? String(role).toUpperCase() : "SALES";
  const wasWaiting = conv.status === "waiting_agent";
  await ChatConversation.updateOne({ _id: conv._id }, {
    $set: {
      status: "waiting_agent", aiEnabled: false,
      "escalation.requested": true, "escalation.by": by, "escalation.targetRole": target,
      "escalation.reason": String(reason).slice(0, 300), "escalation.requestedAt": new Date(), "escalation.overdueNotifiedAt": null,
      assignedTo: null, assignedName: "", assignedRole: "", assignedRoleLabel: "", assignedImage: "",
      priority: target === "DIRECTOR" || target === "MANAGER" ? "high" : "normal",
      ...(summary ? { summary: String(summary).slice(0, 600) } : {}),
    },
  });
  Object.assign(conv, { status: "waiting_agent", aiEnabled: false });
  const S = chatStrings(conv.language);
  await systemMessage(conv, fmt(S.connecting, { role: S.roles[target] }), "escalation");
  if (!wasWaiting) {
    await notifyStaff(conv, {
      title: `Chat needs ${target === "SALES" ? "Sales" : target === "IT" ? "IT" : target.charAt(0) + target.slice(1).toLowerCase()} — ${conv.countryCode}`,
      message: `${who(conv)}: ${String(reason || summary || conv.lastMessagePreview || "").slice(0, 160)}`,
      priority: "high",
      targetRole: target,
    });
  }
  return conv;
}

export async function handleVisitorMessage(conv, rawText) {
  const text = sanitize(rawText);
  if (!text) throw new ChatError("Message is empty", 400, "EMPTY");
  if (conv.status === "closed") throw new ChatError("This chat is closed", 409, "CLOSED");

  const country = syncByCode(conv.countryCode);
  const settings = await getSettings();
  const firstEver = conv.messageCount <= 1; // only the greeting so far
  const reopened = conv.status === "resolved";
  if (reopened) {
    const status = conv.assignedTo ? "agent" : "ai";
    await ChatConversation.updateOne({ _id: conv._id }, { $set: { status, aiEnabled: status === "ai" && settings.aiEnabled } });
    conv.status = status; conv.aiEnabled = status === "ai" && settings.aiEnabled;
  }

  const hadUnread = (conv.unreadForAdmin || 0) > 0;
  const visitorMsg = await addMessage(conv, { senderType: "visitor", text, language: conv.language });
  const got = extractContact(text, country?.phonePrefix);
  if (got.email || got.whatsapp) await saveContact(conv, got);

  // "User is on chat" notification: first message of a brand-new conversation.
  if (firstEver) {
    await notifyStaff(conv, { title: `New chat — ${country?.name || conv.countryCode}`, message: `${who(conv)}: ${text.slice(0, 140)}`, priority: "low" });
  }

  // Human is (or will be) handling it → no AI. Notify the agent only on the first unread.
  if (conv.status === "waiting_agent" || conv.status === "agent") {
    if (conv.status === "agent" && conv.assignedTo && !hadUnread) {
      try {
        await createNotificationInternal({
          type: "CHAT", title: `New message — ${who(conv)}`, message: text.slice(0, 160),
          link: `/admin/dashboard/chat?c=${conv._id}`, resourceId: String(conv._id), resourceType: "ChatConversation",
          targetType: "specific", targetRoles: [], targetUsers: [conv.assignedTo], targetScope: "ALL", priority: "medium", triggeredByName: "Chat", sendEmailFlag: false,
        });
      } catch (e) { console.warn("[chat] notify agent failed:", e.message); }
    }
    return { messages: [visitorMsg], escalated: false };
  }

  // AI disabled globally/for this chat → go straight to a human.
  if (!settings.aiEnabled || !conv.aiEnabled) {
    await escalate(conv, { role: "SALES", reason: "AI disabled", by: "system" });
    return { escalated: true };
  }

  const S = chatStrings(conv.language);
  const history = (await ChatMessage.find({ conversation: conv._id, internal: { $ne: true } }).sort({ seq: -1 }).limit(24).lean()).reverse();
  let ai;
  try {
    ai = await generateReply({ conversation: conv, history, country, settings, brand: brandFor(country) });
    if (!ai.reply) throw new Error("empty reply");
  } catch (e) {
    console.error("[chat] AI failed:", e.message);
    await systemMessage(conv, S.unavailable, "escalation");
    await escalate(conv, { role: "SALES", reason: "AI unavailable", by: "system" });
    return { escalated: true, aiFailed: true };
  }

  if (ai.captured?.name || ai.captured?.email || ai.captured?.whatsapp) await saveContact(conv, ai.captured);
  const haveContact = !!(conv.visitor.email || conv.visitor.whatsapp);
  const aiSender = { name: brandFor(country) };

  let action = ai.action;
  if (action === "ask_contact" && (conv.contactAsked || haveContact)) action = "escalate";
  if (action === "escalate" && settings.requireContactForEscalation && !conv.contactAsked && !haveContact) {
    action = "ask_contact";
    ai.reply = S.askContact;
  }

  if (action === "ask_contact") {
    await ChatConversation.updateOne({ _id: conv._id }, { $set: { contactAsked: true } });
    conv.contactAsked = true;
    await addMessage(conv, { senderType: "ai", sender: aiSender, text: ai.reply, kind: "contact_request", language: conv.language });
    return { escalated: false, askContact: true };
  }
  await addMessage(conv, { senderType: "ai", sender: aiSender, text: ai.reply, language: conv.language });
  if (action === "escalate") {
    await escalate(conv, { role: ai.escalateTo || "SALES", reason: ai.reason, summary: ai.summary, by: "ai" });
    return { escalated: true };
  }
  if (action === "resolved") {
    await ChatConversation.updateOne({ _id: conv._id }, { $set: { status: "resolved" } });
  }
  return { escalated: false };
}

export async function visitorRequestsHuman(conv, role = "SALES") {
  if (conv.status === "closed") throw new ChatError("This chat is closed", 409, "CLOSED");
  if (conv.status === "waiting_agent" || conv.status === "agent") return conv;
  return escalate(conv, { role, reason: "Visitor asked for a person", by: "visitor" });
}

// ── agent side ───────────────────────────────────────────────────────────────
function agentSnapshot(user) {
  return { userId: user._id, name: user.name, role: roleLabel(user.subRole), image: user.avatar || "" };
}

async function assignTo(conv, user) {
  await ChatConversation.updateOne({ _id: conv._id }, {
    $set: { assignedTo: user._id, assignedName: user.name, assignedRole: user.subRole, assignedRoleLabel: roleLabel(user.subRole), assignedImage: user.avatar || "", status: "agent", aiEnabled: false },
  });
  Object.assign(conv, { assignedTo: user._id, assignedName: user.name, assignedRole: user.subRole, assignedRoleLabel: roleLabel(user.subRole), assignedImage: user.avatar || "", status: "agent", aiEnabled: false });
}

export async function takeover(conv, user) {
  if (conv.status === "closed") throw new ChatError("Chat is closed", 409, "CLOSED");
  const already = conv.assignedTo && String(conv.assignedTo) === String(user._id);
  await assignTo(conv, user);
  if (!already) {
    const S = chatStrings(conv.language);
    await systemMessage(conv, fmt(S.joined, { name: user.name, role: roleLabel(user.subRole) }), "joined", agentSnapshot(user));
  }
  return conv;
}

export async function agentReply(conv, user, rawText, { internal = false } = {}) {
  const text = sanitize(rawText);
  if (!text) throw new ChatError("Message is empty", 400, "EMPTY");
  if (conv.status === "closed") throw new ChatError("Chat is closed", 409, "CLOSED");
  if (internal) {
    return addMessage(conv, { senderType: "agent", sender: agentSnapshot(user), text, internal: true, language: conv.language });
  }
  if (!conv.assignedTo || String(conv.assignedTo) !== String(user._id) || conv.status !== "agent") await takeover(conv, user);
  const msg = await addMessage(conv, { senderType: "agent", sender: agentSnapshot(user), text, language: conv.language });
  const set = { unreadForAdmin: 0 };
  if (!conv.firstAgentReplyAt) set.firstAgentReplyAt = new Date();
  await ChatConversation.updateOne({ _id: conv._id }, { $set: set });
  return msg;
}

export async function handBackToAI(conv, user) {
  const settings = await getSettings();
  if (!settings.aiEnabled) throw new ChatError("AI is disabled in settings", 409, "AI_DISABLED");
  await ChatConversation.updateOne({ _id: conv._id }, { $set: { status: "ai", aiEnabled: true, assignedTo: null, assignedName: "", assignedRole: "", assignedRoleLabel: "", assignedImage: "", "escalation.requested": false } });
  Object.assign(conv, { status: "ai", aiEnabled: true });
  await systemMessage(conv, chatStrings(conv.language).aiBack, "handoff");
}

export async function transfer(conv, user, role) {
  const target = String(role || "").toUpperCase();
  if (!DESK_ROLES[target]) throw new ChatError("Unknown target role", 400, "BAD_ROLE");
  await escalate(conv, { role: target, reason: `Transferred by ${user.name}`, by: "admin" });
  const S = chatStrings(conv.language);
  await systemMessage(conv, fmt(S.transferred, { role: S.roles[target] }), "handoff");
}

export async function closeConversation(conv, by = "admin", { resolved = false } = {}) {
  const S = chatStrings(conv.language);
  const country = syncByCode(conv.countryCode);
  await ChatConversation.updateOne({ _id: conv._id }, { $set: { status: resolved ? "resolved" : "closed", closedAt: new Date(), closedBy: by, unreadForAdmin: 0 } });
  conv.status = resolved ? "resolved" : "closed";
  if (!resolved) await systemMessage(conv, fmt(S.closed, { brand: brandFor(country) }), "closed");
}

export async function rateConversation(conv, score, comment = "") {
  const n = Math.round(Number(score));
  if (!(n >= 1 && n <= 5)) throw new ChatError("Rating must be 1–5", 400, "BAD_RATING");
  await ChatConversation.updateOne({ _id: conv._id }, { $set: { "rating.score": n, "rating.comment": sanitize(comment).slice(0, 500) } });
}

// ── scope helpers for admin controllers ──────────────────────────────────────
export async function scopeFilterFor(user) {
  const hq = (await getHQCountry())?.code || "NG";
  return chatScopeFilter(user, hq);
}

export async function loadScoped(user, id) {
  if (!id || !/^[a-f\d]{24}$/i.test(String(id))) throw new ChatError("Conversation not found", 404, "NOT_FOUND");
  const filter = { _id: id, ...(await scopeFilterFor(user)) };
  const conv = await ChatConversation.findOne(filter);
  if (!conv) throw new ChatError("Conversation not found", 404, "NOT_FOUND"); // 404, not 403: don't leak other countries' ids
  return conv;
}

/** Counts + newest waiting chats for the console's poll / alarm. Also sweeps overdue chats. */
export async function alertsFor(user) {
  const settings = await getSettings();
  const scope = await scopeFilterFor(user);
  const now = Date.now();
  await sweepOverdue(settings);
  const overdueBefore = new Date(now - settings.slaSeconds * 1000);
  const [waiting, onlineVisitors, mineUnread, newest] = await Promise.all([
    ChatConversation.find({ ...scope, status: "waiting_agent" }).select("visitor countryCode escalation lastMessagePreview lastMessageAt").sort({ "escalation.requestedAt": 1 }).limit(50).lean(),
    ChatConversation.countDocuments({ ...scope, status: { $in: ["ai", "waiting_agent", "agent"] }, visitorLastSeenAt: { $gt: new Date(now - PRESENCE_WINDOW_MS) } }),
    ChatConversation.countDocuments({ ...scope, assignedTo: user._id, status: "agent", unreadForAdmin: { $gt: 0 } }),
    Promise.resolve(null),
  ]);
  const forMe = waiting.filter((c) => isTargetedAt(user, c.escalation?.targetRole));
  const overdue = forMe.filter((c) => c.escalation?.requestedAt && new Date(c.escalation.requestedAt) < overdueBefore);
  return {
    waiting: waiting.length,
    waitingForMe: forMe.length,
    overdue: overdue.length,
    mineUnread,
    onlineVisitors,
    alarm: forMe.length > 0 || mineUnread > 0,
    urgent: overdue.length > 0,
    repeatSeconds: settings.alarmRepeatSeconds,
    slaSeconds: settings.slaSeconds,
    items: forMe.slice(0, 5).map((c) => ({
      id: String(c._id), countryCode: c.countryCode, who: who(c), targetRole: c.escalation?.targetRole,
      reason: c.escalation?.reason || c.lastMessagePreview, since: c.escalation?.requestedAt,
    })),
    serverTime: new Date(now).toISOString(),
  };
}

/** Escalate-up notification for chats nobody picked up within the SLA (fires once per chat). */
export async function sweepOverdue(settings) {
  const cutoff = new Date(Date.now() - settings.slaSeconds * 1000);
  const stale = await ChatConversation.find({ status: "waiting_agent", "escalation.requestedAt": { $lt: cutoff }, "escalation.overdueNotifiedAt": null }).limit(20);
  for (const c of stale) {
    const claimed = await ChatConversation.updateOne({ _id: c._id, "escalation.overdueNotifiedAt": null }, { $set: { "escalation.overdueNotifiedAt": new Date(), priority: "urgent" } });
    if (!claimed.modifiedCount) continue; // another instance got it
    await notifyStaff(c, {
      title: `OVERDUE chat — ${c.countryCode}`,
      message: `${who(c)} has been waiting more than ${Math.round(settings.slaSeconds / 60) || 1} min for ${c.escalation?.targetRole || "an agent"}.`,
      priority: "urgent",
      targetRole: "MANAGER", // escalate up: managers + IT + Director are paged
    });
  }
  return stale.length;
}
