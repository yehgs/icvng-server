// Run: node tests/campaign_pricing_unit.mjs   (no database needed)
import assert from "assert/strict";
import mongoose from "mongoose";
const { calcDiscountMinor, priceLine, toMinor, checkSubtotalMatches, legacyPriceWithDiscount } = await import("../services/campaignPricing.js");

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log("  ✓", name); };

const NOW = new Date("2026-11-27T12:00:00Z");
const oid = () => new mongoose.Types.ObjectId();
const campaign = (over = {}) => ({ _id: oid(), name: "Black Friday", slug: "bf", type: "BLACK_FRIDAY", countryCode: "NG", publishState: "PUBLISHED", startsAt: new Date("2026-11-20T00:00:00Z"), endsAt: new Date("2026-12-01T00:00:00Z"), priority: 0, ...over });
const rule = (c, over = {}) => ({ _id: oid(), campaignId: c._id, countryCode: "NG", name: "20%", label: "", discountType: "PERCENTAGE", discountValue: 20, scope: "ALL", productIds: [], categoryIds: [], brandIds: [], minQuantity: 1, maxDiscountAmount: null, includeSpecialOrder: false, status: "ACTIVE", priority: 0, createdAt: new Date("2026-11-01"), ...over });
const product = (over = {}) => ({ _id: oid(), name: "Beans", btcPrice: 50000, discount: 0, productAvailability: true, warehouseStock: { onlineStock: 10 }, ...over });
const price = (p, c, r, extra = {}) => priceLine({ product: p, rules: [].concat(r), campaigns: new Map([].concat(c).map((x) => [String(x._id), x])), countryCode: "NG", now: NOW, ...extra });

console.log("money");
t("20% of 50,000 → 40,000", () => assert.equal(calcDiscountMinor({ priceMinor: toMinor(50000), discountType: "PERCENTAGE", discountValue: 20 }), toMinor(10000)));
t("percentage discount is rounded UP to the kobo: 12.5% of 33.33 → 4.17", () => assert.equal(calcDiscountMinor({ priceMinor: toMinor(33.33), discountType: "PERCENTAGE", discountValue: 12.5 }), 417));
t("10% of 999 is exactly 99.90 (kobo precision, no float drift)", () => assert.equal(calcDiscountMinor({ priceMinor: toMinor(999), discountType: "PERCENTAGE", discountValue: 10 }), 9990));
t("fixed amount is capped at the price (never below zero)", () => assert.equal(calcDiscountMinor({ priceMinor: toMinor(5000), discountType: "FIXED_AMOUNT", discountValue: 9000 }), toMinor(5000)));
t("maxDiscountAmount caps a percentage", () => assert.equal(calcDiscountMinor({ priceMinor: toMinor(100000), discountType: "PERCENTAGE", discountValue: 50, maxDiscountAmount: 10000 }), toMinor(10000)));
t("invalid values give no discount", () => { for (const v of [0, -5, NaN, "x"]) assert.equal(calcDiscountMinor({ priceMinor: 5000, discountType: "PERCENTAGE", discountValue: v }), 0); });
t("no binary-float drift: 0.1+0.2 style prices stay exact in minor units", () => assert.equal(toMinor(0.1 + 0.2), 30));

console.log("eligibility & lifecycle");
t("active campaign applies; response carries campaign info", () => {
  const c = campaign(); const r = price(product(), c, rule(c));
  assert.equal(r.finalPrice, 40000); assert.equal(r.originalPrice, 50000); assert.equal(r.discountAmount, 10000);
  assert.equal(r.discountPercentage, 20); assert.equal(r.isDiscounted, true); assert.equal(r.source, "CAMPAIGN");
  assert.equal(r.currency, "NGN"); assert.equal(r.campaign.type, "BLACK_FRIDAY"); assert.equal(r.discountLabel, "20% OFF");
});
t("not yet started → no discount", () => { const c = campaign({ startsAt: new Date("2026-12-01"), endsAt: new Date("2026-12-10") }); assert.equal(price(product(), c, rule(c)).source, "NONE"); });
t("expired → no discount", () => { const c = campaign({ startsAt: new Date("2026-11-01"), endsAt: new Date("2026-11-10") }); assert.equal(price(product(), c, rule(c)).source, "NONE"); });
t("PAUSED / DRAFT / ARCHIVED campaign → no discount", () => { for (const publishState of ["PAUSED", "DRAFT", "ARCHIVED"]) { const c = campaign({ publishState }); assert.equal(price(product(), c, rule(c)).source, "NONE", publishState); } });
t("paused rule → no discount; DRAFT rule → no discount", () => { const c = campaign(); for (const status of ["PAUSED", "DRAFT"]) assert.equal(price(product(), c, rule(c, { status })).source, "NONE"); });
t("rule's own window is honoured", () => { const c = campaign(); assert.equal(price(product(), c, rule(c, { endsAt: new Date("2026-11-26") })).source, "NONE"); });
t("country isolation: NG campaign never prices a TG shopper", () => { const c = campaign(); assert.equal(price(product(), c, rule(c), { countryCode: "TG" }).source, "NONE"); });
t("rule whose country differs from its campaign never applies", () => { const c = campaign(); assert.equal(price(product(), c, rule(c, { countryCode: "TG" })).source, "NONE"); });
t("product not visible in the country → no discount", () => { const c = campaign(); assert.equal(price(product({ visibleInCountries: ["TG"] }), c, rule(c)).source, "NONE"); });
t("unavailable product → no discount", () => { const c = campaign(); assert.equal(price(product({ productAvailability: false }), c, rule(c)).source, "NONE"); });

