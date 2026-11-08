// server/services/campaignPricing.js
//
// THE authoritative seasonal-campaign pricing engine. The storefront, the
// mobile app and the admin only ever DISPLAY what this returns — they never
// compute a discount themselves, and nothing they send is trusted.
//
// ── POLICY (also documented in PRD §campaigns) ───────────────────────────────
// 1. A rule applies only if: its campaign is LIVE (published, inside its
//    window, server clock), the rule is ACTIVE and inside its own optional
//    window, rule+campaign belong to the product's country, the product is
//    visible in that country and available, the scope matches, min quantity is
//    met, and the price being charged is one the rule covers (the in-stock
//    "regular" price by default — special-order 2/5-week delivery prices are
//    excluded unless rule.includeSpecialOrder).
// 2. NO STACKING. The single best eligible rule wins (largest discount; ties →
//    higher rule.priority → higher campaign.priority → oldest rule → lowest id).
// 3. The product's own standing `discount` % (pre-existing feature) is treated
//    as just another candidate: the customer gets whichever of {standing
//    discount, best campaign rule} is lower. Campaign discounts never stack on
//    top of it. When no campaign wins, the price is EXACTLY what it was before
//    this feature existed (legacy Math.ceil rule), so non-campaign checkout is
//    unchanged.
// 4. Money is integer minor units (kobo). Percentages are basis points. The
//    discount is rounded UP (customer-favourable, matching the legacy ceil).
//    No floating-point currency arithmetic decides a price. final ≥ 0 always.
// 5. No currency conversion happens here. Prices are the catalogue base
//    currency; clients convert original and final with the same display rate.

import CampaignModel, { deriveCampaignStatus } from "../models/campaign.model.js";
import CampaignDiscountRuleModel from "../models/campaign-discount-rule.model.js";

export const BASE_CURRENCY = "NGN";
const MINOR = 100;

// ── money helpers ────────────────────────────────────────────────────────────
export const toMinor = (n) => Math.round((Number(n) + Number.EPSILON) * MINOR);
export const fromMinor = (m) => m / MINOR;

/** Discount (minor units) for one unit. Rounded up; capped at price and at the rule's cap. */
export function calcDiscountMinor({ priceMinor, discountType, discountValue, maxDiscountAmount = null }) {
  if (!Number.isFinite(priceMinor) || priceMinor <= 0) return 0;
  const value = Number(discountValue);
  if (!Number.isFinite(value) || value <= 0) return 0;

  let discount;
  if (discountType === "PERCENTAGE") {
    const bps = Math.round(value * 100); // 20 → 2000, 12.5 → 1250
    discount = Math.ceil((priceMinor * bps) / 10000);
  } else if (discountType === "FIXED_AMOUNT") {
    discount = toMinor(value);
  } else {
    return 0;
  }

  if (maxDiscountAmount !== null && maxDiscountAmount !== undefined) {
    discount = Math.min(discount, toMinor(maxDiscountAmount));
  }
  return Math.max(0, Math.min(discount, priceMinor));
}

/** The legacy standing-discount formula, byte-for-byte what order.controller.js always did. */
export const legacyPriceWithDiscount = (price, dis = 0) => {
  const discountAmount = Math.ceil((Number(price) * Number(dis)) / 100);
  return Number(price) - discountAmount;
};

/** Same selection rule as order.controller.js#getProductPrice (kept here so the engine is self-contained). */
export const getBasePrice = (product, priceOption = "regular") => {
  switch (priceOption) {
    case "3weeks":
      return product.price3weeksDelivery || product.btcPrice || product.price;
    case "5weeks":
      return product.price5weeksDelivery || product.btcPrice || product.price;
    default:
      return product.btcPrice || product.price;
  }
};

/** Mirrors core getApplicablePrice(): the in-stock regular price is only shown when stock exists. */
export const hasRegularStock = (product) => {
  const online = product.warehouseStock?.onlineStock || 0;
  const partner = product.partnerStock?.enabled === true && (product.partnerStock?.quantity || 0) > 0;
  return online > 0 || partner;
};

