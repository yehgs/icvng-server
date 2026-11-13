// Run: node tests/campaign_rule_validation_unit.mjs  — per-price discount input validation
import assert from "assert/strict";
const { validateRuleInput } = await import("../utils/campaignValidation.js");
let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ✓", name); };
const base = { name: "R", scope: "ALL" };

t("regular only (legacy shape) still valid", () => { const r = validateRuleInput({ ...base, discountType: "PERCENTAGE", discountValue: 20 }); assert.deepEqual(r.errors, []); assert.equal(r.data.discountValue, 20); });
t("regular + 3-week + 5-week each with own type/value/cap", () => {
  const r = validateRuleInput({ ...base, discountType: "PERCENTAGE", discountValue: 20, deliveryDiscounts: { threeWeeks: { enabled: true, discountType: "PERCENTAGE", discountValue: 10, maxDiscountAmount: "" }, fiveWeeks: { enabled: true, discountType: "FIXED_AMOUNT", discountValue: 5000, maxDiscountAmount: 3000 } } });
  assert.deepEqual(r.errors, []); assert.equal(r.data.deliveryDiscounts.threeWeeks.discountValue, 10); assert.equal(r.data.deliveryDiscounts.fiveWeeks.discountType, "FIXED_AMOUNT"); assert.equal(r.data.deliveryDiscounts.fiveWeeks.maxDiscountAmount, 3000); assert.equal(r.data.includeSpecialOrder, false);
});
t("delivery-only rule: applyToRegular=false needs no regular value", () => {
  const r = validateRuleInput({ ...base, applyToRegular: false, deliveryDiscounts: { threeWeeks: { enabled: true, discountType: "PERCENTAGE", discountValue: 15 }, fiveWeeks: { enabled: false } } });
  assert.deepEqual(r.errors, []); assert.equal(r.data.applyToRegular, false);
});
t("rule with nothing enabled is rejected", () => {
  const r = validateRuleInput({ ...base, applyToRegular: false, deliveryDiscounts: { threeWeeks: { enabled: false }, fiveWeeks: { enabled: false } } });
  assert.match(r.errors.join(" "), /at least one price/);
});
t("each price is validated with a clear label", () => {
  const r = validateRuleInput({ ...base, discountType: "PERCENTAGE", discountValue: 95, deliveryDiscounts: { threeWeeks: { enabled: true, discountType: "PERCENTAGE", discountValue: 0 }, fiveWeeks: { enabled: true, discountType: "PERCENTAGE", discountValue: 12.345 } } });
  const m = r.errors.join(" | "); assert.match(m, /regular price: percentage cannot exceed 90/); assert.match(m, /3-week delivery price: discount value/); assert.match(m, /5-week delivery price: percentage can have at most 2 decimal/);
});
t("disabled delivery prices ignore junk values", () => { const r = validateRuleInput({ ...base, discountType: "PERCENTAGE", discountValue: 10, deliveryDiscounts: { threeWeeks: { enabled: false, discountValue: "abc" } } }); assert.deepEqual(r.errors, []); assert.equal(r.data.deliveryDiscounts.threeWeeks.enabled, false); });
console.log(`rule validation: ${n} passed`);
