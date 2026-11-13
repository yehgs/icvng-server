// server/utils/campaignValidation.js
//
// Backend validation + sanitising for campaigns, themes, discount rules and
// content blocks. Everything an editor submits passes through here; the UI's
// own checks are a convenience, not a boundary.
//
// Hard rules: no HTML, no CSS, no script in any text; URLs are either a safe
// internal route ("/shop") or validated HTTPS; theme values come from closed
// sets (hex colours, enums); numbers are bounded.

import mongoose from "mongoose";
import {
  CAMPAIGN_TYPES,
  THEME_EFFECTS,
  THEME_FONTS,
  HEX_COLOR,
} from "../models/campaign.model.js";
import { DISCOUNT_TYPES, RULE_SCOPES, RULE_STATUSES, MAX_PERCENTAGE, MAX_FIXED_AMOUNT } from "../models/campaign-discount-rule.model.js";
import { BLOCK_TYPES } from "../models/campaign-content-block.model.js";
import { checkThemeContrast } from "./campaignTheme.js";

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Plain text only: strip tags and control characters, collapse whitespace. */
export function sanitizeText(value, max = 500) {
  if (value === undefined || value === null) return "";
  return String(value)
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    .replace(CONTROL_CHARS, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Internal route ("/gift-card") or HTTPS URL without credentials. Rejects javascript:, data:, //host, etc. */
export function isSafeLink(url) {
  if (typeof url !== "string") return false;
  const u = url.trim();
  if (!u) return false;
  if (u.startsWith("/")) {
    return !u.startsWith("//") && !u.includes("\\") && !/[\s\u0000-\u001F<>"]/.test(u);
  }
  try {
    const parsed = new URL(u);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && !/[\s<>"]/.test(u);
  } catch {
    return false;
  }
}
/** Same as links; images may additionally be left empty. */
export const isSafeImage = (url) => isSafeLink(url);

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v) && String(new mongoose.Types.ObjectId(v)) === String(v);
const idList = (arr, max = 200) =>
  Array.isArray(arr) ? [...new Set(arr.map(String).filter(isObjectId))].slice(0, max) : [];

const asDate = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};
const isIana = (tz) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const slugify = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);

/** Validate + sanitise a theme. Returns { theme, errors }. Partial-friendly: only provided keys are returned. */
export function validateTheme(input = {}, { requireAccessible = true } = {}) {
  const errors = [];
  const theme = {};
  const colorKeys = [
    "primaryColor", "secondaryColor", "accentColor", "backgroundColor", "surfaceColor",
    "textColor", "mutedTextColor", "badgeBackground", "badgeText",
  ];
  for (const k of colorKeys) {
    if (input[k] === undefined) continue;
    if (!HEX_COLOR.test(String(input[k]))) errors.push(`${k} must be a #RRGGBB hex colour`);
    else theme[k] = String(input[k]).toUpperCase();
  }
  if (input.preset !== undefined) {
    if (!CAMPAIGN_TYPES.includes(input.preset)) errors.push("Unknown theme preset");
    else theme.preset = input.preset;
  }
  if (input.fontFamily !== undefined) {
    if (!THEME_FONTS.includes(input.fontFamily)) errors.push(`fontFamily must be one of ${THEME_FONTS.join(", ")}`);
    else theme.fontFamily = input.fontFamily;
  }
  if (input.effect !== undefined) {
    if (!THEME_EFFECTS.includes(input.effect)) errors.push(`effect must be one of ${THEME_EFFECTS.join(", ")}`);
    else theme.effect = input.effect;
  }
  if (input.effectEnabled !== undefined) theme.effectEnabled = input.effectEnabled === true;
  if (input.effectIntensity !== undefined) {
    const n = Number(input.effectIntensity);
    if (!Number.isInteger(n) || n < 1 || n > 10) errors.push("effectIntensity must be a whole number from 1 to 10");
    else theme.effectIntensity = n;
  }
  for (const k of ["bannerImage", "mobileBannerImage"]) {
    if (input[k] === undefined) continue;
    const v = String(input[k] || "").trim();
    if (v && !isSafeImage(v)) errors.push(`${k} must be an https URL or an internal path`);
    else theme[k] = v;
  }
  return { theme, errors };
}

/** Full theme (merged over defaults/existing) accessibility gate. */
export function themeAccessibilityErrors(fullTheme) {
  return checkThemeContrast(fullTheme);
}

/**
 * Validate campaign fields. `partial` = update (only validate what is present).
 * @returns {{ data:object, errors:string[] }}
 */
export function validateCampaignInput(body = {}, { partial = false } = {}) {
  const errors = [];
  const data = {};

  if (!partial || body.name !== undefined) {
    const name = sanitizeText(body.name, 120);
    if (!name) errors.push("name is required");
    else data.name = name;
  }
  if (body.slug !== undefined || (!partial && data.name)) {
    const slug = slugify(body.slug || data.name);
    if (!slug) errors.push("slug could not be derived from name");
    else data.slug = slug;
  }
  if (body.type !== undefined || !partial) {
    const type = body.type || "CUSTOM";
    if (!CAMPAIGN_TYPES.includes(type)) errors.push(`type must be one of ${CAMPAIGN_TYPES.join(", ")}`);
    else data.type = type;
  }
  if (body.tagline !== undefined) data.tagline = sanitizeText(body.tagline, 200);
  if (body.description !== undefined) data.description = sanitizeText(body.description, 2000);
  if (body.priority !== undefined) {
    const p = Number(body.priority);
    if (!Number.isInteger(p) || p < 0 || p > 1000) errors.push("priority must be a whole number from 0 to 1000");
    else data.priority = p;
  }
  if (body.showCountdown !== undefined) data.showCountdown = body.showCountdown === true;
  if (body.landingEnabled !== undefined) data.landingEnabled = body.landingEnabled === true;
  if (body.timezone !== undefined) {
    if (!isIana(String(body.timezone))) errors.push("timezone must be a valid IANA time zone");
    else data.timezone = String(body.timezone);
  }

  const wantsDates = !partial || body.startsAt !== undefined || body.endsAt !== undefined;
  if (wantsDates) {
    const s = body.startsAt !== undefined ? asDate(body.startsAt) : undefined;
    const e = body.endsAt !== undefined ? asDate(body.endsAt) : undefined;
    if (!partial || body.startsAt !== undefined) {
      if (!s) errors.push("startsAt is required and must be a valid date");
      else data.startsAt = s;
    }
    if (!partial || body.endsAt !== undefined) {
      if (!e) errors.push("endsAt is required and must be a valid date");
      else data.endsAt = e;
    }
    if (data.startsAt && data.endsAt && data.endsAt.getTime() <= data.startsAt.getTime()) {
      errors.push("endsAt must be after startsAt");
    }
  }

  if (body.theme !== undefined) {
    const { theme, errors: te } = validateTheme(body.theme);
    errors.push(...te);
    data.theme = theme;
  }
  return { data, errors };
}

/** Validate one price's discount (type/value/optional cap) into `out`; pushes human-readable errors. */
function checkSpec(label, input, out, errors) {
  if (!DISCOUNT_TYPES.includes(input.discountType)) { errors.push(`${label}: discount type must be one of ${DISCOUNT_TYPES.join(", ")}`); return; }
  const v = Number(input.discountValue);
  if (!Number.isFinite(v) || v <= 0) { errors.push(`${label}: discount value must be a number greater than 0`); return; }
  out.discountType = input.discountType;
  out.discountValue = v;
  if (input.discountType === "PERCENTAGE") {
    if (v > MAX_PERCENTAGE) errors.push(`${label}: percentage cannot exceed ${MAX_PERCENTAGE}%`);
    if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) errors.push(`${label}: percentage can have at most 2 decimal places`);
  } else if (v > MAX_FIXED_AMOUNT) errors.push(`${label}: fixed discount is too large`);
  if (input.maxDiscountAmount !== undefined && "maxDiscountAmount" in input) {
    if (input.maxDiscountAmount === null || input.maxDiscountAmount === "") out.maxDiscountAmount = null;
    else {
      const m = Number(input.maxDiscountAmount);
      if (!Number.isFinite(m) || m <= 0) errors.push(`${label}: maximum discount must be greater than 0 (or empty for no cap)`);
      else out.maxDiscountAmount = m;
    }
  }
}

