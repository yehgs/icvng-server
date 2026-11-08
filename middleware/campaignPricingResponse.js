// server/middleware/campaignPricingResponse.js
//
// Attaches `campaignPricing` to every product object in a PUBLIC response, so
// the storefront and mobile app render discount badges from server-computed
// numbers on every surface (home, shop, search, PDP, wishlist, compare…)
// without each of ~15 controllers having to remember to do it.
//
// Fast path: if the shopper's country has no live campaign with an active rule
// (the normal case ~all year) this does ONE cached lookup and passes the
// response through byte-for-byte — zero extra serialisation, zero DB work.
//
// Fail-safe: any error here is logged and the ORIGINAL body is sent. A
// campaign problem can never break browsing.

import { getCampaignContext, contextHasDiscounts, priceProductLine } from "../services/campaignPricing.js";

const OPTIONS = ["regular", "3weeks", "5weeks"];
const CONTAINER_KEYS = ["data", "products", "items", "docs", "related", "relatedProducts", "product", "wishlist", "compare"];

const looksLikeProduct = (o) =>
  o && typeof o === "object" && !Array.isArray(o) && o._id &&
  (o.btcPrice !== undefined || o.price !== undefined) && o.name !== undefined &&
  (o.slug !== undefined || o.sku !== undefined);

function collectProducts(node, out, depth = 0) {
  if (!node || typeof node !== "object" || depth > 5) return;
  if (Array.isArray(node)) {
    for (const n of node) collectProducts(n, out, depth + 1);
    return;
  }
  if (looksLikeProduct(node)) out.push(node);
  for (const k of CONTAINER_KEYS) if (node[k] && typeof node[k] === "object") collectProducts(node[k], out, depth + 1);
  // A populated cart/wishlist line: { productId: <product> }
  if (node.productId && typeof node.productId === "object") collectProducts(node.productId, out, depth + 1);
}

export default function campaignPricingResponse(req, res, next) {
  const original = res.json.bind(res);
  res.json = (body) => {
    (async () => {
      try {
        // Admin sessions see raw catalogue data; only shopper-facing responses are decorated.
        if (res.statusCode < 400 && body && typeof body === "object" && req.user?.role !== "ADMIN") {
          const ctx = await getCampaignContext(req.countryCode || "NG");
          if (contextHasDiscounts(ctx)) {
            const plain = JSON.parse(JSON.stringify(body));
            const products = [];
            collectProducts(plain, products);
            for (const p of products) {
              const out = {};
              for (const opt of OPTIONS) {
                const pricing = priceProductLine(ctx, p, { priceOption: opt });
                if (pricing.source === "CAMPAIGN") out[opt] = pricing;
              }
              if (Object.keys(out).length) p.campaignPricing = out;
            }
            return original(plain);
          }
        }
      } catch (err) {
        console.error("[campaignPricingResponse] passing response through undecorated:", err.message);
      }
      return original(body);
    })();
    return res;
  };
  next();
}
