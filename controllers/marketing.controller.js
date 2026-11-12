// server/controllers/marketing.controller.js
//
// Email marketing: compose a branded e-commerce e-mail and send it in bulk to ONE
// country's customers. Territory is decided here (utils/featureScope.js), never by the
// client: IT/Director pick a country explicitly; Manager/Sales/Editor are confined to
// their own (country-scoped → assignedCountry, otherwise Nigeria/HQ).
import mongoose from "mongoose";
import MarketingEmailModel from "../models/marketing-email.model.js";
import RecipientModel from "../models/marketing-recipient.model.js";
import SuppressionModel from "../models/marketing-suppression.model.js";
import SubscriberModel from "../models/subscriber.model.js";
import { COUNTRY_CONFIG, getCountryByCode } from "../config/countries/index.js";
import { resolveFeatureScope, featureCountryFilter, resolveCreateCountry } from "../utils/featureScope.js";
import { sanitizeText, isSafeLink } from "../utils/campaignValidation.js";
import { userHasPermission } from "../middleware/requirePermission.js";
import { logActivity } from "../utils/activityLogger.js";
import { sendCountryEmail } from "../config/emailService.js";
import { buildAudience, isValidEmail, MAX_RECIPIENTS } from "../services/marketing/audience.js";
import { loadFeaturedProducts, renderFor, processBatch, refreshStats, kickBackground, BATCH_SIZE } from "../services/marketing/sender.js";
import { personalize, verifyUnsubscribe, STRINGS } from "../services/marketing/template.js";

const ok = (res, data, extra = {}) => res.json({ success: true, error: false, data, ...extra });
const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, error: true, message, ...extra });
const isId = (v) => mongoose.Types.ObjectId.isValid(v);
const HEX = /^#[0-9a-fA-F]{6}$/;
const LANGS = ["en", "fr", "it"];

function scopeOr403(req, res) {
  const scope = resolveFeatureScope(req.user);
  if (scope.denied) { fail(res, 403, "Admin access required"); return null; }
  return scope;
}
async function loadEmail(req, res, id) {
  if (!isId(id)) { fail(res, 404, "Email campaign not found"); return null; }
  const scope = scopeOr403(req, res);
  if (!scope) return null;
  const doc = await MarketingEmailModel.findOne({ _id: id, ...featureCountryFilter(scope) });
  if (!doc) { fail(res, 404, "Email campaign not found"); return null; }
  return { doc, scope };
}
const label = (code) => { const c = COUNTRY_CONFIG[code]; return { code, name: c.name, flag: c.flagEmoji, language: LANGS.includes(c.language?.default) ? c.language.default : "en" }; };
const history = (doc, req, action, note = "") => {
  doc.history.push({ at: new Date(), by: req.user._id, byName: req.user.name || req.user.email, action, note });
  if (doc.history.length > 100) doc.history.splice(0, doc.history.length - 100);
};
const audit = (req, action, description, doc) =>
  logActivity({ userId: req.user._id, action, description, resourceType: "MarketingEmail", resourceId: doc?._id, resourceName: doc?.name || "", req });

