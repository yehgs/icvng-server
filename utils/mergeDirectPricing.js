// utils/mergeDirectPricing.js
//
// DirectPricing is a side-collection accountants use to override a product's
// btcPrice / price3weeksDelivery / price5weeksDelivery without editing the
// product record directly. Whenever ONLY SOME of those three fields are set
// through the Direct Pricing UI, the other fields stay at their Mongoose
// default of 0 on the DirectPricing record — even though the Product record
// itself may already have a real, correct value for that field.
//
// The rule (already used by getProductDetails for the single-product page)
// is: "DirectPricing wins when it has a value > 0, otherwise fall back to
// whatever is on the Product record." This file centralizes that rule so
// every place that shows prices (search, product list, direct pricing admin)
// stays in sync instead of re-implementing (and drifting from) the logic.

import DirectPricingModel from "../models/direct-pricing.model.js";
import ProductModel from "../models/product.model.js";

const PRICE_FIELDS = ["btcPrice", "price3weeksDelivery", "price5weeksDelivery"];

/**
 * Given a plain product object (or Mongoose doc) and an active DirectPricing
 * document (or null), return the effective price fields: DirectPricing's
 * value when > 0, otherwise the product's own value.
 */
export function computeEffectivePrices(product, directPricing) {
  const dp = directPricing?.directPrices;
  const effective = {};
  PRICE_FIELDS.forEach((field) => {
    const dpValue = dp?.[field];
    effective[field] =
      dpValue !== undefined && dpValue !== null && dpValue > 0
        ? dpValue
        : product?.[field] || 0;
  });
  return effective;
}

/**
 * Merge effective (DirectPricing-aware) prices into an array of product
 * objects returned from a query (e.g. search results, product listings).
 * Products are expected to be plain objects (.lean()).
 * Also fires-and-forgets a sync back to ProductModel so it doesn't stay
 * out of date, matching the behavior already used for the single-product page.
 *
 * Returns a NEW array; does not mutate the input.
 */
export async function mergeDirectPricingIntoProducts(products) {
  if (!Array.isArray(products) || products.length === 0) return products;

  const ids = products.map((p) => p._id);
  const activeDirectPricings = await DirectPricingModel.find({
    product: { $in: ids },
    isActive: true,
  }).lean();

  if (activeDirectPricings.length === 0) return products;

  const dpByProductId = new Map(
    activeDirectPricings.map((dp) => [String(dp.product), dp]),
  );

  const syncOps = [];

  const merged = products.map((product) => {
    const dp = dpByProductId.get(String(product._id));
    if (!dp) return product;

    const effective = computeEffectivePrices(product, dp);
    const needsSync = PRICE_FIELDS.some(
      (field) =>
        dp.directPrices?.[field] > 0 && product[field] !== effective[field],
    );

    if (needsSync) {
      syncOps.push({
        updateOne: {
          filter: { _id: product._id },
          update: { $set: effective },
        },
      });
    }

    return { ...product, ...effective };
  });

  if (syncOps.length > 0) {
    // Fire-and-forget: don't block the response on this housekeeping write.
    ProductModel.bulkWrite(syncOps).catch(() => {});
  }

  return merged;
}