const idStr = (v) => (v && v._id ? String(v._id) : v ? String(v) : "");
const inList = (list, v) => Array.isArray(list) && list.some((x) => idStr(x) === idStr(v));

function productMatchesScope(rule, product) {
  switch (rule.scope) {
    case "ALL":
      return true;
    case "PRODUCT":
      return inList(rule.productIds, product._id);
    case "CATEGORY":
      return inList(rule.categoryIds, product.category) || inList(rule.categoryIds, product.subCategory);
    case "BRAND": {
      const brands = Array.isArray(product.brand) ? product.brand : product.brand ? [product.brand] : [];
      return brands.some((b) => inList(rule.brandIds, b));
    }
    default:
      return false;
  }
}

const inWindow = (start, end, now) =>
  (!start || now.getTime() >= new Date(start).getTime()) && (!end || now.getTime() <= new Date(end).getTime());

/**
 * Is `rule` (belonging to the LIVE `campaign`) eligible for this product line right now?
 * Pure — everything it needs is passed in.
 */
export function isRuleEligible({ rule, campaign, product, priceOption = "regular", quantity = 1, countryCode, now = new Date(), assumeLive = false }) {
  if (!rule || !campaign || !product) return false;
  if (rule.status !== "ACTIVE") return false;
  // `assumeLive` exists ONLY for the admin preview of a not-yet-published draft.
  if (!assumeLive && deriveCampaignStatus(campaign, now) !== "ACTIVE") return false;
  if (!inWindow(rule.startsAt, rule.endsAt, now)) return false;

  // Country isolation: rule, campaign and the shopper's market must all agree.
  if (!countryCode || rule.countryCode !== countryCode || campaign.countryCode !== countryCode) return false;
  const visible = product.visibleInCountries;
  if (Array.isArray(visible) && visible.length > 0 && !visible.includes(countryCode)) return false;

  if (product.productAvailability === false) return false;
  if (!productMatchesScope(rule, product)) return false;
  if (Number(quantity) < (rule.minQuantity || 1)) return false;

  const base = Number(getBasePrice(product, priceOption));
  if (!(base > 0)) return false;

  // Which price is the customer actually being charged for?
  const regularOk = priceOption === "regular" && hasRegularStock(product);
  if (!regularOk && !rule.includeSpecialOrder) return false;
  return true;
}

function compareCandidates(a, b) {
  if (b.discountMinor !== a.discountMinor) return b.discountMinor - a.discountMinor;
  if ((b.rule.priority || 0) !== (a.rule.priority || 0)) return (b.rule.priority || 0) - (a.rule.priority || 0);
  if ((b.campaign.priority || 0) !== (a.campaign.priority || 0)) return (b.campaign.priority || 0) - (a.campaign.priority || 0);
  const ta = new Date(a.rule.createdAt || 0).getTime();
  const tb = new Date(b.rule.createdAt || 0).getTime();
  if (ta !== tb) return ta - tb;
  return String(a.rule._id).localeCompare(String(b.rule._id));
}

/**
 * Price ONE product line. Pure and synchronous.
 *
 * @returns {{
 *   originalPrice:number, finalPrice:number, discountAmount:number, discountPercentage:number,
 *   currency:string, isDiscounted:boolean, source:'CAMPAIGN'|'PRODUCT_DISCOUNT'|'NONE',
 *   priceOption:string, quantity:number,
 *   discountLabel?:string, campaign?:object, rule?:object
 * }}
 */
