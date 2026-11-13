// server/controllers/social.controller.js
//   PUBLIC  GET /api/social/public                 active cards for the request's country (+ "ALL" entries)
//   ADMIN   /api/social/admin/*                    social.view / social.manage + utils/featureScope.js
//
// Territory: Manager/Editor (and any non-global admin) manage ONLY their own country's cards and can see,
// read-only, the "ALL" entries IT/Director published. IT/Director manage every country and may publish "ALL".
// Out-of-territory ids are 404; submitting another country is 403 (tampering stays visible).
import mongoose from "mongoose";
import SocialPage, { SOCIAL_PLATFORMS } from "../models/social-page.model.js";
import { COUNTRY_CONFIG, ALL_COUNTRY_CODES } from "../config/countries/index.js";
import { resolveFeatureScope, normalizeCountry } from "../utils/featureScope.js";
import { sanitizeText } from "../utils/campaignValidation.js";
import { logActivity } from "../utils/activityLogger.js";

const ok = (res, data, extra = {}) => res.json({ success: true, error: false, data, ...extra });
const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, error: true, message, ...extra });
const isId = (v) => mongoose.Types.ObjectId.isValid(v) && String(v).length === 24;
export const ALL = "ALL";

const PLATFORM_HOSTS = {
  FACEBOOK: ["facebook.com", "fb.com", "fb.me"],
  INSTAGRAM: ["instagram.com"],
  X: ["x.com", "twitter.com"],
  TIKTOK: ["tiktok.com"],
  YOUTUBE: ["youtube.com", "youtu.be"],
  LINKEDIN: ["linkedin.com"],
  WHATSAPP: ["wa.me", "whatsapp.com"],
  TELEGRAM: ["t.me", "telegram.me"],
};