/** Validate + sanitise the editable parts. Plain text only; body is markdown-lite rendered+escaped later. */
export function validateMarketingInput(body = {}, { partial = false } = {}) {
  const errors = [];
  const data = {};
  const need = (k, v, max, label) => {
    const s = sanitizeText(v, max);
    if (!s) errors.push(`${label} is required`);
    return s;
  };
  if (!partial || body.name !== undefined) data.name = need("name", body.name, 120, "Name");
  if (!partial || body.subject !== undefined) data.subject = need("subject", body.subject, 150, "Subject");
  if (body.preheader !== undefined) data.preheader = sanitizeText(body.preheader, 150);
  if (body.language !== undefined) {
    if (!LANGS.includes(body.language)) errors.push("Unsupported language");
    else data.language = body.language;
  }
  if (body.template && typeof body.template === "object") {
    const t = body.template;
    data.template = {};
    if (t.headline !== undefined) data.template.headline = sanitizeText(t.headline, 150);
    if (t.body !== undefined) data.template.body = String(t.body).replace(/[<>]/g, "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, 8000);
    if (t.ctaLabel !== undefined) data.template.ctaLabel = sanitizeText(t.ctaLabel, 60);
    if (t.footerNote !== undefined) data.template.footerNote = sanitizeText(t.footerNote, 300);
    for (const k of ["ctaUrl", "heroImage"]) {
      if (t[k] !== undefined) {
        const v = String(t[k]).trim();
        if (v && !isSafeLink(v)) errors.push(`${k === "ctaUrl" ? "Button link" : "Hero image"} must be an https:// URL or an internal path`);
        else data.template[k] = v;
      }
    }
    if (t.accentColor !== undefined) {
      if (!HEX.test(t.accentColor)) errors.push("Accent colour must be a 6-digit hex value");
      else data.template.accentColor = t.accentColor.toUpperCase();
    }
    if (t.productIds !== undefined) {
      const ids = Array.isArray(t.productIds) ? [...new Set(t.productIds.map(String).filter(isId))].slice(0, 6) : [];
      data.template.productIds = ids;
    }
    if (data.template.ctaLabel && data.template.ctaUrl === "") errors.push("A button label needs a link");
  }
  if (body.audience && typeof body.audience === "object") {
    const a = body.audience;
    data.audience = {};
    if (a.sources !== undefined) {
      const src = (Array.isArray(a.sources) ? a.sources : []).filter((x) => ["USERS", "CUSTOMERS", "SUBSCRIBERS"].includes(x));
      if (!src.length) errors.push("Pick at least one audience source");
      data.audience.sources = src;
    }
    if (a.customerTypes !== undefined) data.audience.customerTypes = (Array.isArray(a.customerTypes) ? a.customerTypes : []).filter((x) => ["BTC", "BTB"].includes(x));
    if (a.verifiedOnly !== undefined) data.audience.verifiedOnly = !!a.verifiedOnly;
  }
  return { data, errors };
}
const flatten = (prefix, obj, out = {}) => {
  for (const [k, v] of Object.entries(obj || {})) {
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(`${prefix}${k}.`, v, out);
    else out[`${prefix}${k}`] = v;
  }
  return out;
};

// ── reference data ───────────────────────────────────────────────────────────
export const getMarketingMeta = async (req, res) => {
  try {
    const scope = scopeOr403(req, res);
    if (!scope) return;
    const countries = Object.keys(COUNTRY_CONFIG).filter((c) => scope.isGlobal || c === scope.countryCode).map(label);
    return ok(res, {
      countries, isGlobal: scope.isGlobal, countryCode: scope.countryCode,
      permissions: { manage: userHasPermission(req.user, "marketing.manage"), send: userHasPermission(req.user, "marketing.send") },
      limits: { maxRecipients: MAX_RECIPIENTS(), batchSize: BATCH_SIZE() },
      unsubscribeConfigured: Boolean(process.env.SERVER_BASE_URL || process.env.API_PUBLIC_URL),
    });
  } catch (err) { return fail(res, 500, err.message); }
};

export const listMarketing = async (req, res) => {
  try {
    const scope = scopeOr403(req, res);
    if (!scope) return;
    const q = { ...featureCountryFilter(scope, req.query.countryCode) };
    if (req.query.status && ["DRAFT", "SENDING", "SENT", "FAILED", "CANCELLED"].includes(req.query.status)) q.status = req.query.status;
    const search = String(req.query.search || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (search) q.$or = [{ name: { $regex: search, $options: "i" } }, { subject: { $regex: search, $options: "i" } }];
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const [rows, total] = await Promise.all([
      MarketingEmailModel.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select("-history").populate("createdBy", "name").lean(),
      MarketingEmailModel.countDocuments(q),
    ]);
    return ok(res, rows, { pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 } });
  } catch (err) { return fail(res, 500, err.message); }
};

export const getMarketing = async (req, res) => {
  try {
    const loaded = await loadEmail(req, res, req.params.id);
    if (!loaded) return;
    // A SENDING campaign that nobody is driving (browser closed) is nudged forward by whoever looks at it.
    return ok(res, loaded.doc.toObject());
  } catch (err) { return fail(res, 500, err.message); }
};

export const audienceCount = async (req, res) => {
  try {
    const scope = scopeOr403(req, res);
    if (!scope) return;
    const { countryCode, error } = resolveCreateCountry(scope, req.query.countryCode || undefined);
    if (error) return fail(res, error.status, error.message);
    const sources = String(req.query.sources || "").split(",").filter(Boolean);
    const customerTypes = String(req.query.customerTypes || "").split(",").filter(Boolean);
    const a = await buildAudience(countryCode, { sources, customerTypes, verifiedOnly: req.query.verifiedOnly !== "false" });
    return ok(res, { countryCode, total: a.recipients.length, suppressed: a.suppressed, invalid: a.invalid, bySource: a.bySource });
  } catch (err) { return fail(res, 500, err.message); }
};

// ── CRUD ─────────────────────────────────────────────────────────────────────
export const createMarketing = async (req, res) => {
  try {
    const scope = scopeOr403(req, res);
    if (!scope) return;
    const { countryCode, error } = resolveCreateCountry(scope, req.body.countryCode);
    if (error) return fail(res, error.status, error.message);
    const { data, errors } = validateMarketingInput(req.body);
    if (errors.length) return fail(res, 400, errors[0], { errors });
    const country = getCountryByCode(countryCode);
    const doc = new MarketingEmailModel({
      ...data, countryCode,
      language: data.language || (LANGS.includes(country?.language?.default) ? country.language.default : "en"),
      createdBy: req.user._id, updatedBy: req.user._id,
    });
    history(doc, req, "CREATED");
    await doc.save();
    audit(req, "MARKETING_CREATE", `Created email campaign "${doc.name}" (${countryCode})`, doc);
    return ok(res, doc.toObject(), { message: "Email campaign created" });
  } catch (err) { return fail(res, 500, err.message); }
};

export const updateMarketing = async (req, res) => {
  try {
    const loaded = await loadEmail(req, res, req.params.id);
    if (!loaded) return;
    const { doc } = loaded;
    if (doc.status !== "DRAFT") return fail(res, 409, "Only DRAFT email campaigns can be edited. Duplicate it to send a variation.");
    if (req.body.countryCode !== undefined && String(req.body.countryCode).toUpperCase() !== doc.countryCode) return fail(res, 403, "An email campaign's country cannot be changed.");
    const { data, errors } = validateMarketingInput(req.body, { partial: true });
    if (errors.length) return fail(res, 400, errors[0], { errors });
    const flat = flatten("", data);
    for (const [k, v] of Object.entries(flat)) doc.set(k, v);
    doc.updatedBy = req.user._id;
    history(doc, req, "UPDATED");
    await doc.save();
    audit(req, "MARKETING_UPDATE", `Updated email campaign "${doc.name}"`, doc);
    return ok(res, doc.toObject(), { message: "Saved" });
  } catch (err) { return fail(res, 500, err.message); }
};

export const duplicateMarketing = async (req, res) => {
  try {
    const loaded = await loadEmail(req, res, req.params.id);
    if (!loaded) return;
    const src = loaded.doc.toObject();
    const copy = new MarketingEmailModel({
      countryCode: src.countryCode, name: `${src.name} (copy)`.slice(0, 120), subject: src.subject, preheader: src.preheader,
      language: src.language, template: src.template, audience: src.audience, createdBy: req.user._id, updatedBy: req.user._id,
    });
    history(copy, req, "DUPLICATED", String(src._id));
    await copy.save();
    audit(req, "MARKETING_CREATE", `Duplicated email campaign "${src.name}"`, copy);
    return ok(res, copy.toObject());
  } catch (err) { return fail(res, 500, err.message); }
};

export const deleteMarketing = async (req, res) => {
  try {
    const loaded = await loadEmail(req, res, req.params.id);
    if (!loaded) return;
    const { doc } = loaded;
    if (!["DRAFT", "CANCELLED"].includes(doc.status)) return fail(res, 409, "Sent or sending campaigns are kept for the delivery record. Only drafts and cancelled campaigns can be deleted.");
    await RecipientModel.deleteMany({ marketingEmailId: doc._id });
    await MarketingEmailModel.deleteOne({ _id: doc._id });
    audit(req, "MARKETING_DELETE", `Deleted email campaign "${doc.name}"`, doc);
    return ok(res, { _id: doc._id });
  } catch (err) { return fail(res, 500, err.message); }
};

// ── preview + test ───────────────────────────────────────────────────────────
const SAMPLE = { name: "Ama Mensah", email: "ama@example.com" };
export const previewMarketing = async (req, res) => {
  try {
    const scope = scopeOr403(req, res);
    if (!scope) return;
    let campaign;
    if (req.params.id) {
      const loaded = await loadEmail(req, res, req.params.id);
      if (!loaded) return;
      campaign = loaded.doc.toObject();
    } else {
      const { countryCode, error } = resolveCreateCountry(scope, req.body.countryCode);
      if (error) return fail(res, error.status, error.message);
      const { data, errors } = validateMarketingInput(req.body, { partial: true });
      if (errors.length) return fail(res, 400, errors[0], { errors });
      campaign = { countryCode, subject: data.subject || "", preheader: data.preheader || "", language: data.language || "en", template: data.template || {} };
    }
    const products = await loadFeaturedProducts(campaign);
    return ok(res, { subject: personalize(campaign.subject, { name: SAMPLE.name }), html: renderFor(campaign, products, SAMPLE) });
  } catch (err) { return fail(res, 500, err.message); }
};

const testWindow = new Map(); // userId → [timestamps]; light abuse guard for test sends
export const testSendMarketing = async (req, res) => {
  try {
    const loaded = await loadEmail(req, res, req.params.id);
    if (!loaded) return;
    const { doc } = loaded;
    const to = [...new Set((Array.isArray(req.body.emails) ? req.body.emails : [req.user.email]).map((e) => String(e).trim().toLowerCase()))].filter(isValidEmail).slice(0, 3);
    if (!to.length) return fail(res, 400, "Give at least one valid test e-mail address (max 3)");
    const key = String(req.user._id);
    const recent = (testWindow.get(key) || []).filter((t) => Date.now() - t < 3600_000);
    if (recent.length + to.length > 15) return fail(res, 429, "Too many test sends this hour — try again later");
    testWindow.set(key, [...recent, ...to.map(() => Date.now())]);
    const campaign = doc.toObject();
    const products = await loadFeaturedProducts(campaign);
    for (const email of to) {
      await sendCountryEmail({ countryCode: campaign.countryCode, sendTo: email, subject: `[TEST] ${personalize(campaign.subject, { name: SAMPLE.name })}`, html: renderFor(campaign, products, { name: req.user.name || SAMPLE.name, email }) });
    }
    audit(req, "MARKETING_TEST", `Sent test of "${doc.name}" to ${to.length} address(es)`, doc);
    return ok(res, { sentTo: to });
  } catch (err) { return fail(res, 502, `Test e-mail failed: ${err.message}`); }
};

// ── send / progress / cancel ─────────────────────────────────────────────────
export const sendMarketing = async (req, res) => {
  try {
    const loaded = await loadEmail(req, res, req.params.id);
    if (!loaded) return;
    const { doc } = loaded;
    if (req.body?.confirm !== true) return fail(res, 400, "Sending must be confirmed (confirm: true)");
    if (doc.status !== "DRAFT") return fail(res, 409, `This campaign is already ${doc.status}`);
    const t = doc.template || {};
    if (!doc.subject || !(t.headline || t.body)) return fail(res, 400, "Add a subject and a headline or message before sending");

    const aud = await buildAudience(doc.countryCode, doc.audience);
    if (!aud.recipients.length) return fail(res, 400, "No eligible recipients in this country for the selected audience");
    if (aud.recipients.length > MAX_RECIPIENTS()) return fail(res, 400, `Audience of ${aud.recipients.length} exceeds the safety cap of ${MAX_RECIPIENTS()}. Narrow the audience.`);

    // Atomic DRAFT → SENDING: two clicks / two admins can never start the same send twice.
    const started = await MarketingEmailModel.findOneAndUpdate(
      { _id: doc._id, status: "DRAFT" },
      { $set: { status: "SENDING", sendStartedAt: new Date(), sentBy: req.user._id, stats: { total: aud.recipients.length, sent: 0, failed: 0, skipped: 0, pending: aud.recipients.length } }, $push: { history: { at: new Date(), by: req.user._id, byName: req.user.name || req.user.email, action: "SEND_STARTED", note: `${aud.recipients.length} recipients` } } },
      { new: true },
    );
    if (!started) return fail(res, 409, "This campaign was already started");
    for (let i = 0; i < aud.recipients.length; i += 1000) {
      await RecipientModel.insertMany(aud.recipients.slice(i, i + 1000).map((r) => ({ ...r, marketingEmailId: doc._id, countryCode: doc.countryCode })), { ordered: false });
    }
    audit(req, "MARKETING_SEND", `Started sending "${doc.name}" to ${aud.recipients.length} ${doc.countryCode} recipients`, doc);
    kickBackground(doc._id);
    const first = await processBatch(doc._id);
    return ok(res, first.campaign, { done: first.done, processed: first.processed });
  } catch (err) { return fail(res, 500, err.message); }
};

export const processMarketingBatch = async (req, res) => {
  try {
    const loaded = await loadEmail(req, res, req.params.id);
    if (!loaded) return;
    const r = await processBatch(loaded.doc._id);
    return ok(res, r.campaign, { done: r.done, processed: r.processed });
  } catch (err) { return fail(res, 500, err.message); }
};

export const cancelMarketing = async (req, res) => {
  try {
    const loaded = await loadEmail(req, res, req.params.id);
    if (!loaded) return;
    const { doc } = loaded;
    if (doc.status !== "SENDING") return fail(res, 409, "Only a campaign that is currently sending can be cancelled");
    await RecipientModel.updateMany({ marketingEmailId: doc._id, status: "PENDING" }, { $set: { status: "SKIPPED", error: "cancelled" } });
    const fresh = await refreshStats(doc._id); // closes it (nothing pending) as SENT/FAILED…
    await MarketingEmailModel.updateOne({ _id: doc._id }, { $set: { status: "CANCELLED", sendCompletedAt: new Date() }, $push: { history: { at: new Date(), by: req.user._id, byName: req.user.name || req.user.email, action: "CANCELLED" } } });
    audit(req, "MARKETING_CANCEL", `Cancelled sending "${doc.name}"`, doc);
    return ok(res, { ...(fresh?.toObject?.() || fresh), status: "CANCELLED" });
  } catch (err) { return fail(res, 500, err.message); }
};

export const listRecipients = async (req, res) => {
  try {
    const loaded = await loadEmail(req, res, req.params.id);
    if (!loaded) return;
    const q = { marketingEmailId: loaded.doc._id };
    if (["PENDING", "SENDING", "SENT", "FAILED", "SKIPPED"].includes(req.query.status)) q.status = req.query.status;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const [rows, total] = await Promise.all([
      RecipientModel.find(q).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).select("email name status error sentAt attempts").lean(),
      RecipientModel.countDocuments(q),
    ]);
    return ok(res, rows, { pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 } });
  } catch (err) { return fail(res, 500, err.message); }
};