export function priceLine({ product, priceOption = "regular", quantity = 1, rules = [], campaigns = new Map(), countryCode, now = new Date(), previewIds = null }) {
  const basePrice = Number(getBasePrice(product, priceOption)) || 0;
  const priceMinor = toMinor(basePrice);

  // Legacy standing discount — the baseline every order used before campaigns.
  const standingPct = Number(product.discount) || 0;
  const legacyFinal = standingPct > 0 ? legacyPriceWithDiscount(basePrice, standingPct) : basePrice;
  const legacyFinalMinor = toMinor(legacyFinal);

  let best = null;
  for (const rule of rules) {
    const campaign = campaigns.get(idStr(rule.campaignId));
    const assumeLive = !!previewIds && previewIds.has(idStr(rule.campaignId));
    if (!isRuleEligible({ rule, campaign, product, priceOption, quantity, countryCode, now, assumeLive })) continue;
    const discountMinor = calcDiscountMinor({
      priceMinor,
      discountType: rule.discountType,
      discountValue: rule.discountValue,
      maxDiscountAmount: rule.maxDiscountAmount,
    });
    if (discountMinor <= 0) continue;
    const cand = { rule, campaign, discountMinor };
    if (!best || compareCandidates(cand, best) < 0) best = cand;
  }

  const base_ = { currency: BASE_CURRENCY, priceOption, quantity };

  // Campaign wins only if it is strictly cheaper than the standing price.
  if (best && priceMinor - best.discountMinor < legacyFinalMinor) {
    const finalMinor = priceMinor - best.discountMinor;
    const pct = Math.round((best.discountMinor / priceMinor) * 10000) / 100;
    const { rule, campaign } = best;
    const labelCustom = rule.label && rule.label.trim();
    return {
      ...base_,
      originalPrice: fromMinor(priceMinor),
      finalPrice: fromMinor(finalMinor),
      discountAmount: fromMinor(best.discountMinor),
      discountPercentage: pct,
      isDiscounted: true,
      source: "CAMPAIGN",
      // Plain-text fallback only; storefronts render a localized label from
      // discountPercentage / discountType and use `rule.label` when set.
      discountLabel: labelCustom || (rule.discountType === "PERCENTAGE" ? `${pct}% OFF` : `${fromMinor(best.discountMinor)} OFF`),
      campaign: {
        id: String(campaign._id),
        name: campaign.name,
        slug: campaign.slug,
        type: campaign.type,
        endsAt: new Date(campaign.endsAt).toISOString(),
      },
      rule: {
        id: String(rule._id),
        name: rule.name,
        label: labelCustom || "",
        discountType: rule.discountType,
        discountValue: rule.discountValue,
      },
    };
  }

  if (standingPct > 0) {
    const finalMinor = legacyFinalMinor;
    return {
      ...base_,
      originalPrice: fromMinor(priceMinor),
      finalPrice: legacyFinal,
      discountAmount: fromMinor(priceMinor - finalMinor),
      discountPercentage: priceMinor > 0 ? Math.round(((priceMinor - finalMinor) / priceMinor) * 10000) / 100 : 0,
      isDiscounted: priceMinor > finalMinor,
      source: "PRODUCT_DISCOUNT",
    };
  }

  return {
    ...base_,
    originalPrice: basePrice,
    finalPrice: basePrice,
    discountAmount: 0,
    discountPercentage: 0,
    isDiscounted: false,
    source: "NONE",
  };
}

// ── Context loading (DB) with a short per-country cache ──────────────────────
// Rules are read on every product list/detail/cart/checkout call, so they are
// cached per country for a few seconds. Admin mutations call
// invalidateCampaignCache() (immediate on this instance); other Cloud Run
// instances converge within the TTL — that bounded staleness IS the documented
// "safe cache invalidation" for pause/expiry. Set CAMPAIGN_CACHE_TTL_MS=0 to disable.
const cache = new Map(); // countryCode -> { at, ctx }
const ttl = () => {
  const v = Number(process.env.CAMPAIGN_CACHE_TTL_MS);
  return Number.isFinite(v) && v >= 0 ? v : 15000;
};

export function invalidateCampaignCache(countryCode) {
  if (countryCode) cache.delete(countryCode);
  else cache.clear();
}

