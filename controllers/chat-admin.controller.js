/**
 * controllers/chat-admin.controller.js — admin chat console API (/api/admin/chat).
 * Visibility: services/chat/chatScope.js (IT/Director all · foreign → own country · other HQ → HQ country).
 * Every by-id access goes through loadScoped() → 404 for out-of-scope ids.
 */
import ChatConversation from "../models/chat-conversation.model.js";
import ChatSettings from "../models/chat-settings.model.js";
import {
  ChatError, adminView, getMessages, scopeFilterFor, loadScoped, takeover, agentReply, handBackToAI,
  transfer, closeConversation, alertsFor, getSettings, invalidateSettings,
} from "../services/chat/chatService.js";
import { isTargetedAt, seesAllCountries } from "../services/chat/chatScope.js";
import { ALL_COUNTRY_CODES } from "../config/countries/index.js";
import { userHasPermission } from "../middleware/requirePermission.js";

const fail = (res, err) => {
  const status = err instanceof ChatError ? err.status : 500;
  if (status === 500) console.error("[chat-admin]", err);
  return res.status(status).json({ message: err.message || "Chat error", code: err.code, error: true, success: false });
};
const ok = (res, data, extra = {}) => res.json({ success: true, error: false, data, ...extra });

export async function getAlerts(req, res) {
  try { return ok(res, await alertsFor(req.user)); } catch (e) { return fail(res, e); }
}

