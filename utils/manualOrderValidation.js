/**
 * utils/manualOrderValidation.js
 *
 * The canonical §3 purchasability rule from PRODUCT_VISIBILITY_RULES.md,
 * applied to the MANUAL (admin-created) order path.
 *
 * WHY THIS FILE EXISTS
 * ────────────────────
 * PRODUCT_VISIBILITY_RULES.md §7 is explicit: the rule is implemented in
 * three places and they must stay in sync, and "if you add a new
 * product-listing endpoint, import and call the shared builders — never
 * inline the $or again". The manual order path did exactly the thing that
 * warning exists to prevent, in two places:
 *
 *   1. server createAdminOrderController read stock as
 *        product.warehouseStock?.enabled
 *          ? product.warehouseStock.offlineStock
 *          : product.stock
 *      — which ignores `partnerStock` entirely. A product whose only stock
 *      is a partner's reported quantity read as zero available, so a sales
 *      agent could not sell stock the storefront was happily selling.
 *
 *   2. admin ProductSearchModal.jsx carried its own stale copy that checked
 *      "has dropship prices" generically instead of the five-week-type
 *      distinction, so a MACHINE priced only on price3weeksDelivery (which
 *      the storefront correctly refuses to sell) still appeared valid to add.
 *
 * Net effect: the manual order system could both under-sell and over-sell
 * relative to the storefront. This module is the single implementation the
 * server side now uses.
 *
 * STOCK PRIORITY mirrors the product schema's own `effectiveOnlineStock`
 * virtual, as §3 requires:
 *     partnerStock (if enabled) → warehouseStock.onlineStock → legacy `stock`
 */

import mongoose from "mongoose";

/** Category slugs that force five-week delivery pricing (§2). */
export const FIVE_WEEK_DELIVERY_SLUGS = ["capsule-machine", "coffee-maker"];

/**
 * §2 — a product is "five-week type" if EITHER its productType is MACHINE
 * OR its category slug is one of the five-week slugs. Both signals are
 * checked because productType alone is not reliable (the Tassimo case in
 * the rules doc: a machine filed under "Coffee Maker" but left as COFFEE).
 */
export function isFiveWeekType(productType, categorySlugs = []) {
  if (productType === "MACHINE") return true;
  return categorySlugs.some((slug) => FIVE_WEEK_DELIVERY_SLUGS.includes(slug));
}

/**
 * Effective online stock, honouring the §3 priority order.
 *
 * NOTE the deliberate choice of ONLINE stock, not offline. Manual orders are
 * BTC sales to a walk-in/phone customer fulfilled from the same pool the
 * storefront sells from. Reading `warehouseStock.offlineStock` (as the old
 * code did) measured a different pool entirely, which is why manual-order
 * stock checks disagreed with the storefront's.
 */
export function getEffectiveOnlineStock(product) {
  if (product?.partnerStock?.enabled) {
    return product.partnerStock.quantity || 0;
  }
  if (product?.warehouseStock?.enabled) {
    return product.warehouseStock.onlineStock || 0;
  }
  return product?.stock || 0;
}

/**
 * §3 — the canonical purchasability formula.
 *
 *   (a) hasMatchingDeliveryPrice
 *         five-week type → price5weeksDelivery > 0
 *         otherwise      → price3weeksDelivery > 0
 *   (b) hasRegularPriceWithStock
 *         btcPrice > 0 AND effective online stock > 0
 *
 *   purchasable = (a) OR (b)
 *
 * @returns {{purchasable: boolean, reason: string|null, viaStock: boolean,
 *            viaDelivery: boolean, availableStock: number}}
 */
export function evaluatePurchasability(product, categorySlugs = []) {
  const fiveWeek = isFiveWeekType(product?.productType, categorySlugs);

  const deliveryPrice = fiveWeek
    ? product?.price5weeksDelivery
    : product?.price3weeksDelivery;
  const viaDelivery = Number(deliveryPrice) > 0;

  const availableStock = getEffectiveOnlineStock(product);
  const viaStock = Number(product?.btcPrice) > 0 && availableStock > 0;

  const purchasable = viaDelivery || viaStock;

  let reason = null;
  if (!purchasable) {
    if (!(Number(product?.btcPrice) > 0) && !viaDelivery) {
      reason = "No valid BTC price and no delivery price set";
    } else if (Number(product?.btcPrice) > 0 && availableStock === 0) {
      reason = fiveWeek
        ? "No stock, and no 5-week delivery price set for this machine"
        : "No stock, and no 2-week delivery price set";
    } else {
      reason = fiveWeek
        ? "Machine requires a 5-week delivery price"
        : "Requires a 2-week delivery price";
    }
  }

  return { purchasable, reason, viaStock, viaDelivery, availableStock, fiveWeek };
}

/**
 * §4 — availability gate, independent of pricing/stock. An explicitly
 * discontinued product must never be sellable, manually or otherwise.
 */
export function isProductSellable(product, categorySlugs = []) {
  if (product?.productAvailability === false) {
    return { sellable: false, reason: "Product is marked not available for sale" };
  }
  if (product?.publish && product.publish !== "PUBLISHED") {
    return { sellable: false, reason: `Product is ${product.publish}, not published` };
  }
  const { purchasable, reason, availableStock, viaStock, viaDelivery } =
    evaluatePurchasability(product, categorySlugs);
  return {
    sellable: purchasable,
    reason: purchasable ? null : reason,
    availableStock,
    viaStock,
    viaDelivery,
  };
}

/**
 * Resolve a product's category slugs. §2 only works if the slug is actually
 * present — the rules doc records three endpoints that silently dropped it
 * by populating `select: "name"`, letting mis-tagged machines slip through.
 * This does the lookup explicitly so callers can't repeat that mistake.
 */
export async function resolveCategorySlugs(product, session) {
  const ids = (product?.category || []).map((c) =>
    typeof c === "object" && c?._id ? c._id : c,
  );
  if (!ids.length) return [];

  // Already populated with slugs? Use them.
  const populated = (product.category || [])
    .filter((c) => typeof c === "object" && c?.slug)
    .map((c) => c.slug);
  if (populated.length === ids.length) return populated;

  const CategoryModel = mongoose.models.category || mongoose.models.Category;
  if (!CategoryModel) return populated;

  const q = CategoryModel.find({ _id: { $in: ids } }).select("slug");
  const rows = await (session ? q.session(session) : q);
  return rows.map((r) => r.slug).filter(Boolean);
}

/**
 * BTC unit price for a manual order line.
 *
 * BTB pricing is deliberately absent — manual orders are BTC-only as of
 * 2026-08-28. `btbPrice` remains on the product schema for historical
 * orders and reporting, but nothing may price a NEW order from it.
 */
export function getManualOrderUnitPrice(product, priceOption = "regular") {
  switch (priceOption) {
    case "3weeks":
    case "2weeks":
      return product?.price3weeksDelivery || 0;
    case "5weeks":
      return product?.price5weeksDelivery || 0;
    case "regular":
    default:
      return product?.btcPrice || product?.price || 0;
  }
}

/**
 * Which stock pool a given price option draws down.
 * Delivery-priced (special order) lines are sourced from the supplier and
 * must NOT decrement local stock — decrementing it was never correct and
 * would have quietly drained inventory that was never reserved.
 */
export function priceOptionConsumesStock(priceOption) {
  return !["3weeks", "2weeks", "5weeks"].includes(priceOption);
}