/**
 * Everything the engine needs for one country at time `now`:
 * the LIVE campaigns and their ACTIVE rules. Never throws — a DB failure
 * degrades to "no campaigns" so ordinary browsing/checkout is never blocked.
 */
export async function getCampaignContext(countryCode, now = new Date()) {
  const empty = { countryCode, campaigns: new Map(), campaignList: [], rules: [], now };
  if (!countryCode) return empty;

  const hit = cache.get(countryCode);
  if (hit && ttl() > 0 && Date.now() - hit.at < ttl()) {
    // The cached set may contain a campaign that has since ended: re-filter on `now`.
    return refilter(hit.ctx, now);
  }

  try {
    // Bypass the countryScopedPlugin's request-scope filter by querying with an
    // explicit countryCode; this is a read for PUBLIC pricing, not an admin view.
    const campaigns = await CampaignModel.find({
      countryCode,
      publishState: "PUBLISHED",
      startsAt: { $lte: new Date(now.getTime() + ttl() + 1000) },
      endsAt: { $gte: new Date(now.getTime() - 1000) },
    }).lean();
    const ids = campaigns.map((c) => c._id);
    const rules = ids.length
      ? await CampaignDiscountRuleModel.find({ countryCode, campaignId: { $in: ids }, status: "ACTIVE" }).lean()
      : [];
    const ctx = { countryCode, campaigns, rules };
    cache.set(countryCode, { at: Date.now(), ctx });
    return refilter(ctx, now);
  } catch (err) {
    console.error("[campaignPricing] context load failed — falling back to no campaigns:", err.message);
    return empty;
  }
}

function refilter(ctx, now) {
  const live = ctx.campaigns.filter((c) => deriveCampaignStatus(c, now) === "ACTIVE");
  const map = new Map(live.map((c) => [String(c._id), c]));
  const rules = ctx.rules.filter((r) => map.has(String(r.campaignId)));
  return { countryCode: ctx.countryCode, campaigns: map, campaignList: live, rules, now };
}

/** True when the country has at least one live campaign with an active rule (cheap fast-path guard). */
export const contextHasDiscounts = (ctx) => ctx.rules.length > 0;

/** Price one product line using a loaded context. */
export function priceProductLine(ctx, product, { priceOption = "regular", quantity = 1 } = {}) {
  return priceLine({
    product,
    priceOption,
    quantity,
    rules: ctx.rules,
    campaigns: ctx.campaigns,
    countryCode: ctx.countryCode,
    now: ctx.now,
    previewIds: ctx.previewIds || null,
  });
}

/**
 * Compact, immutable snapshot persisted on an order line / payment metadata so
 * historical orders stay correct after a campaign ends or is edited.
 * Always returns an object for campaign lines and `null` otherwise.
 */
export function buildCampaignSnapshot(pricing, at = new Date()) {
  if (!pricing || pricing.source !== "CAMPAIGN") return null;
  return {
    campaignId: pricing.campaign.id,
    campaignName: pricing.campaign.name,
    campaignType: pricing.campaign.type,
    ruleId: pricing.rule.id,
    ruleName: pricing.rule.name,
    discountType: pricing.rule.discountType,
    discountValue: pricing.rule.discountValue,
    originalUnitPrice: pricing.originalPrice,
    discountPerUnit: pricing.discountAmount,
    finalUnitPrice: pricing.finalPrice,
    currency: pricing.currency,
    appliedAt: at,
  };
}

/** Price a populated cart (array of { productId: <product doc>, quantity, priceOption }) in one pass. */
export async function priceCartLines(cartItems, countryCode, now = new Date()) {
  const ctx = await getCampaignContext(countryCode, now);
  return cartItems.map((item) => {
    const product = item.productId?.toObject ? item.productId.toObject() : item.productId;
    const pricing = priceProductLine(ctx, product, {
      priceOption: item.priceOption || "regular",
      quantity: item.quantity || 1,
    });
    return { item, pricing, snapshot: buildCampaignSnapshot(pricing, now) };
  });
}

