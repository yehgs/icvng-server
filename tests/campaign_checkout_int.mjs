// Run: TEST_MONGO_URI=mongodb://127.0.0.1:27018 node tests/campaign_checkout_int.mjs
//
// Checkout integrity with seasonal campaigns: the server reprices from the DB,
// rejects stale carts with 409 PRICE_CHANGED, writes an immutable per-line
// campaign snapshot, and never retro-changes an order when the campaign is
// edited or ended afterwards.
process.env.SECRET_KEY_ACCESS_TOKEN = "testsecret";
process.env.CAMPAIGN_CACHE_TTL_MS = "0";
process.env.PAYSTACK_SECRET_KEY = "sk_test_dummy";
delete process.env.OPENAI_API_KEY;
import assert from "assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import request from "supertest";

await mongoose.connect((process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27018") + "/icv_test_chk_" + Date.now());
const { default: countryDetect } = await import("../middleware/countryDetect.js");
const { default: countryContext } = await import("../middleware/countryContext.js");
const { default: orderRouter } = await import("../route/order.route.js");
const { default: campaignRouter } = await import("../route/campaign.route.js");
const { default: User } = await import("../models/user.model.js");
const { default: Product } = await import("../models/product.model.js");
const { default: Category } = await import("../models/category.model.js");
const { default: Campaign } = await import("../models/campaign.model.js");
const { default: Rule } = await import("../models/campaign-discount-rule.model.js");
const { default: Order } = await import("../models/order.model.js");
const { default: CartProduct } = await import("../models/cartproduct.model.js");
const { default: BankTransferSettings } = await import("../models/bankTransferSettings.model.js");
const { invalidateCampaignCache } = await import("../services/campaignPricing.js");
for (const m of ["tag", "attribute", "brand", "subCategory", "compatible", "roasted-area", "address"]) await import(`../models/${m}.model.js`).catch(() => {});
const { refreshCountryCache } = await import("../services/countryService.js");
await refreshCountryCache();

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(countryDetect);
app.use(countryContext);
app.use("/api/order", orderRouter);
app.use("/api/campaign", campaignRouter);
const NG = { "X-Storefront-Host": "i-coffee.ng" };

const admin = await User.create({ name: "Mgr", email: "m@t.com", password: "x", role: "ADMIN", subRole: "MANAGER", scope: "COUNTRY", assignedCountry: "NG", status: "Active", avatar: "https://img/a.png" });
const AH = { Authorization: `Bearer ${jwt.sign({ id: String(admin._id) }, "testsecret")}` };
const user = await User.create({ name: "Shopper", email: "s@t.com", password: "x", role: "USER", status: "Active", avatar: "https://img/a.png" });
const H = { Authorization: `Bearer ${jwt.sign({ id: String(user._id) }, "testsecret")}` };
await BankTransferSettings.create({ countryCode: "NG", currencyCode: "NGN", updatedBy: user._id, createdBy: user._id, isActive: true, bankName: "B", accountName: "A", accountNumber: "0123456789" });

const cat = await Category.create({ name: "Coffee", slug: "coffee" });
const product = await Product.create({ name: "Beans", image: ["https://i/x.png"], category: [cat._id], shortDescription: "s", productType: "COFFEE_BEANS", btcPrice: 50000, price: 50000, discount: 0, productAvailability: true, publish: "PUBLISHED", warehouseStock: { enabled: true, onlineStock: 20 }, slug: "beans", sku: "B1" });

const day = 86400000;
const campaign = await Campaign.create({ name: "Black Friday", slug: "bf", type: "BLACK_FRIDAY", countryCode: "NG", publishState: "PUBLISHED", startsAt: new Date(Date.now() - day), endsAt: new Date(Date.now() + 5 * day), timezone: "Africa/Lagos", createdBy: user._id });
const rule = await Rule.create({ campaignId: campaign._id, countryCode: "NG", name: "20% off", discountType: "PERCENTAGE", discountValue: 20, scope: "PRODUCT", productIds: [product._id], status: "ACTIVE", createdBy: user._id });
invalidateCampaignCache("NG");

let passed = 0;
const ok = (m) => { passed++; console.log("  ✓", m); };
const fillCart = async (selectedPrice) => {
  await CartProduct.deleteMany({ userId: user._id });
  await CartProduct.create({ userId: user._id, productId: product._id, quantity: 2, priceOption: "regular", selectedPrice });
};
const bank = (subTotalAmt, extra = {}) => request(app).post("/api/order/direct-bank-transfer").set(H).set(NG).send({ subTotalAmt, totalAmt: subTotalAmt, shippingCost: 0, currency: "NGN", bankDetails: { reference: "ref" }, ...extra });

console.log("PRICE_CHANGED guard");
await fillCart(50000);
let r = await bank(100000); // shopper still sees the OLD un-discounted subtotal (2 × 50,000)
assert.equal(r.status, 409, JSON.stringify(r.body));
assert.equal(r.body.code, "PRICE_CHANGED");
assert.equal(r.body.data.serverSubtotal, 80000);
assert.equal(await Order.countDocuments(), 0, "no order was created from a stale cart");
ok("bank transfer: stale (undiscounted) subtotal → 409 PRICE_CHANGED, no order created");

r = await request(app).post("/api/order/paystack-payment").set(H).set(NG).send({ totalAmt: 100000, shippingCost: 0, currency: "NGN" });
assert.equal(r.status, 409, JSON.stringify(r.body));
assert.equal(r.body.code, "PRICE_CHANGED");
ok("paystack: client total 100,000 vs server 80,000 → 409 before any gateway call");

r = await request(app).post("/api/order/cinetpay-payment").set(H).set(NG).send({ totalAmt: 100000, originalAmounts: { subTotalAmt: 100000 }, currency: "XOF" });
assert.ok([400, 409].includes(r.status), "CinetPay is not configured for NG so it refuses earlier");
ok("cinetpay: not offered in NG (refused before pricing)");

console.log("order creation");
r = await bank(80000);
assert.equal(r.status, 200, JSON.stringify(r.body));
const order = await Order.findOne({}).lean();
assert.equal(order.unitPrice, 40000, "unit price is the campaign price");
assert.equal(order.subTotalAmt, 80000);
assert.ok(order.campaignSnapshot, "snapshot stored on the order line");
assert.equal(String(order.campaignSnapshot.campaignId), String(campaign._id));
assert.equal(String(order.campaignSnapshot.ruleId), String(rule._id));
assert.deepEqual([order.campaignSnapshot.originalUnitPrice, order.campaignSnapshot.discountPerUnit, order.campaignSnapshot.finalUnitPrice], [50000, 10000, 40000]);
assert.equal(order.campaignSnapshot.campaignType, "BLACK_FRIDAY");
ok("order stores campaign price, totals and a full price-breakdown snapshot");

console.log("performance report");
{
  const perf = await request(app).get(`/api/campaign/admin/${campaign._id}/performance`).set(AH).set(NG);
  assert.equal(perf.status, 200, JSON.stringify(perf.body));
  assert.deepEqual([perf.body.data.totals.orderLines, perf.body.data.totals.units, perf.body.data.totals.discountGiven, perf.body.data.totals.revenue], [1, 2, 20000, 80000]);
  assert.equal(perf.body.data.byRule[0].ruleName, "20% off");
  ok("performance aggregates the order snapshots (1 line, 2 units, ₦20,000 discount, ₦80,000 revenue)");
  const sel = await request(app).get("/api/campaign/admin/selector/products?q=Bea").set(AH).set(NG);
  assert.equal(sel.status, 200, JSON.stringify(sel.body)); assert.equal(sel.body.data[0].name, "Beans");
  assert.equal((await request(app).get("/api/campaign/admin/selector/nope").set(AH).set(NG)).status, 404);
  ok("product selector works and unknown selectors 404");
}

console.log("immutability");
await Rule.updateOne({ _id: rule._id }, { discountValue: 50, name: "EDITED" });
await Campaign.updateOne({ _id: campaign._id }, { publishState: "PAUSED", name: "Renamed" });
invalidateCampaignCache("NG");
const again = await Order.findOne({}).lean();
assert.equal(again.unitPrice, 40000); assert.equal(again.campaignSnapshot.finalUnitPrice, 40000);
assert.equal(again.campaignSnapshot.campaignName, "Black Friday"); assert.equal(again.campaignSnapshot.ruleName, "20% off");
ok("editing/pausing the campaign afterwards does not alter the placed order");

console.log("no campaign → legacy behaviour");
await fillCart(50000);
r = await bank(100000); // campaign paused → full price is now correct
assert.equal(r.status, 200, JSON.stringify(r.body));
const plain = (await Order.find({}).sort({ createdAt: -1 }).lean())[0];
assert.equal(plain.unitPrice, 50000); assert.equal(plain.campaignSnapshot ?? null, null);
ok("with the campaign paused the same cart is charged full price, no snapshot");

console.log("standing product discount still works");
await Product.updateOne({ _id: product._id }, { discount: 10 });
await fillCart(45000);
r = await bank(90000);
assert.equal(r.status, 200, JSON.stringify(r.body));
const legacy = (await Order.find({}).sort({ createdAt: -1 }).lean())[0];
assert.equal(legacy.unitPrice, 45000); assert.equal(legacy.campaignSnapshot ?? null, null);
ok("10% standing discount → 45,000 exactly as before campaigns existed");

console.log(`\n${passed} checks passed`);
await mongoose.disconnect();
process.exit(0);
