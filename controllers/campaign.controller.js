// server/controllers/campaign.controller.js
//
// Seasonal campaigns: admin CRUD + lifecycle, discount rules, content blocks,
// scoped selectors, preview, performance — and the PUBLIC endpoints the
// storefront and mobile app read.
//
// AUTHORISATION MODEL (see utils/campaignScope.js for the country half)
//   capability : requirePermission("campaigns.view|manage|publish") on the route
//   territory  : resolveCampaignScope(user) — every query below is built from it
//   draft rule : a user WITHOUT campaigns.publish may only modify DRAFT
//                campaigns (and their rules/blocks); anything live/paused/
//                archived is publisher-only.
// Records outside the caller's territory answer 404 (never 403) so existence
// of another country's campaign is not disclosed.

import mongoose from "mongoose";
import CampaignModel, { deriveCampaignStatus } from "../models/campaign.model.js";
import CampaignDiscountRuleModel from "../models/campaign-discount-rule.model.js";
import CampaignContentBlockModel from "../models/campaign-content-block.model.js";
import ProductModel from "../models/product.model.js";
import CategoryModel from "../models/category.model.js";
import BrandModel from "../models/brand.model.js";
import OrderModel from "../models/order.model.js";
import { logActivity } from "../utils/activityLogger.js";
import { userHasPermission } from "../middleware/requirePermission.js";
import { getCountryByCode, COUNTRY_CONFIG } from "../config/countries/index.js";
import {
  resolveCampaignScope,
  campaignCountryFilter,
  resolveCreateCountry,
  normalizeCountry,
} from "../utils/campaignScope.js";
import {
  validateCampaignInput,
  validateRuleInput,
  validateBlockInput,
  validateTheme,
  themeAccessibilityErrors,
  sanitizeText,
  slugify,
} from "../utils/campaignValidation.js";
import { THEME_PRESETS } from "../utils/campaignTheme.js";
import {
  getCampaignContext,
  invalidateCampaignCache,
  decorateProductsWithCampaignPricing,
} from "../services/campaignPricing.js";
import { localizeList, localizeOne, translateEntity } from "../utils/translationService.js";
import { buildClientVisibilityFilter } from "./product.controller.js";

const ok = (res, data, extra = {}) => res.json({ success: true, error: false, data, ...extra });
const fail = (res, status, message, extra = {}) =>
  res.status(status).json({ success: false, error: true, message, ...extra });

const isId = (v) => mongoose.Types.ObjectId.isValid(v);
const actorName = (u) => u?.name || u?.email || "";

const canPublish = (user) => userHasPermission(user, "campaigns.publish");

// ── helpers ──────────────────────────────────────────────────────────────────
function scopeOr403(req, res) {
  const scope = resolveCampaignScope(req.user);
  if (scope.denied) {
    fail(res, 403, "Admin access required");
    return null;
  }
  return scope;
}

/** Load a campaign the caller may see; null (and a 404 already sent) otherwise. */
async function loadCampaign(req, res, id) {
  if (!isId(id)) {
    fail(res, 404, "Campaign not found");
    return null;
  }
  const scope = scopeOr403(req, res);
  if (!scope) return null;
  const doc = await CampaignModel.findOne({ _id: id, ...campaignCountryFilter(scope) });
  if (!doc) {
    fail(res, 404, "Campaign not found");
    return null;
  }
  return { doc, scope };
}

/** Non-publishers may only touch DRAFT campaigns. Returns true when blocked (403 sent). */
function blockedByDraftRule(req, res, campaign) {
  if (canPublish(req.user)) return false;
  if (campaign.publishState === "DRAFT") return false;
  fail(res, 403, "Only DRAFT campaigns can be changed with your role. Ask a manager to change a live, paused or archived campaign.");
  return true;
}

function pushHistory(doc, req, action, note = "", changes) {
  doc.history.push({ at: new Date(), by: req.user._id, byName: actorName(req.user), action, note, ...(changes ? { changes } : {}) });
  if (doc.history.length > 200) doc.history.splice(0, doc.history.length - 200);
}

function audit(req, action, description, doc, extra = {}) {
  logActivity({
    userId: req.user?._id,
    action,
    description,
    resourceType: "Campaign",
    resourceId: doc?._id,
    resourceName: doc?.name || "",
    req,
    ...extra,
  });
}

function translateLater(entityType, doc) {
  // Never blocks or fails the admin action; the translation pipeline already logs its own errors.
  Promise.resolve()
    .then(() => translateEntity({ entityType, entityId: doc._id, document: doc.toObject ? doc.toObject() : doc }))
    .catch((e) => console.error(`[translate] ${entityType}:`, e.message));
}

const afterMutation = (countryCode) => invalidateCampaignCache(countryCode);

/** Overlap checks for publishing. Equal-priority overlap is a hard conflict; others are warnings. */
async function findOverlaps(campaign) {
  const overlapping = await CampaignModel.find({
    countryCode: campaign.countryCode,
    _id: { $ne: campaign._id },
    publishState: "PUBLISHED",
    startsAt: { $lt: campaign.endsAt },
    endsAt: { $gt: campaign.startsAt },
  })
    .select("name slug type priority startsAt endsAt")
    .lean();
  return {
    conflicts: overlapping.filter((c) => c.priority === campaign.priority),
    warnings: overlapping.filter((c) => c.priority !== campaign.priority),
  };
}