/** https only, no credentials, and the host must belong to the chosen platform (OTHER: any https host). */
export function validSocialUrl(url, platform) {
  try {
    const u = new URL(String(url || "").trim());
    if (u.protocol !== "https:" || u.username || u.password || /[\s<>"]/.test(String(url))) return false;
    const hosts = PLATFORM_HOSTS[platform];
    if (!hosts) return platform === "OTHER";
    const h = u.hostname.toLowerCase();
    return hosts.some((d) => h === d || h.endsWith(`.${d}`));
  } catch { return false; }
}
const validImage = (url) => { try { const u = new URL(url); return u.protocol === "https:" && !u.username && !/[\s<>"]/.test(url); } catch { return false; } };

function scopeOr403(req, res) {
  const scope = resolveFeatureScope(req.user);
  if (scope.denied) { fail(res, 403, "Admin access required"); return null; }
  return scope;
}
const audit = (req, action, description, doc) =>
  logActivity({ userId: req.user._id, action, description, resourceType: "SocialPage", resourceId: doc?._id, resourceName: doc?.name || "", req });

function validate(body, { partial = false, existing = null } = {}) {
  const errors = []; const data = {};
  const has = (k) => body[k] !== undefined;
  const platform = has("platform") ? String(body.platform).toUpperCase() : existing?.platform;
  if (!partial || has("platform")) { if (!SOCIAL_PLATFORMS.includes(platform)) errors.push("Choose a valid platform"); else data.platform = platform; }
  if (!partial || has("name")) { const n = sanitizeText(body.name, 80); if (!n) errors.push("Name is required"); else data.name = n; }
  if (has("handle")) data.handle = sanitizeText(body.handle, 60);
  if (!partial || has("url")) { if (!validSocialUrl(body.url, platform)) errors.push(`Link must be an https ${platform && platform !== "OTHER" ? platform.toLowerCase() : ""} address`.replace("  ", " ")); else data.url = String(body.url).trim(); }
  else if (has("platform") && existing && !validSocialUrl(existing.url, platform)) errors.push("The existing link does not match the new platform; update the link too");
  if (has("description")) data.description = sanitizeText(body.description, 200);
  if (has("followersLabel")) data.followersLabel = sanitizeText(body.followersLabel, 30);
  if (has("imageUrl")) { const v = String(body.imageUrl || "").trim(); if (v && !validImage(v)) errors.push("Image must be an https URL"); else data.imageUrl = v; }
  if (has("showFeed")) data.showFeed = !!body.showFeed;
  if (has("isActive")) data.isActive = !!body.isActive;
  if (has("sortOrder")) { const n = Number(body.sortOrder); if (!Number.isInteger(n) || n < 0 || n > 9999) errors.push("Order must be a whole number between 0 and 9999"); else data.sortOrder = n; }
  if (data.showFeed && (data.platform || platform) !== "FACEBOOK") data.showFeed = false; // live feed is Facebook-only
  return { errors, data };
}

/** Country an entry is created/moved in. "ALL" is IT/Director only. */
function targetCountry(scope, requested) {
  const raw = String(requested || "").toUpperCase();
  if (raw === ALL) return scope.isGlobal ? { countryCode: ALL } : { error: { status: 403, message: "Only IT or Director can publish for all countries" } };
  const c = normalizeCountry(raw);
  if (raw && !c) return { error: { status: 400, message: "Unknown country" } };
  if (scope.isGlobal) return c ? { countryCode: c } : { error: { status: 400, message: "countryCode is required" } };
  if (c && c !== scope.countryCode) return { error: { status: 403, message: `Access denied: you can only manage ${scope.countryCode} data` } };
  return { countryCode: scope.countryCode };
}
const canEdit = (scope, doc) => scope.isGlobal || doc.countryCode === scope.countryCode;

export const socialMeta = (req, res) => {
  const scope = scopeOr403(req, res); if (!scope) return;
  const countries = Object.values(COUNTRY_CONFIG).filter((c) => scope.isGlobal || c.code === scope.countryCode).map((c) => ({ code: c.code, name: c.name, flag: c.flagEmoji }));
  return ok(res, { scope: { isGlobal: scope.isGlobal, countryCode: scope.countryCode }, countries, platforms: SOCIAL_PLATFORMS, canPublishAll: scope.isGlobal });
};

export const listSocial = async (req, res) => {
  try {
    const scope = scopeOr403(req, res); if (!scope) return;
    let where = {};
    if (scope.isGlobal) {
      const q = String(req.query.countryCode || "").toUpperCase();
      if (q === ALL) where = { countryCode: ALL };
      else if (normalizeCountry(q)) where = { countryCode: q };
    } else where = { countryCode: { $in: [scope.countryCode, ALL] } };
    const rows = await SocialPage.find(where).sort({ countryCode: 1, sortOrder: 1, createdAt: 1 }).lean();
    return ok(res, rows.map((r) => ({ ...r, editable: canEdit(scope, r) })));
  } catch (e) { return fail(res, 500, e.message); }
};

export const createSocial = async (req, res) => {
  try {
    const scope = scopeOr403(req, res); if (!scope) return;
    const t = targetCountry(scope, req.body.countryCode);
    if (t.error) return fail(res, t.error.status, t.error.message);
    const v = validate(req.body);
    if (v.errors.length) return fail(res, 400, v.errors[0], { errors: v.errors });
    const last = await SocialPage.findOne({ countryCode: t.countryCode }).sort({ sortOrder: -1 }).select("sortOrder").lean();
    const doc = await SocialPage.create({ ...v.data, countryCode: t.countryCode, sortOrder: v.data.sortOrder ?? (last ? last.sortOrder + 1 : 0), createdBy: req.user._id, updatedBy: req.user._id });
    audit(req, "SOCIAL_CREATE", `Added ${doc.platform} page "${doc.name}" (${doc.countryCode})`, doc);
    return ok(res, { ...doc.toObject(), editable: true });
  } catch (e) { return fail(res, 500, e.message); }
};

async function loadEditable(req, res, scope) {
  if (!isId(req.params.id)) { fail(res, 404, "Not found"); return null; }
  const doc = await SocialPage.findById(req.params.id);
  // Out of territory (another country's card) is indistinguishable from missing.
  if (!doc || (!scope.isGlobal && ![scope.countryCode, ALL].includes(doc.countryCode))) { fail(res, 404, "Not found"); return null; }
  if (!canEdit(scope, doc)) { fail(res, 403, "This card is managed by IT/Director for all countries"); return null; }
  return doc;
}

export const updateSocial = async (req, res) => {
  try {
    const scope = scopeOr403(req, res); if (!scope) return;
    const doc = await loadEditable(req, res, scope); if (!doc) return;
    if (req.body.countryCode !== undefined && String(req.body.countryCode).toUpperCase() !== doc.countryCode) {
      const t = targetCountry(scope, req.body.countryCode);
      if (t.error) return fail(res, t.error.status, t.error.message);
      doc.countryCode = t.countryCode;
    }
    const v = validate(req.body, { partial: true, existing: doc });
    if (v.errors.length) return fail(res, 400, v.errors[0], { errors: v.errors });
    Object.assign(doc, v.data, { updatedBy: req.user._id });
    if (doc.platform !== "FACEBOOK") doc.showFeed = false;
    await doc.save();
    audit(req, "SOCIAL_UPDATE", `Updated ${doc.platform} page "${doc.name}" (${doc.countryCode})`, doc);
    return ok(res, { ...doc.toObject(), editable: true });
  } catch (e) { return fail(res, 500, e.message); }
};

export const deleteSocial = async (req, res) => {
  try {
    const scope = scopeOr403(req, res); if (!scope) return;
    const doc = await loadEditable(req, res, scope); if (!doc) return;
    await doc.deleteOne();
    audit(req, "SOCIAL_DELETE", `Removed ${doc.platform} page "${doc.name}" (${doc.countryCode})`, doc);
    return ok(res, { _id: doc._id });
  } catch (e) { return fail(res, 500, e.message); }
};

/** Body { ids: [...] } — sets sortOrder by position, only for cards the caller may edit. */
export const reorderSocial = async (req, res) => {
  try {
    const scope = scopeOr403(req, res); if (!scope) return;
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String).filter(isId).slice(0, 200) : [];
    if (!ids.length) return fail(res, 400, "ids are required");
    const docs = await SocialPage.find({ _id: { $in: ids } });
    const editable = new Map(docs.filter((d) => canEdit(scope, d) && (scope.isGlobal || d.countryCode === scope.countryCode)).map((d) => [String(d._id), d]));
    if (editable.size !== ids.length) return fail(res, 404, "Not found");
    await Promise.all(ids.map((id, i) => SocialPage.updateOne({ _id: id }, { $set: { sortOrder: i, updatedBy: req.user._id } })));
    return ok(res, { count: ids.length });
  } catch (e) { return fail(res, 500, e.message); }
};

// ── Public ───────────────────────────────────────────────────────────────────
export const publicSocial = async (req, res) => {
  try {
    const code = ALL_COUNTRY_CODES.includes(req.countryCode) ? req.countryCode : "NG";
    const rows = await SocialPage.find({ countryCode: { $in: [code, ALL] }, isActive: true })
      .select("platform name handle url description imageUrl followersLabel showFeed sortOrder countryCode").lean();
    // A country's own cards come before the global ones, each group by its order.
    rows.sort((a, b) => (a.countryCode === ALL) - (b.countryCode === ALL) || a.sortOrder - b.sortOrder);
    res.set("Cache-Control", "public, max-age=60");
    res.set("Vary", "Host, X-Country-Code");
    return ok(res, rows.map(({ countryCode, sortOrder, ...r }) => r));
  } catch (e) { return fail(res, 500, e.message); }
};