/** Validate a discount rule. `product prices` are checked by the controller (needs DB). */
export function validateRuleInput(body = {}, { partial = false } = {}) {
  const errors = [];
  const data = {};

  if (!partial || body.name !== undefined) {
    const name = sanitizeText(body.name, 120);
    if (!name) errors.push("name is required");
    else data.name = name;
  }
  if (body.label !== undefined) data.label = sanitizeText(body.label, 40);

  // Regular (in-stock) price discount — can be switched off for rules that only target delivery prices.
  if (body.applyToRegular !== undefined) data.applyToRegular = body.applyToRegular !== false;
  const regularOn = data.applyToRegular !== false;
  if (regularOn) {
    if (!partial || body.discountType !== undefined || body.discountValue !== undefined) {
      checkSpec("regular price", { discountType: body.discountType, discountValue: body.discountValue }, data, errors);
    }
  }
  if (body.deliveryDiscounts !== undefined) {
    const dd = body.deliveryDiscounts || {};
    data.deliveryDiscounts = {};
    for (const [key, label] of [["threeWeeks", "3-week delivery price"], ["fiveWeeks", "5-week delivery price"]]) {
      const c = dd[key] || {};
      const cfg = { enabled: c.enabled === true, discountType: "PERCENTAGE", discountValue: 0, maxDiscountAmount: null };
      if (cfg.enabled) {
        const tmp = {};
        checkSpec(label, { discountType: c.discountType, discountValue: c.discountValue, maxDiscountAmount: c.maxDiscountAmount }, tmp, errors);
        Object.assign(cfg, tmp);
      }
      data.deliveryDiscounts[key] = cfg;
    }
    data.includeSpecialOrder = false; // explicit per-price settings replace the legacy switch
  }
  if (!partial || body.deliveryDiscounts !== undefined) {
    const anyDelivery = Object.values(data.deliveryDiscounts || {}).some((c) => c.enabled);
    if (!regularOn && !anyDelivery) errors.push("Turn on a discount for at least one price (regular, 3-week or 5-week)");
  }

  if (!partial || body.scope !== undefined) {
    const scope = body.scope || "ALL";
    if (!RULE_SCOPES.includes(scope)) errors.push(`scope must be one of ${RULE_SCOPES.join(", ")}`);
    else data.scope = scope;
  }
  if (body.productIds !== undefined) data.productIds = idList(body.productIds);
  if (body.categoryIds !== undefined) data.categoryIds = idList(body.categoryIds);
  if (body.brandIds !== undefined) data.brandIds = idList(body.brandIds);

  if (body.minQuantity !== undefined) {
    const q = Number(body.minQuantity);
    if (!Number.isInteger(q) || q < 1 || q > 10000) errors.push("minQuantity must be a whole number ≥ 1");
    else data.minQuantity = q;
  }
  if (body.maxDiscountAmount !== undefined) {
    if (body.maxDiscountAmount === null || body.maxDiscountAmount === "") data.maxDiscountAmount = null;
    else {
      const m = Number(body.maxDiscountAmount);
      if (!Number.isFinite(m) || m <= 0) errors.push("maxDiscountAmount must be greater than 0 (or empty for no cap)");
      else data.maxDiscountAmount = m;
    }
  }
  if (body.includeSpecialOrder !== undefined && body.deliveryDiscounts === undefined) data.includeSpecialOrder = body.includeSpecialOrder === true;
  if (body.status !== undefined) {
    if (!RULE_STATUSES.includes(body.status)) errors.push(`status must be one of ${RULE_STATUSES.join(", ")}`);
    else data.status = body.status;
  }
  if (body.priority !== undefined) {
    const p = Number(body.priority);
    if (!Number.isInteger(p) || p < 0 || p > 1000) errors.push("priority must be a whole number from 0 to 1000");
    else data.priority = p;
  }
  for (const k of ["startsAt", "endsAt"]) {
    if (body[k] === undefined) continue;
    const d = asDate(body[k]);
    if (d === undefined) errors.push(`${k} must be a valid date`);
    else data[k] = d;
  }
  if (data.startsAt && data.endsAt && data.endsAt.getTime() <= data.startsAt.getTime()) errors.push("rule endsAt must be after startsAt");

  // Scope/target consistency (evaluated on whatever combination we have).
  const scope = data.scope;
  if (scope === "PRODUCT" && !(data.productIds?.length)) errors.push("scope PRODUCT needs at least one product");
  if (scope === "CATEGORY" && !(data.categoryIds?.length)) errors.push("scope CATEGORY needs at least one category");
  if (scope === "BRAND" && !(data.brandIds?.length)) errors.push("scope BRAND needs at least one brand");
  return { data, errors };
}