console.log("scope");
t("PRODUCT scope hits only listed products", () => { const c = campaign(); const p = product(); assert.equal(price(p, c, rule(c, { scope: "PRODUCT", productIds: [p._id] })).source, "CAMPAIGN"); assert.equal(price(p, c, rule(c, { scope: "PRODUCT", productIds: [oid()] })).source, "NONE"); });
t("CATEGORY scope", () => { const c = campaign(); const cat = oid(); assert.equal(price(product({ category: [cat] }), c, rule(c, { scope: "CATEGORY", categoryIds: [cat] })).source, "CAMPAIGN"); });
t("BRAND scope", () => { const c = campaign(); const b = oid(); assert.equal(price(product({ brand: [b] }), c, rule(c, { scope: "BRAND", brandIds: [b] })).source, "CAMPAIGN"); });
t("minQuantity gate", () => { const c = campaign(); const r = rule(c, { minQuantity: 3 }); assert.equal(price(product(), c, r, { quantity: 2 }).source, "NONE"); assert.equal(price(product(), c, r, { quantity: 3 }).source, "CAMPAIGN"); });

console.log("special-order / stock rules");
t("out-of-stock (special-order) price is NOT discounted by default", () => { const c = campaign(); assert.equal(price(product({ warehouseStock: { onlineStock: 0 } }), c, rule(c)).source, "NONE"); });
t("3-week price not discounted by default, discounted when the rule opts in", () => {
  const c = campaign(); const p = product({ price3weeksDelivery: 45000 });
  assert.equal(price(p, c, rule(c), { priceOption: "3weeks" }).source, "NONE");
  const r = price(p, c, rule(c, { includeSpecialOrder: true }), { priceOption: "3weeks" });
  assert.equal(r.originalPrice, 45000); assert.equal(r.finalPrice, 36000);
});
t("enabled partner stock with quantity counts as in stock", () => { const c = campaign(); assert.equal(price(product({ warehouseStock: { onlineStock: 0 }, partnerStock: { enabled: true, quantity: 4 } }), c, rule(c)).source, "CAMPAIGN"); });

console.log("selection policy (no stacking)");
t("best single rule wins, never stacked", () => { const c = campaign(); const r = price(product(), c, [rule(c, { discountValue: 10 }), rule(c, { discountValue: 30 }), rule(c, { discountValue: 20 })]); assert.equal(r.finalPrice, 35000); assert.equal(r.discountPercentage, 30); });
t("equal discounts: higher rule priority wins deterministically", () => { const c = campaign(); const a = rule(c, { name: "A", priority: 1 }); const b = rule(c, { name: "B", priority: 5 }); assert.equal(price(product(), c, [a, b]).rule.name, "B"); assert.equal(price(product(), c, [b, a]).rule.name, "B"); });
t("standing product discount applies when campaign is not cheaper", () => { const c = campaign(); const r = price(product({ discount: 40 }), c, rule(c)); assert.equal(r.source, "PRODUCT_DISCOUNT"); assert.equal(r.finalPrice, 30000); });
t("campaign beats a smaller standing discount (no double discount)", () => { const c = campaign(); const r = price(product({ discount: 5 }), c, rule(c, { discountValue: 20 })); assert.equal(r.source, "CAMPAIGN"); assert.equal(r.finalPrice, 40000); assert.equal(r.originalPrice, 50000); });
t("no campaign: identical to the legacy formula, byte for byte", () => { for (const [p, d] of [[999, 10], [12345, 7], [50000, 15], [3333, 33]]) { const r = priceLine({ product: product({ btcPrice: p, discount: d }), countryCode: "NG", now: NOW }); assert.equal(r.finalPrice, legacyPriceWithDiscount(p, d)); } });
t("no discount at all → plain product, isDiscounted=false", () => { const r = priceLine({ product: product(), countryCode: "NG", now: NOW }); assert.deepEqual([r.source, r.isDiscounted, r.finalPrice, r.discountAmount], ["NONE", false, 50000, 0]); });
t("preview: draft campaign is priced only when its id is in previewIds", () => { const c = campaign({ publishState: "DRAFT" }); const r = rule(c); assert.equal(price(product(), c, r).source, "NONE"); assert.equal(price(product(), c, r, { previewIds: new Set([String(c._id)]) }).source, "CAMPAIGN"); });

console.log("checkout guard");
t("matching client subtotal passes; stale subtotal is rejected", () => {
  const priced = [{ item: { quantity: 2 }, pricing: { finalPrice: 40000 } }];
  assert.equal(checkSubtotalMatches(80000, priced).ok, true);
  assert.equal(checkSubtotalMatches(100000, priced).ok, false);
  assert.equal(checkSubtotalMatches(undefined, priced).ok, true, "no client figure → nothing to compare");
});
t("sub-naira rounding differences per unit are tolerated, not more", () => {
  const priced = [{ item: { quantity: 3 }, pricing: { finalPrice: 100 } }];
  assert.equal(checkSubtotalMatches(302, priced).ok, true);
  assert.equal(checkSubtotalMatches(310, priced).ok, false);
});

console.log(`\n${passed} passed`);