// ── PUBLIC: one-click unsubscribe (signed link; no login) ────────────────────
const page = (lang, title, msg) => `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:Arial,sans-serif;background:#f3f0ec;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0"><div style="background:#fff;padding:32px;border-radius:10px;max-width:420px;text-align:center"><h2 style="margin-top:0">${title}</h2><p style="color:#555">${msg}</p></div></body></html>`;
export const unsubscribe = async (req, res) => {
  const src = { ...req.query, ...(req.body || {}) };
  let email = "";
  try { email = Buffer.from(String(src.e || ""), "base64url").toString("utf8").toLowerCase(); } catch { /* invalid */ }
  const cc = String(src.c || "").toUpperCase();
  const lang = LANGS.includes(getCountryByCode(cc)?.language?.default) ? getCountryByCode(cc).language.default : "en";
  const T = { en: ["Unsubscribed", "You will no longer receive marketing emails from us.", "This unsubscribe link is not valid."], fr: ["Désabonné", "Vous ne recevrez plus d'e-mails marketing de notre part.", "Ce lien de désabonnement n'est pas valide."], it: ["Iscrizione annullata", "Non riceverai più e-mail promozionali da noi.", "Questo link di annullamento non è valido."] }[lang];
  if (!isValidEmail(email) || !getCountryByCode(cc) || !verifyUnsubscribe(email, cc, src.t)) return res.status(400).type("html").send(page(lang, "—", T[2]));
  try {
    await SuppressionModel.updateOne({ email, countryCode: cc }, { $setOnInsert: { reason: "UNSUBSCRIBED" } }, { upsert: true });
    await SubscriberModel.updateMany({ email, countryCode: cc }, { $set: { isActive: false, unsubscribedAt: new Date() } });
  } catch (e) { console.error("[marketing] unsubscribe failed:", e.message); return res.status(500).type("html").send(page(lang, "—", "Please try again later.")); }
  return res.type("html").send(page(lang, T[0], T[1]));
};
void STRINGS;