export function validateBlockInput(body = {}, { partial = false } = {}) {
  const errors = [];
  const data = {};
  if (!partial || body.type !== undefined) {
    if (!BLOCK_TYPES.includes(body.type)) errors.push(`type must be one of ${BLOCK_TYPES.join(", ")}`);
    else data.type = body.type;
  }
  if (body.order !== undefined) {
    const o = Number(body.order);
    if (!Number.isInteger(o) || o < 0 || o > 1000) errors.push("order must be a whole number from 0 to 1000");
    else data.order = o;
  }
  if (body.isVisible !== undefined) data.isVisible = body.isVisible === true;
  if (body.heading !== undefined) data.heading = sanitizeText(body.heading, 140);
  if (body.subtitle !== undefined) data.subtitle = sanitizeText(body.subtitle, 300);
  if (body.ctaLabel !== undefined) data.ctaLabel = sanitizeText(body.ctaLabel, 40);
  if (body.ctaUrl !== undefined) {
    const u = String(body.ctaUrl || "").trim();
    if (u && !isSafeLink(u)) errors.push("ctaUrl must be an internal path (e.g. /shop) or an https URL");
    else data.ctaUrl = u;
  }
  for (const k of ["image", "mobileImage"]) {
    if (body[k] === undefined) continue;
    const v = String(body[k] || "").trim();
    if (v && !isSafeImage(v)) errors.push(`${k} must be an https URL or an internal path`);
    else data[k] = v;
  }
  for (const k of ["imageWidth", "imageHeight"]) {
    if (body[k] === undefined) continue;
    const n = Number(body[k]);
    if (!Number.isInteger(n) || n < 0 || n > 10000) errors.push(`${k} must be a whole number from 0 to 10000`);
    else data[k] = n;
  }
  if (body.productIds !== undefined) data.productIds = idList(body.productIds, 24);
  if (body.categoryIds !== undefined) data.categoryIds = idList(body.categoryIds, 24);
  for (const k of ["startsAt", "endsAt"]) {
    if (body[k] === undefined) continue;
    const d = asDate(body[k]);
    if (d === undefined) errors.push(`${k} must be a valid date`);
    else data[k] = d;
  }
  if (data.startsAt && data.endsAt && data.endsAt.getTime() <= data.startsAt.getTime()) errors.push("block endsAt must be after startsAt");
  return { data, errors };
}