async function ruleCounts(campaignIds) {
  if (!campaignIds.length) return new Map();
  const rows = await CampaignDiscountRuleModel.aggregate([
    { $match: { campaignId: { $in: campaignIds }, status: "ACTIVE" } },
    { $group: { _id: "$campaignId", n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

const countryLabel = (code) => {
  const c = COUNTRY_CONFIG[code];
  return c ? { code, name: c.name, domain: c.domain, timezone: c.timezone, currency: c.currency?.code } : { code };
};

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — reference data
// ═════════════════════════════════════════════════════════════════════════════
export const getCampaignMeta = async (req, res) => {
  try {
    const scope = scopeOr403(req, res);
    if (!scope) return;
    const countries = Object.keys(COUNTRY_CONFIG)
      .filter((code) => scope.isGlobal || code === scope.countryCode)
      .map(countryLabel);
    return ok(res, {
      presets: THEME_PRESETS,
      countries,
      isGlobal: scope.isGlobal,
      countryCode: scope.countryCode,
      permissions: {
        manage: userHasPermission(req.user, "campaigns.manage"),
        publish: canPublish(req.user),
      },
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    return fail(res, 500, err.message);
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — campaigns
// ═════════════════════════════════════════════════════════════════════════════
export const listCampaigns = async (req, res) => {
  try {
    const scope = scopeOr403(req, res);
    if (!scope) return;
    const { search, type, status, from, to, countryCode } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));

    const q = { ...campaignCountryFilter(scope, countryCode) };
    if (type) q.type = String(type);
    if (search) q.name = { $regex: String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    if (from || to) {
      q.startsAt = {};
      if (from) q.startsAt.$gte = new Date(from);
      if (to) q.startsAt.$lte = new Date(to);
    }

    // `status` is derived (see deriveCampaignStatus), so translate it to a query.
    const now = new Date();
    if (status) {
      switch (status) {
        case "DRAFT": case "PAUSED": case "ARCHIVED": q.publishState = status; break;
        case "SCHEDULED": q.publishState = "PUBLISHED"; q.startsAt = { ...(q.startsAt || {}), $gt: now }; break;
        case "ACTIVE": q.publishState = "PUBLISHED"; q.startsAt = { ...(q.startsAt || {}), $lte: now }; q.endsAt = { $gte: now }; break;
        case "ENDED": q.publishState = "PUBLISHED"; q.endsAt = { $lt: now }; break;
        default: break;
      }
    }

    const [rows, total] = await Promise.all([
      CampaignModel.find(q)
        .sort({ startsAt: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("createdBy", "name")
        .populate("updatedBy", "name")
        .lean({ virtuals: false }),
      CampaignModel.countDocuments(q),
    ]);
    const counts = await ruleCounts(rows.map((r) => r._id));
    const data = rows.map((r) => ({
      ...r,
      history: undefined,
      status: deriveCampaignStatus(r, now),
      activeRuleCount: counts.get(String(r._id)) || 0,
      country: countryLabel(r.countryCode),
    }));
    return ok(res, data, { pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 } });
  } catch (err) {
    return fail(res, 500, err.message);
  }
};

export const getCampaign = async (req, res) => {
  try {
    const loaded = await loadCampaign(req, res, req.params.id);
    if (!loaded) return;
    const { doc } = loaded;
    const [rules, blocks] = await Promise.all([
      CampaignDiscountRuleModel.find({ campaignId: doc._id, countryCode: doc.countryCode }).sort({ createdAt: 1 }).lean(),
      CampaignContentBlockModel.find({ campaignId: doc._id, countryCode: doc.countryCode }).sort({ order: 1, createdAt: 1 }).lean(),
    ]);
    const { conflicts, warnings } = doc.publishState === "PUBLISHED" ? await findOverlaps(doc) : { conflicts: [], warnings: [] };
    return ok(res, { campaign: { ...doc.toObject(), status: deriveCampaignStatus(doc), country: countryLabel(doc.countryCode) }, rules, blocks, conflicts, warnings });
  } catch (err) {
    return fail(res, 500, err.message);
  }
};

export const createCampaign = async (req, res) => {
  try {
    const scope = scopeOr403(req, res);
    if (!scope) return;

    const target = resolveCreateCountry(scope, req.body.countryCode);
    if (target.error) return fail(res, target.error.status, target.error.message);

    const { data, errors } = validateCampaignInput(req.body);
    if (errors.length) return fail(res, 400, errors[0], { errors });

    // Theme: start from the chosen preset (or the type's), then overlay validated overrides.
    const presetKey = data.theme?.preset || data.type;
    const mergedTheme = { ...(THEME_PRESETS[presetKey] || THEME_PRESETS.CUSTOM), ...(data.theme || {}) };
    const a11y = themeAccessibilityErrors(mergedTheme);
    if (a11y.length) return fail(res, 400, `Theme is not readable enough: ${a11y[0]}`, { errors: a11y });

    const timezone = data.timezone || getCountryByCode(target.countryCode)?.timezone || "Africa/Lagos";
    const doc = new CampaignModel({
      ...data,
      theme: mergedTheme,
      timezone,
      countryCode: target.countryCode,
      publishState: "DRAFT",
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
    pushHistory(doc, req, "CREATED");

    try {
      await doc.save();
    } catch (e) {
      if (e?.code === 11000) return fail(res, 409, "A campaign with this slug already exists in this country. Change the name or slug.");
      throw e;
    }
    audit(req, "CAMPAIGN_CREATE", `Created campaign "${doc.name}" (${doc.countryCode})`, doc);
    translateLater("campaign", doc);
    return ok(res, doc, { message: "Campaign created as a draft" });
  } catch (err) {
    return fail(res, 500, err.message);
  }
};

export const updateCampaign = async (req, res) => {
  try {
    const loaded = await loadCampaign(req, res, req.params.id);
    if (!loaded) return;
    const { doc } = loaded;
    if (blockedByDraftRule(req, res, doc)) return;
    if (doc.publishState === "ARCHIVED") return fail(res, 409, "Archived campaigns are read-only. Restore it first.");

    // Country can never be changed by an update — reject rather than ignore, so tampering is visible.
    if (req.body.countryCode !== undefined && String(req.body.countryCode).toUpperCase() !== doc.countryCode) {
      return fail(res, 403, "A campaign's country cannot be changed. Duplicate it into the other country instead.");
    }

    const { data, errors } = validateCampaignInput(req.body, { partial: true });
    if (errors.length) return fail(res, 400, errors[0], { errors });

    const before = { name: doc.name, startsAt: doc.startsAt, endsAt: doc.endsAt, priority: doc.priority };

    const { theme: themePatch, ...rest } = data;
    Object.assign(doc, rest);
    if (themePatch) {
      const merged = { ...doc.theme.toObject(), ...themePatch };
      const a11y = themeAccessibilityErrors(merged);
      if (a11y.length) return fail(res, 400, `Theme is not readable enough: ${a11y[0]}`, { errors: a11y });
      doc.theme = merged;
    }
    if (doc.endsAt <= doc.startsAt) return fail(res, 400, "endsAt must be after startsAt");

    // Editing a PUBLISHED campaign can create an overlap — re-check before saving.
    if (doc.publishState === "PUBLISHED") {
      const { conflicts } = await findOverlaps(doc);
      if (conflicts.length) {
        return fail(res, 409, `Schedule conflicts with "${conflicts[0].name}" (same priority, overlapping dates). Change the priority or dates.`, { conflicts });
      }
    }

    doc.updatedBy = req.user._id;
    pushHistory(doc, req, "UPDATED", "", {
      before,
      after: { name: doc.name, startsAt: doc.startsAt, endsAt: doc.endsAt, priority: doc.priority },
    });
    try {
      await doc.save();
    } catch (e) {
      if (e?.code === 11000) return fail(res, 409, "A campaign with this slug already exists in this country.");
      throw e;
    }
    afterMutation(doc.countryCode);
    audit(req, "CAMPAIGN_UPDATE", `Updated campaign "${doc.name}" (${doc.countryCode})`, doc);
    translateLater("campaign", doc);
    return ok(res, doc, { message: "Campaign updated" });
  } catch (err) {
    return fail(res, 500, err.message);
  }
};

export const duplicateCampaign = async (req, res) => {
  try {
    const loaded = await loadCampaign(req, res, req.params.id);
    if (!loaded) return;
    const { doc: src, scope } = loaded;

    // Duplicate into the same country by default; global admins may target another.
    const target = resolveCreateCountry(scope, req.body.countryCode || src.countryCode);
    if (target.error) return fail(res, target.error.status, target.error.message);

    const name = sanitizeText(req.body.name, 120) || `${src.name} (copy)`;
    const baseSlug = slugify(req.body.slug || name);
    let slug = baseSlug;
    for (let i = 2; await CampaignModel.exists({ countryCode: target.countryCode, slug }); i++) slug = `${baseSlug}-${i}`;

    // The copy is shifted so it does not overlap the original by default; admin sets real dates before publishing.
    const span = src.endsAt.getTime() - src.startsAt.getTime();
    const startsAt = req.body.startsAt ? new Date(req.body.startsAt) : new Date(src.endsAt.getTime() + 24 * 3600 * 1000);
    const endsAt = new Date(startsAt.getTime() + span);
    if (Number.isNaN(startsAt.getTime())) return fail(res, 400, "startsAt must be a valid date");

    const copy = new CampaignModel({
      name, slug, type: src.type, tagline: src.tagline, description: src.description,
      theme: src.theme.toObject(), startsAt, endsAt, priority: src.priority,
      timezone: getCountryByCode(target.countryCode)?.timezone || src.timezone,
      showCountdown: src.showCountdown, landingEnabled: src.landingEnabled,
      countryCode: target.countryCode, publishState: "DRAFT",
      createdBy: req.user._id, updatedBy: req.user._id,
    });
    pushHistory(copy, req, "DUPLICATED", `from ${src.name} (${src.countryCode})`);
    await copy.save();

    const sameCountry = target.countryCode === src.countryCode;
    // Targeting rules (product/category/brand ids) are only copied within a country; across countries they are cleared.
    const rules = await CampaignDiscountRuleModel.find({ campaignId: src._id, countryCode: src.countryCode }).lean();
    if (rules.length) {
      await CampaignDiscountRuleModel.insertMany(
        rules.map(({ _id, createdAt, updatedAt, __v, ...r }) => ({
          ...r,
          campaignId: copy._id,
          countryCode: target.countryCode,
          status: "DRAFT",
          ...(sameCountry ? {} : { scope: "ALL", productIds: [], categoryIds: [], brandIds: [] }),
          createdBy: req.user._id,
          updatedBy: req.user._id,
        })),
      );
    }
    const blocks = await CampaignContentBlockModel.find({ campaignId: src._id, countryCode: src.countryCode }).lean();
    if (blocks.length) {
      await CampaignContentBlockModel.insertMany(
        blocks.map(({ _id, createdAt, updatedAt, __v, ...b }) => ({
          ...b,
          campaignId: copy._id,
          countryCode: target.countryCode,
          ...(sameCountry ? {} : { productIds: [], categoryIds: [] }),
          createdBy: req.user._id,
          updatedBy: req.user._id,
        })),
      );
    }
    audit(req, "CAMPAIGN_CREATE", `Duplicated campaign "${src.name}" → "${copy.name}" (${copy.countryCode})`, copy);
    return ok(res, copy, { message: "Campaign duplicated as a draft. Rules were copied as DRAFT — review them before publishing." });
  } catch (err) {
    return fail(res, 500, err.message);
  }
};

// ── lifecycle ────────────────────────────────────────────────────────────────
async function transition(req, res, { action, activity, label, allowedFrom, apply, validate }) {
  const loaded = await loadCampaign(req, res, req.params.id);
  if (!loaded) return;
  const { doc } = loaded;

  if (!allowedFrom.includes(doc.publishState)) {
    return fail(res, 409, `Cannot ${label} a campaign that is ${doc.publishState}.`);
  }
  if (validate) {
    const problem = await validate(doc);
    if (problem) return fail(res, problem.status || 400, problem.message, problem.extra || {});
  }
  const before = { publishState: doc.publishState, status: deriveCampaignStatus(doc) };
  apply(doc);
  doc.updatedBy = req.user._id;
  pushHistory(doc, req, action, String(req.body?.note || "").slice(0, 300), { before, after: { publishState: doc.publishState } });
  await doc.save();
  afterMutation(doc.countryCode);
  audit(req, activity, `${label[0].toUpperCase()}${label.slice(1)} campaign "${doc.name}" (${doc.countryCode})`, doc);
  return ok(res, { ...doc.toObject(), status: deriveCampaignStatus(doc), country: countryLabel(doc.countryCode) }, { message: `Campaign ${label} OK` });
}

const publishValidate = async (doc) => {
  if (doc.endsAt.getTime() <= Date.now()) {
    return { status: 400, message: "This campaign's end date has already passed. Correct the dates before publishing." };
  }
  const a11y = themeAccessibilityErrors(doc.theme.toObject());
  if (a11y.length) return { status: 400, message: `Theme is not readable enough: ${a11y[0]}` };
  const { conflicts } = await findOverlaps(doc);
  if (conflicts.length) {
    return {
      status: 409,
      message: `Conflicts with "${conflicts[0].name}": same priority and overlapping dates. Give one a higher priority or move the dates.`,
      extra: { conflicts },
    };
  }
  return null;
};

export const publishCampaign = (req, res) =>
  transition(req, res, {
    action: "PUBLISHED", activity: "CAMPAIGN_PUBLISH", label: "published",
    allowedFrom: ["DRAFT"], validate: publishValidate,
    apply: (d) => { d.publishState = "PUBLISHED"; d.publishedAt = new Date(); d.pausedAt = null; },
  }).catch((e) => fail(res, 500, e.message));

export const pauseCampaign = (req, res) =>
  transition(req, res, {
    action: "PAUSED", activity: "CAMPAIGN_PAUSE", label: "paused", allowedFrom: ["PUBLISHED"],
    apply: (d) => { d.publishState = "PAUSED"; d.pausedAt = new Date(); },
  }).catch((e) => fail(res, 500, e.message));

export const resumeCampaign = (req, res) =>
  transition(req, res, {
    action: "RESUMED", activity: "CAMPAIGN_RESUME", label: "resumed", allowedFrom: ["PAUSED"],
    validate: publishValidate,
    apply: (d) => { d.publishState = "PUBLISHED"; d.pausedAt = null; },
  }).catch((e) => fail(res, 500, e.message));

export const endCampaign = (req, res) =>
  transition(req, res, {
    action: "ENDED", activity: "CAMPAIGN_END", label: "ended", allowedFrom: ["PUBLISHED", "PAUSED"],
    apply: (d) => {
      const now = new Date();
      if (d.publishState === "PUBLISHED" && now.getTime() >= d.startsAt.getTime()) {
        d.endsAt = now; // live → ends right now, kept PUBLISHED so it reads ENDED in reports
      } else {
        d.publishState = "DRAFT"; // never went live → just un-publish
        d.publishedAt = null;
      }
    },
  }).catch((e) => fail(res, 500, e.message));

export const archiveCampaign = (req, res) =>
  transition(req, res, {
    action: "ARCHIVED", activity: "CAMPAIGN_ARCHIVE", label: "archived",
    allowedFrom: ["DRAFT", "PUBLISHED", "PAUSED"],
    apply: (d) => { d.publishState = "ARCHIVED"; d.archivedAt = new Date(); },
  }).catch((e) => fail(res, 500, e.message));

export const restoreCampaign = (req, res) =>
  transition(req, res, {
    action: "RESTORED", activity: "CAMPAIGN_UPDATE", label: "restored", allowedFrom: ["ARCHIVED"],
    apply: (d) => { d.publishState = "DRAFT"; d.archivedAt = null; },
  }).catch((e) => fail(res, 500, e.message));

export const deleteCampaign = async (req, res) => {
  try {
    const loaded = await loadCampaign(req, res, req.params.id);
    if (!loaded) return;
    const { doc } = loaded;
    if (blockedByDraftRule(req, res, doc)) return;

    // A campaign that was ever published, or that touched any order, is business
    // history — archive it, never destroy it.
    const usedByOrders = await OrderModel.exists({ "campaignSnapshot.campaignId": String(doc._id) });
    if (doc.publishedAt || doc.publishState !== "DRAFT" || usedByOrders) {
      return fail(res, 409, "This campaign has been published or used by orders and cannot be deleted. Archive it instead.");
    }
    await Promise.all([
      CampaignDiscountRuleModel.deleteMany({ campaignId: doc._id, countryCode: doc.countryCode }),
      CampaignContentBlockModel.deleteMany({ campaignId: doc._id, countryCode: doc.countryCode }),
      CampaignModel.deleteOne({ _id: doc._id }),
    ]);
    afterMutation(doc.countryCode);
    audit(req, "CAMPAIGN_DELETE", `Deleted draft campaign "${doc.name}" (${doc.countryCode})`, doc);
    return ok(res, { _id: doc._id }, { message: "Draft campaign deleted" });
  } catch (err) {
    return fail(res, 500, err.message);
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — discount rules
// ═════════════════════════════════════════════════════════════════════════════
/** Targets must exist, and products must be sellable in the campaign's country. */
async function validateRuleTargets(country, data) {
  if (data.productIds?.length) {
    const found = await ProductModel.find({
      _id: { $in: data.productIds },
      $or: [{ visibleInCountries: { $size: 0 } }, { visibleInCountries: { $exists: false } }, { visibleInCountries: country }],
    }).select("btcPrice price").lean();
    if (found.length !== data.productIds.length) return "Some selected products do not exist or are not available in this country";
    if (data.discountType === "FIXED_AMOUNT" && data.discountValue !== undefined) {
      const tooCheap = found.find((p) => (p.btcPrice || p.price || 0) <= data.discountValue);
      if (tooCheap) return "A fixed discount cannot be equal to or greater than a selected product's price";
    }
  }
  if (data.categoryIds?.length && (await CategoryModel.countDocuments({ _id: { $in: data.categoryIds } })) !== data.categoryIds.length) {
    return "Some selected categories do not exist";
  }
  if (data.brandIds?.length && (await BrandModel.countDocuments({ _id: { $in: data.brandIds } })) !== data.brandIds.length) {
    return "Some selected brands do not exist";
  }
  return null;
}

export const createRule = async (req, res) => {
  try {
    const loaded = await loadCampaign(req, res, req.params.id);
    if (!loaded) return;
    const { doc: campaign } = loaded;
    if (blockedByDraftRule(req, res, campaign)) return;
    if (campaign.publishState === "ARCHIVED") return fail(res, 409, "Archived campaigns are read-only.");

    const { data, errors } = validateRuleInput(req.body);
    if (errors.length) return fail(res, 400, errors[0], { errors });
    const targetErr = await validateRuleTargets(campaign.countryCode, data);
    if (targetErr) return fail(res, 400, targetErr);

    const rule = await CampaignDiscountRuleModel.create({
      ...data,
      status: data.status || "ACTIVE",
      campaignId: campaign._id,
      countryCode: campaign.countryCode, // always inherited — never taken from the request
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
    pushHistory(campaign, req, "RULE_ADDED", rule.name);
    await campaign.save();
    afterMutation(campaign.countryCode);
    audit(req, "CAMPAIGN_RULE_CHANGE", `Added discount rule "${rule.name}" to "${campaign.name}"`, campaign);
    translateLater("campaignRule", rule);
    return ok(res, rule, { message: "Discount rule added" });
  } catch (err) {
    return fail(res, 500, err.message);
  }
};

async function loadRule(req, res) {
  if (!isId(req.params.ruleId)) { fail(res, 404, "Rule not found"); return null; }
  const scope = scopeOr403(req, res);
  if (!scope) return null;
  const rule = await CampaignDiscountRuleModel.findOne({ _id: req.params.ruleId, ...campaignCountryFilter(scope) });
  if (!rule) { fail(res, 404, "Rule not found"); return null; }
  const campaign = await CampaignModel.findOne({ _id: rule.campaignId, countryCode: rule.countryCode });
  if (!campaign) { fail(res, 404, "Rule not found"); return null; }
  return { rule, campaign };
}

export const updateRule = async (req, res) => {
  try {
    const loaded = await loadRule(req, res);
    if (!loaded) return;
    const { rule, campaign } = loaded;
    if (blockedByDraftRule(req, res, campaign)) return;
    if (campaign.publishState === "ARCHIVED") return fail(res, 409, "Archived campaigns are read-only.");

    if (req.body.countryCode !== undefined && String(req.body.countryCode).toUpperCase() !== rule.countryCode) {
      return fail(res, 403, "A rule's country cannot be changed.");
    }
    if (req.body.campaignId !== undefined && String(req.body.campaignId) !== String(rule.campaignId)) {
      return fail(res, 403, "A rule cannot be moved to another campaign.");
    }

    const { data, errors } = validateRuleInput({ ...rule.toObject(), ...req.body }, { partial: false });
    if (errors.length) return fail(res, 400, errors[0], { errors });
    const targetErr = await validateRuleTargets(rule.countryCode, data);
    if (targetErr) return fail(res, 400, targetErr);

    Object.assign(rule, data, { updatedBy: req.user._id });
    await rule.save();
    pushHistory(campaign, req, "RULE_UPDATED", rule.name);
    await campaign.save();
    afterMutation(rule.countryCode);
    audit(req, "CAMPAIGN_RULE_CHANGE", `Updated discount rule "${rule.name}" on "${campaign.name}"`, campaign);
    translateLater("campaignRule", rule);
    return ok(res, rule, { message: "Discount rule updated" });
  } catch (err) {
    return fail(res, 500, err.message);
  }
};

export const setRuleStatus = (status) => async (req, res) => {
  try {
    const loaded = await loadRule(req, res);
    if (!loaded) return;
    const { rule, campaign } = loaded;
    if (blockedByDraftRule(req, res, campaign)) return;
    rule.status = status;
    rule.updatedBy = req.user._id;
    await rule.save();
    pushHistory(campaign, req, status === "PAUSED" ? "RULE_PAUSED" : "RULE_ACTIVATED", rule.name);
    await campaign.save();
    afterMutation(rule.countryCode);
    audit(req, "CAMPAIGN_RULE_CHANGE", `${status === "PAUSED" ? "Paused" : "Activated"} discount rule "${rule.name}" on "${campaign.name}"`, campaign);
    return ok(res, rule);
  } catch (err) {
    return fail(res, 500, err.message);
  }
};

export const deleteRule = async (req, res) => {
  try {
    const loaded = await loadRule(req, res);
    if (!loaded) return;
    const { rule, campaign } = loaded;
    if (blockedByDraftRule(req, res, campaign)) return;
    // Orders keep their own immutable snapshot of the rule, so removing it never rewrites history.
    await CampaignDiscountRuleModel.deleteOne({ _id: rule._id });
    pushHistory(campaign, req, "RULE_REMOVED", rule.name);
    await campaign.save();
    afterMutation(rule.countryCode);
    audit(req, "CAMPAIGN_RULE_CHANGE", `Removed discount rule "${rule.name}" from "${campaign.name}"`, campaign);
    return ok(res, { _id: rule._id }, { message: "Discount rule removed" });
  } catch (err) {
    return fail(res, 500, err.message);
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — content blocks
// ═════════════════════════════════════════════════════════════════════════════
export const createBlock = async (req, res) => {
  try {
    const loaded = await loadCampaign(req, res, req.params.id);
    if (!loaded) return;
    const { doc: campaign } = loaded;
    if (blockedByDraftRule(req, res, campaign)) return;
    if (campaign.publishState === "ARCHIVED") return fail(res, 409, "Archived campaigns are read-only.");

    const { data, errors } = validateBlockInput(req.body);
    if (errors.length) return fail(res, 400, errors[0], { errors });
    if (data.order === undefined) {
      data.order = await CampaignContentBlockModel.countDocuments({ campaignId: campaign._id, countryCode: campaign.countryCode });
    }
    const block = await CampaignContentBlockModel.create({
      ...data,
      campaignId: campaign._id,
      countryCode: campaign.countryCode,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
    pushHistory(campaign, req, "BLOCK_ADDED", `${block.type}`);
    await campaign.save();
    afterMutation(campaign.countryCode);
    audit(req, "CAMPAIGN_BLOCK_CHANGE", `Added ${block.type} block to "${campaign.name}"`, campaign);
    translateLater("campaignBlock", block);
    return ok(res, block, { message: "Content block added" });
  } catch (err) {
    return fail(res, 500, err.message);
  }
};

async function loadBlock(req, res) {
  if (!isId(req.params.blockId)) { fail(res, 404, "Block not found"); return null; }
  const scope = scopeOr403(req, res);
  if (!scope) return null;
  const block = await CampaignContentBlockModel.findOne({ _id: req.params.blockId, ...campaignCountryFilter(scope) });
  if (!block) { fail(res, 404, "Block not found"); return null; }
  const campaign = await CampaignModel.findOne({ _id: block.campaignId, countryCode: block.countryCode });
  if (!campaign) { fail(res, 404, "Block not found"); return null; }
  return { block, campaign };
}

export const updateBlock = async (req, res) => {
  try {
    const loaded = await loadBlock(req, res);
    if (!loaded) return;
    const { block, campaign } = loaded;
    if (blockedByDraftRule(req, res, campaign)) return;
    if (req.body.countryCode !== undefined && String(req.body.countryCode).toUpperCase() !== block.countryCode) {
      return fail(res, 403, "A block's country cannot be changed.");
    }
    const { data, errors } = validateBlockInput(req.body, { partial: true });
    if (errors.length) return fail(res, 400, errors[0], { errors });
    Object.assign(block, data, { updatedBy: req.user._id });
    await block.save();
    pushHistory(campaign, req, "BLOCK_UPDATED", `${block.type}`);
    await campaign.save();
    afterMutation(block.countryCode);
    audit(req, "CAMPAIGN_BLOCK_CHANGE", `Updated ${block.type} block on "${campaign.name}"`, campaign);
    translateLater("campaignBlock", block);
    return ok(res, block, { message: "Content block updated" });
  } catch (err) {
    return fail(res, 500, err.message);
  }
};

export const deleteBlock = async (req, res) => {
  try {
    const loaded = await loadBlock(req, res);
    if (!loaded) return;
    const { block, campaign } = loaded;
    if (blockedByDraftRule(req, res, campaign)) return;
    await CampaignContentBlockModel.deleteOne({ _id: block._id });
    pushHistory(campaign, req, "BLOCK_REMOVED", `${block.type}`);
    await campaign.save();
    afterMutation(block.countryCode);
    audit(req, "CAMPAIGN_BLOCK_CHANGE", `Removed ${block.type} block from "${campaign.name}"`, campaign);
    return ok(res, { _id: block._id }, { message: "Content block removed" });
  } catch (err) {
    return fail(res, 500, err.message);
  }
};

export const reorderBlocks = async (req, res) => {
  try {
    const loaded = await loadCampaign(req, res, req.params.id);
    if (!loaded) return;
    const { doc: campaign } = loaded;
    if (blockedByDraftRule(req, res, campaign)) return;
    const ids = Array.isArray(req.body.order) ? req.body.order.map(String) : [];
    if (!ids.every(isId)) return fail(res, 400, "order must be a list of block ids");
    await Promise.all(
      ids.map((id, i) =>
        CampaignContentBlockModel.updateOne({ _id: id, campaignId: campaign._id, countryCode: campaign.countryCode }, { $set: { order: i } }),
      ),
    );
    afterMutation(campaign.countryCode);
    return ok(res, { order: ids });
  } catch (err) {
    return fail(res, 500, err.message);
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — selectors (country-scoped product / category / brand pickers)
// ═════════════════════════════════════════════════════════════════════════════
export const campaignSelector = async (req, res) => {
  try {
    const scope = scopeOr403(req, res);
    if (!scope) return;
    const country = scope.isGlobal ? normalizeCountry(req.query.countryCode) || "NG" : scope.countryCode;
    const q = String(req.query.q || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = q ? { $regex: q, $options: "i" } : null;
    const kind = req.params.kind;

    if (kind === "products") {
      const filter = {
        publish: { $ne: "ARCHIVED" },
        $or: [{ visibleInCountries: { $size: 0 } }, { visibleInCountries: { $exists: false } }, { visibleInCountries: country }],
      };
      if (rx) filter.$and = [{ $or: [{ name: rx }, { sku: rx }] }];
      const rows = await ProductModel.find(filter).select("name sku image btcPrice price category brand").sort({ name: 1 }).limit(25).lean();
      return ok(res, rows.map((p) => ({ _id: p._id, name: p.name, sku: p.sku, image: p.image?.[0] || "", price: p.btcPrice || p.price || 0 })));
    }
    if (kind === "categories") {
      const rows = await CategoryModel.find(rx ? { name: rx } : {}).select("name").sort({ name: 1 }).limit(50).lean();
      return ok(res, rows);
    }
    if (kind === "brands") {
      const rows = await BrandModel.find(rx ? { name: rx } : {}).select("name").sort({ name: 1 }).limit(50).lean();
      return ok(res, rows);
    }
    return fail(res, 404, "Unknown selector");
  } catch (err) {
    return fail(res, 500, err.message);
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — preview + performance
// ═════════════════════════════════════════════════════════════════════════════
/**
 * Preview = exactly the payload the storefront would receive if this campaign
 * were live, built from the saved draft. Read-only: it never writes, never
 * touches the pricing cache, and its prices are computed in-memory only, so it
 * cannot affect the live storefront or checkout.
 */
export const previewCampaign = async (req, res) => {
  try {
    const loaded = await loadCampaign(req, res, req.params.id);
    if (!loaded) return;
    const { doc } = loaded;
    const language = String(req.query.language || "en").toLowerCase();
    const payload = await buildPublicPayload(doc.toObject(), { language, forceLive: true });
    return ok(res, { preview: true, ...payload });
  } catch (err) {
    return fail(res, 500, err.message);
  }
};

export const campaignPerformance = async (req, res) => {
  try {
    const loaded = await loadCampaign(req, res, req.params.id);
    if (!loaded) return;
    const { doc } = loaded;
    // Streamed + reduced in JS (not $group/$multiply): portable across Mongo-compatible
    // engines and still O(lines) memory-light because only 2 small fields are read.
    const byRuleMap = new Map();
    const totals = { orderLines: 0, units: 0, discountGiven: 0, revenue: 0 };
    const cursor = OrderModel.find({ "campaignSnapshot.campaignId": doc._id, countryCode: doc.countryCode })
      .select("quantity campaignSnapshot.ruleId campaignSnapshot.discountPerUnit campaignSnapshot.finalUnitPrice")
      .lean()
      .cursor();
    for await (const line of cursor) {
      const qty = Number(line.quantity) || 0;
      const key = String(line.campaignSnapshot?.ruleId || "");
      const row = byRuleMap.get(key) || { _id: key, orderLines: 0, units: 0, discountGiven: 0, revenue: 0 };
      const given = qty * (Number(line.campaignSnapshot?.discountPerUnit) || 0);
      const rev = qty * (Number(line.campaignSnapshot?.finalUnitPrice) || 0);
      row.orderLines += 1; row.units += qty; row.discountGiven += given; row.revenue += rev;
      totals.orderLines += 1; totals.units += qty; totals.discountGiven += given; totals.revenue += rev;
      byRuleMap.set(key, row);
    }
    const rows = [...byRuleMap.values()];
    // Rule names come from the rules themselves (not the aggregation) — keeps the
    // pipeline to $sum only, and shows the CURRENT name; the order snapshots keep the historical one.
    const rules = await CampaignDiscountRuleModel.find({ campaignId: doc._id }).select("name").lean();
    const nameById = new Map(rules.map((r) => [String(r._id), r.name]));
    return ok(res, { currency: "NGN", totals, byRule: rows.map((r) => ({ ruleId: r._id, ruleName: nameById.get(String(r._id)) || "", orderLines: r.orderLines, units: r.units, discountGiven: r.discountGiven, revenue: r.revenue })) });
  } catch (err) {
    return fail(res, 500, err.message);
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC — storefront + mobile
// ═════════════════════════════════════════════════════════════════════════════
const effectiveEffect = (theme) => (theme?.effectEnabled ? theme.effect || "NONE" : "NONE");

/** Shape one campaign for customers. `forceLive` is used only by the admin preview. */
async function buildPublicPayload(campaign, { language = "en", forceLive = false } = {}) {
  const now = new Date();
  const [blocksRaw, rulesRaw] = await Promise.all([
    CampaignContentBlockModel.find({ campaignId: campaign._id, countryCode: campaign.countryCode, isVisible: true }).sort({ order: 1, createdAt: 1 }).lean(),
    CampaignDiscountRuleModel.find({ campaignId: campaign._id, countryCode: campaign.countryCode, status: "ACTIVE" }).lean(),
  ]);
  const inWin = (b) => (!b.startsAt || now >= new Date(b.startsAt)) && (!b.endsAt || now <= new Date(b.endsAt));
  let blocks = forceLive ? blocksRaw : blocksRaw.filter(inWin);

  const [loc, locBlocks, locRules] = await Promise.all([
    localizeOne("campaign", campaign, language),
    localizeList("campaignBlock", blocks, language),
    localizeList("campaignRule", rulesRaw, language),
  ]);
  blocks = locBlocks;

  // Resolve featured products (priced by the authoritative engine) and categories.
  const visibility = await buildClientVisibilityFilter();
  const allIds = [...new Set(blocks.flatMap((b) => (b.productIds || []).map(String)))];
  let products = [];
  if (allIds.length) {
    products = await ProductModel.find({ ...visibility, _id: { $in: allIds } })
      .populate("brand", "name")
      .populate("category", "name slug")
      .lean();
  }
  const priced = await decorateProductsWithCampaignPricing(products, campaign.countryCode, { now, extraCampaigns: forceLive ? [campaign] : [], extraRules: forceLive ? rulesRaw : [] });
  const byId = new Map(priced.map((p) => [String(p._id), p]));

  const catIds = [...new Set(blocks.flatMap((b) => (b.categoryIds || []).map(String)))];
  const categories = catIds.length ? await CategoryModel.find({ _id: { $in: catIds } }).select("name slug image").lean() : [];
  const catById = new Map(categories.map((c) => [String(c._id), c]));

  const pct = rulesRaw.filter((r) => r.discountType === "PERCENTAGE").map((r) => r.discountValue);

  return {
    serverTime: now.toISOString(),
    campaign: {
      id: String(campaign._id),
      name: loc.name,
      slug: campaign.slug,
      type: campaign.type,
      tagline: loc.tagline || "",
      description: loc.description || "",
      countryCode: campaign.countryCode,
      status: forceLive ? deriveCampaignStatus(campaign, now) : "ACTIVE",
      startsAt: new Date(campaign.startsAt).toISOString(),
      endsAt: new Date(campaign.endsAt).toISOString(),
      timezone: campaign.timezone,
      showCountdown: !!campaign.showCountdown,
      landingEnabled: campaign.landingEnabled !== false,
      priority: campaign.priority,
      theme: { ...campaign.theme, effect: effectiveEffect(campaign.theme) },
      maxPercentage: pct.length ? Math.max(...pct) : 0,
      discounts: locRules.map((r) => ({ ruleId: String(r._id), label: r.label || "", discountType: r.discountType, discountValue: r.discountValue, scope: r.scope })),
      blocks: blocks.map((b) => ({
        id: String(b._id),
        type: b.type,
        order: b.order,
        heading: b.heading,
        subtitle: b.subtitle,
        ctaLabel: b.ctaLabel,
        ctaUrl: b.ctaUrl,
        image: b.image,
        mobileImage: b.mobileImage,
        imageWidth: b.imageWidth,
        imageHeight: b.imageHeight,
        products: (b.productIds || []).map((id) => byId.get(String(id))).filter(Boolean),
        categories: (b.categoryIds || []).map((id) => catById.get(String(id))).filter(Boolean),
      })),
    },
  };
}

/** The campaign whose theme the storefront wears: highest priority, then latest start, then id. */
function pickPrimary(list) {
  return [...list].sort((a, b) =>
    (b.priority || 0) - (a.priority || 0) ||
    new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime() ||
    String(a._id).localeCompare(String(b._id)),
  )[0];
}

const languageOf = (req) =>
  String(req.headers["x-language"] || req.query.language || req.country?.language?.default || "en").toLowerCase();

/**
 * GET /api/campaign/active
 * Country comes from the storefront domain / X-Storefront-Host (web) or
 * X-App-Country (mobile) via countryDetect — NEVER from a client-supplied body.
 * Always answers 200: no campaign → { campaign: null }, so an outage or an empty
 * state both render the ordinary storefront.
 */
export const getActiveCampaign = async (req, res) => {
  try {
    res.set("Cache-Control", "no-cache");
    const countryCode = req.countryCode || "NG";
    const ctx = await getCampaignContext(countryCode);
    const primary = pickPrimary(ctx.campaignList);
    if (!primary) return ok(res, { serverTime: new Date().toISOString(), countryCode, campaign: null, others: [] });
    const payload = await buildPublicPayload(primary, { language: languageOf(req) });
    return ok(res, {
      ...payload,
      countryCode,
      others: ctx.campaignList
        .filter((c) => String(c._id) !== String(primary._id))
        .map((c) => ({ id: String(c._id), name: c.name, slug: c.slug, type: c.type, endsAt: new Date(c.endsAt).toISOString() })),
    });
  } catch (err) {
    // Degrade silently to "no campaign" — never break browsing over a cosmetic feature.
    console.error("[campaign] getActiveCampaign:", err.message);
    return ok(res, { serverTime: new Date().toISOString(), campaign: null, others: [] });
  }
};

/** GET /api/campaign/public/:slug — landing page payload. 404 unless the campaign is live in THIS storefront's country. */
export const getPublicCampaignBySlug = async (req, res) => {
  try {
    res.set("Cache-Control", "no-cache");
    const countryCode = req.countryCode || "NG";
    const ctx = await getCampaignContext(countryCode);
    const slug = String(req.params.slug || "").toLowerCase();
    const campaign = ctx.campaignList.find((c) => c.slug === slug);
    if (!campaign || campaign.landingEnabled === false) return fail(res, 404, "Campaign not found");
    return ok(res, await buildPublicPayload(campaign, { language: languageOf(req) }));
  } catch (err) {
    return fail(res, 500, err.message);
  }
};

/** GET /api/campaign/public/:slug/products — the discounted product grid for a landing page. */
export const getPublicCampaignProducts = async (req, res) => {
  try {
    res.set("Cache-Control", "no-cache");
    const countryCode = req.countryCode || "NG";
    const ctx = await getCampaignContext(countryCode);
    const slug = String(req.params.slug || "").toLowerCase();
    const campaign = ctx.campaignList.find((c) => c.slug === slug);
    if (!campaign) return fail(res, 404, "Campaign not found");

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(48, Math.max(1, parseInt(req.query.limit) || 24));
    const rules = ctx.rules.filter((r) => String(r.campaignId) === String(campaign._id));

    const or = [];
    let all = false;
    for (const r of rules) {
      if (r.scope === "ALL") all = true;
      if (r.scope === "PRODUCT" && r.productIds?.length) or.push({ _id: { $in: r.productIds } });
      if (r.scope === "CATEGORY" && r.categoryIds?.length) or.push({ category: { $in: r.categoryIds } }, { subCategory: { $in: r.categoryIds } });
      if (r.scope === "BRAND" && r.brandIds?.length) or.push({ brand: { $in: r.brandIds } });
    }
    if (!all && or.length === 0) return ok(res, [], { pagination: { page, limit, total: 0, pages: 1 } });

    const filter = { $and: [await buildClientVisibilityFilter(), ...(all ? [] : [{ $or: or }])] };
    const [rows, total] = await Promise.all([
      ProductModel.find(filter).populate("brand", "name").populate("category", "name slug").sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      ProductModel.countDocuments(filter),
    ]);
    const priced = await decorateProductsWithCampaignPricing(rows, countryCode);
    return ok(res, priced, { pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 } });
  } catch (err) {
    return fail(res, 500, err.message);
  }
};