/**
 * Checkout revalidation. The client reports the NGN subtotal it believes it is
 * paying; the server re-prices the cart and refuses stale totals so a price from
 * an expired/paused campaign can never be honoured.
 * Tolerance is 1 NGN per line (display rounding), never a percentage.
 */
export function checkSubtotalMatches(clientSubtotal, priced) {
  if (clientSubtotal === undefined || clientSubtotal === null || clientSubtotal === "") return { ok: true };
  const server = priced.reduce((s, l) => s + toMinor(l.pricing.finalPrice) * (l.item.quantity || 1), 0);
  const serverNgn = fromMinor(server);
  // Cart snapshots and legacy client math can differ from the authoritative
  // price by < 1 NGN per unit (float vs rounded-up discount) — allow that, no more.
  const tolerance = Math.max(1, priced.reduce((n, l) => n + (l.item.quantity || 1), 0));
  const ok = Math.abs(Number(clientSubtotal) - serverNgn) <= tolerance;
  return { ok, serverSubtotal: serverNgn, clientSubtotal: Number(clientSubtotal) };
}

const PRICE_OPTIONS = ["regular", "3weeks", "5weeks"];

/**
 * Attach `campaignPricing` ({ regular?, "3weeks"?, "5weeks"? }) to every product
 * that has an active CAMPAIGN discount for that price option. Products without
 * one are returned untouched (so the storefront renders exactly as before).
 * Input must be plain objects (.lean()). Returns a NEW array.
 *
 * `extraCampaigns`/`extraRules` are used by the admin PREVIEW only: they are
 * priced in memory as if live and are never cached or written anywhere.
 */
export async function decorateProductsWithCampaignPricing(products, countryCode, { now = new Date(), extraCampaigns = [], extraRules = [] } = {}) {
  if (!Array.isArray(products) || products.length === 0) return products;
  let ctx = await getCampaignContext(countryCode, now);
  if (extraCampaigns.length) {
    const campaigns = new Map(ctx.campaigns);
    for (const c of extraCampaigns) campaigns.set(String(c._id), c);
    ctx = {
      ...ctx,
      campaigns,
      rules: [...ctx.rules, ...extraRules],
      previewIds: new Set(extraCampaigns.map((c) => String(c._id))),
    };
  }
  if (!contextHasDiscounts(ctx)) return products;

  return products.map((p) => {
    const out = {};
    for (const opt of PRICE_OPTIONS) {
      const pricing = priceProductLine(ctx, p, { priceOption: opt });
      if (pricing.source === "CAMPAIGN") out[opt] = pricing;
    }
    return Object.keys(out).length ? { ...p, campaignPricing: out } : p;
  });
}

/**
 * The payment-metadata form of a priced cart: every line carries the LOCKED
 * unit price (NGN) and campaign snapshot the customer is being charged for, so
 * order creation after the gateway webhook reproduces exactly that — even if
 * the campaign ends or is edited in the meantime.
 */
export function buildLockedCartLines(priced) {
  return priced.map(({ item, pricing, snapshot }) => ({
    productId: item.productId?._id?.toString?.() || String(item.productId),
    quantity: item.quantity,
    priceOption: item.priceOption || "regular",
    unit: pricing.finalPrice,
    ...(snapshot ? { cs: snapshot } : {}),
  }));
}

/** Σ finalPrice × quantity in NGN (integer-kobo arithmetic). */
export function serverSubtotalNgn(priced) {
  return fromMinor(priced.reduce((s, l) => s + toMinor(l.pricing.finalPrice) * (l.item.quantity || 1), 0));
}

/** The 409 body every checkout endpoint returns when the shopper's displayed prices are stale. */
export const priceChangedBody = (check) => ({
  success: false,
  error: true,
  code: "PRICE_CHANGED",
  message: "Some prices have changed since you added items to your cart. Please review your cart and try again.",
  data: { serverSubtotal: check.serverSubtotal, clientSubtotal: check.clientSubtotal },
});