function listFilter(req, scope) {
  const q = req.query;
  const f = { ...scope };
  if (q.country && seesAllCountries(req.user) && ALL_COUNTRY_CODES.includes(String(q.country).toUpperCase())) f.countryCode = String(q.country).toUpperCase();
  if (q.status === "open") f.status = { $in: ["ai", "waiting_agent", "agent"] };
  else if (q.status && ["ai", "waiting_agent", "agent", "resolved", "closed"].includes(q.status)) f.status = q.status;
  if (q.mine === "1") f.assignedTo = req.user._id;
  if (q.unassigned === "1") f.assignedTo = null;
  if (q.role && ["SALES", "MANAGER", "IT", "DIRECTOR"].includes(q.role)) f["escalation.targetRole"] = q.role;
  if (q.hasContact === "1") f.$or = [{ "visitor.email": { $ne: "" } }, { "visitor.whatsapp": { $ne: "" } }];
  if (q.q && String(q.q).trim()) {
    const rx = new RegExp(String(q.q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    f.$and = [...(f.$and || []), { $or: [{ "visitor.name": rx }, { "visitor.email": rx }, { "visitor.whatsapp": rx }, { lastMessagePreview: rx }] }];
  }
  return f;
}

export async function listConversations(req, res) {
  try {
    const scope = await scopeFilterFor(req.user);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30));
    const filter = listFilter(req, scope);
    const [rows, total] = await Promise.all([
      ChatConversation.find(filter).sort({ status: 1, lastMessageAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      ChatConversation.countDocuments(filter),
    ]);
    // waiting chats first, then newest activity
    rows.sort((a, b) => (b.status === "waiting_agent") - (a.status === "waiting_agent") || new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
    return ok(res, rows.map((c) => adminView(c, req.user)), { total, page, pages: Math.ceil(total / limit) });
  } catch (e) { return fail(res, e); }
}

export async function getConversation(req, res) {
  try {
    const conv = await loadScoped(req.user, req.params.id);
    const messages = await getMessages(conv, { after: req.query.after, admin: true });
    if (conv.unreadForAdmin && userHasPermission(req.user, "chat.manage")) {
      await ChatConversation.updateOne({ _id: conv._id }, { $set: { unreadForAdmin: 0 } });
      conv.unreadForAdmin = 0;
    }
    return ok(res, { conversation: adminView(conv, req.user), messages });
  } catch (e) { return fail(res, e); }
}

export async function reply(req, res) {
  try {
    const conv = await loadScoped(req.user, req.params.id);
    await agentReply(conv, req.user, req.body?.text, { internal: !!req.body?.internal });
    const fresh = await loadScoped(req.user, req.params.id);
    return ok(res, { conversation: adminView(fresh, req.user), messages: await getMessages(fresh, { after: req.body?.after || 0, admin: true }) });
  } catch (e) { return fail(res, e); }
}

export async function doTakeover(req, res) {
  try {
    const conv = await loadScoped(req.user, req.params.id);
    await takeover(conv, req.user);
    const fresh = await loadScoped(req.user, req.params.id);
    return ok(res, { conversation: adminView(fresh, req.user), messages: await getMessages(fresh, { after: req.body?.after || 0, admin: true }) });
  } catch (e) { return fail(res, e); }
}

export async function doHandBack(req, res) {
  try {
    const conv = await loadScoped(req.user, req.params.id);
    await handBackToAI(conv, req.user);
    return ok(res, { conversation: adminView(await loadScoped(req.user, req.params.id), req.user) });
  } catch (e) { return fail(res, e); }
}

export async function doTransfer(req, res) {
  try {
    const conv = await loadScoped(req.user, req.params.id);
    await transfer(conv, req.user, req.body?.role);
    return ok(res, { conversation: adminView(await loadScoped(req.user, req.params.id), req.user) });
  } catch (e) { return fail(res, e); }
}

export async function doClose(req, res) {
  try {
    const conv = await loadScoped(req.user, req.params.id);
    await closeConversation(conv, req.user.name, { resolved: req.body?.resolved === true });
    return ok(res, { conversation: adminView(await loadScoped(req.user, req.params.id), req.user) });
  } catch (e) { return fail(res, e); }
}

export async function patchConversation(req, res) {
  try {
    const conv = await loadScoped(req.user, req.params.id);
    const set = {};
    if (Array.isArray(req.body?.tags)) set.tags = req.body.tags.map((t) => String(t).slice(0, 30)).slice(0, 10);
    if (["low", "normal", "high", "urgent"].includes(req.body?.priority)) set.priority = req.body.priority;
    const v = req.body?.visitor || {};
    if (typeof v.name === "string") set["visitor.name"] = v.name.slice(0, 80);
    if (typeof v.email === "string") set["visitor.email"] = v.email.trim().toLowerCase().slice(0, 120);
    if (typeof v.whatsapp === "string") set["visitor.whatsapp"] = v.whatsapp.replace(/[^\d+]/g, "").slice(0, 20);
    await ChatConversation.updateOne({ _id: conv._id }, { $set: set });
    return ok(res, { conversation: adminView(await loadScoped(req.user, req.params.id), req.user) });
  } catch (e) { return fail(res, e); }
}

export async function getStats(req, res) {
  try {
    const scope = await scopeFilterFor(req.user);
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const base = { ...scope, createdAt: { $gte: since } };
    // Bounded fetch + JS maths (≤5000 rows / 30 days): portable and trivial next to the aggregation pipeline.
    const rows = await ChatConversation.find(base).select("status countryCode firstAgentReplyAt escalation.requestedAt rating visitor.email visitor.whatsapp").limit(5000).lean();
    const byStatus = {}, byCountry = {};
    let respSum = 0, respN = 0, ratingSum = 0, ratingN = 0, leads = 0;
    for (const c of rows) {
      byStatus[c.status] = (byStatus[c.status] || 0) + 1;
      byCountry[c.countryCode] = (byCountry[c.countryCode] || 0) + 1;
      if (c.firstAgentReplyAt && c.escalation?.requestedAt) { respSum += new Date(c.firstAgentReplyAt) - new Date(c.escalation.requestedAt); respN++; }
      if (c.rating?.score) { ratingSum += c.rating.score; ratingN++; }
      if (c.visitor?.email || c.visitor?.whatsapp) leads++;
    }
    return ok(res, {
      days: 30, total: rows.length, leads, byStatus,
      byCountry: seesAllCountries(req.user) ? byCountry : undefined,
      avgFirstResponseSec: respN ? Math.round(respSum / respN / 1000) : null,
      avgRating: ratingN ? Number((ratingSum / ratingN).toFixed(2)) : null,
      ratings: ratingN,
      escalated: rows.filter((c) => c.status !== "ai").length,
    });
  } catch (e) { return fail(res, e); }
}

const csvCell = (v) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
  return `"${s.replace(/"/g, '""')}"`;
};

export async function exportLeads(req, res) {
  try {
    const scope = await scopeFilterFor(req.user);
    const filter = listFilter({ ...req, query: { ...req.query, hasContact: "1" } }, scope);
    const rows = await ChatConversation.find(filter).sort({ createdAt: -1 }).limit(5000).lean();
    const head = ["Date", "Country", "Language", "Channel", "Name", "Email", "WhatsApp", "Status", "Escalated to", "Agent", "Rating", "Summary"];
    const lines = [head.map(csvCell).join(",")];
    for (const c of rows) {
      lines.push([c.createdAt?.toISOString?.() || "", c.countryCode, c.language, c.channel, c.visitor?.name, c.visitor?.email, c.visitor?.whatsapp, c.status, c.escalation?.targetRole || "", c.assignedName || "", c.rating?.score || "", c.summary || ""].map(csvCell).join(","));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="chat-leads-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send("﻿" + lines.join("\n"));
  } catch (e) { return fail(res, e); }
}

export async function getChatSettings(req, res) {
  try { return ok(res, await getSettings(true)); } catch (e) { return fail(res, e); }
}

export async function updateChatSettings(req, res) {
  try {
    const b = req.body || {};
    const set = {};
    for (const k of ["enabled", "aiEnabled", "requireContactForEscalation"]) if (typeof b[k] === "boolean") set[k] = b[k];
    if (typeof b.extraInstructions === "string") set.extraInstructions = b.extraInstructions.slice(0, 4000);
    if (typeof b.model === "string") set.model = b.model.trim().slice(0, 60);
    if (Number.isFinite(+b.slaSeconds)) set.slaSeconds = Math.min(3600, Math.max(30, +b.slaSeconds));
    if (Number.isFinite(+b.alarmRepeatSeconds)) set.alarmRepeatSeconds = Math.min(300, Math.max(10, +b.alarmRepeatSeconds));
    if (Array.isArray(b.disabledCountries)) set.disabledCountries = b.disabledCountries.map((c) => String(c).toUpperCase()).filter((c) => ALL_COUNTRY_CODES.includes(c));
    if (b.welcome && typeof b.welcome === "object") {
      set.welcome = Object.fromEntries(Object.entries(b.welcome).filter(([k, v]) => /^[a-z]{2}$/.test(k) && typeof v === "string").map(([k, v]) => [k, v.slice(0, 300)]));
    }
    await ChatSettings.findOneAndUpdate({ key: "global" }, { $set: set }, { upsert: true, new: true });
    invalidateSettings();
    return ok(res, await getSettings(true));
  } catch (e) { return fail(res, e); }
}
