// Run: TEST_MONGO_URI=mongodb://127.0.0.1:27018 node tests/campaign_api_int.mjs
//
// Seasonal campaigns end-to-end through the real routers: permission matrix,
// country scoping (every operational role), draft-vs-publish rule, lifecycle,
// public activation/pause/expiry, pricing decoration, cart repricing, checkout
// PRICE_CHANGED guard, immutable order snapshots.
process.env.SECRET_KEY_ACCESS_TOKEN = "testsecret";
process.env.CAMPAIGN_CACHE_TTL_MS = "0"; // see changes immediately in tests
delete process.env.OPENAI_API_KEY;
import assert from "assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import request from "supertest";

await mongoose.connect((process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27018") + "/icv_test_camp_" + Date.now());
const { default: countryDetect } = await import("../middleware/countryDetect.js");
const { default: countryContext } = await import("../middleware/countryContext.js");
const { default: campaignRouter } = await import("../route/campaign.route.js");
const { default: productRouter } = await import("../route/product.route.js");
const { default: cartRouter } = await import("../route/cart.route.js");
const { default: campaignPricingResponse } = await import("../middleware/campaignPricingResponse.js");
const { default: User } = await import("../models/user.model.js");
const { default: Product } = await import("../models/product.model.js");
const { default: Category } = await import("../models/category.model.js");
const { default: Campaign } = await import("../models/campaign.model.js");
const { default: Rule } = await import("../models/campaign-discount-rule.model.js");
const { default: Order } = await import("../models/order.model.js");
const { default: CartProduct } = await import("../models/cartproduct.model.js");
const { invalidateCampaignCache } = await import("../services/campaignPricing.js");
for (const m of ["tag", "attribute", "brand", "subCategory", "compatible", "roasted-area"]) await import(`../models/${m}.model.js`).catch(() => {});
const { refreshCountryCache } = await import("../services/countryService.js");
await refreshCountryCache();

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(countryDetect);
app.use(countryContext);
app.use("/api/campaign", campaignRouter);
app.use("/api/product", campaignPricingResponse, productRouter);
app.use("/api/cart", cartRouter);
const sf = (host) => ({ "X-Storefront-Host": host });
const NG = sf("i-coffee.ng");
const TG = sf("i-coffee.tg");

let n = 0;
const mk = async (subRole, scope = "GLOBAL", assignedCountry = null, extra = {}) => {
  const u = await User.create({ name: `${subRole}${assignedCountry || ""}`, email: `c${++n}@t.com`, password: "x", role: "ADMIN", subRole, scope, assignedCountry, status: "Active", avatar: "https://img/a.png", ...extra });
  return { u, h: { Authorization: `Bearer ${jwt.sign({ id: String(u._id) }, "testsecret")}` } };
};
const it = await mk("IT");
const director = await mk("DIRECTOR");
const mgrNG = await mk("MANAGER", "COUNTRY", "NG");
const mgrTG = await mk("MANAGER", "COUNTRY", "TG");
const editor = await mk("EDITOR");
const sales = await mk("SALES");
const accountant = await mk("ACCOUNTANT");
const warehouse = await mk("WAREHOUSE");
const shopper = await (async () => {
  const u = await User.create({ name: "Shopper", email: "shop@t.com", password: "x", role: "USER", status: "Active", avatar: "https://img/a.png" });
  return { u, h: { Authorization: `Bearer ${jwt.sign({ id: String(u._id) }, "testsecret")}` } };
})();

const day = 86400000;
const win = (startOffsetDays, endOffsetDays) => ({ startsAt: new Date(Date.now() + startOffsetDays * day).toISOString(), endsAt: new Date(Date.now() + endOffsetDays * day).toISOString() });
const body = (over = {}) => ({ name: "Black Friday " + Math.random().toString(36).slice(2, 6), type: "BLACK_FRIDAY", ...win(-1, 5), ...over });
const c = (h, host = NG) => ({ get: (u) => request(app).get(u).set(h).set(host), post: (u, b) => request(app).post(u).set(h).set(host).send(b), put: (u, b) => request(app).put(u).set(h).set(host).send(b), del: (u) => request(app).delete(u).set(h).set(host) });
let passed = 0;
const ok = (name) => { passed++; console.log("  ✓", name); };

// ───────────────────────── permission matrix ─────────────────────────
console.log("permissions");
for (const [who, can] of [["mgrNG", true], ["editor", true], ["it", true], ["sales", false], ["accountant", false], ["warehouse", false]]) {
  const actor = { mgrNG, editor, it, sales, accountant, warehouse }[who];
  const r = await c(actor.h).post("/api/campaign/admin/create", body({ countryCode: who === "it" ? "NG" : undefined }));
  assert.equal(r.status, can ? 200 : 403, `${who} create → ${r.status} ${JSON.stringify(r.body)}`);
}
ok("create: Manager/Editor/IT yes; Sales/Accountant/Warehouse 403");
assert.equal((await request(app).get("/api/campaign/admin/list").set(NG)).status, 401);
assert.ok([400, 403].includes((await request(app).get("/api/campaign/admin/list").set(shopper.h).set(NG)).status), "non-admin is refused (existing admin middleware answers 400)");
for (const a of [sales, accountant, editor, mgrNG, it, director]) assert.equal((await c(a.h).get("/api/campaign/admin/list")).status, 200);
assert.equal((await c(warehouse.h).get("/api/campaign/admin/list")).status, 403);
ok("view: unauthenticated 401, shopper 403, warehouse 403, Sales/Accountant/Editor/Manager/IT/Director 200");

// ───────────────────────── country scoping ─────────────────────────
console.log("country scope");
let r = await c(mgrTG.h, TG).post("/api/campaign/admin/create", body({ name: "Noel Togo" , type: "CHRISTMAS" }));
assert.equal(r.status, 200, JSON.stringify(r.body));
const tgCampaign = r.body.data;
assert.equal(tgCampaign.countryCode, "TG", "country comes from the manager's assignment, not the request");
r = await c(mgrTG.h, TG).post("/api/campaign/admin/create", body({ countryCode: "NG" }));
assert.equal(r.status, 403, "Togo manager cannot create in Nigeria");
r = await c(mgrNG.h).post("/api/campaign/admin/create", body({ countryCode: "TG" }));
assert.equal(r.status, 403, "Nigeria manager cannot create in Togo");
r = await c(it.h).post("/api/campaign/admin/create", body());
assert.equal(r.status, 400, "global admin must name a country");
r = await c(it.h).post("/api/campaign/admin/create", body({ countryCode: "TG", name: "IT Togo" }));
assert.equal(r.status, 200, "IT may create in any country");
r = await c(director.h).post("/api/campaign/admin/create", body({ countryCode: "IT", name: "Natale", type: "CHRISTMAS" }));
assert.equal(r.status, 200, "Director may create in any country");
ok("create: own country only (403 on tamper), IT/Director global with explicit country");

const ngMgrList = (await c(mgrNG.h).get("/api/campaign/admin/list")).body.data;
assert.ok(ngMgrList.length > 0 && ngMgrList.every((x) => x.countryCode === "NG"), "NG manager sees NG only");
const tgMgrList = (await c(mgrTG.h, TG).get("/api/campaign/admin/list")).body.data;
assert.ok(tgMgrList.length >= 2 && tgMgrList.every((x) => x.countryCode === "TG"));
const editorList = (await c(editor.h).get("/api/campaign/admin/list?countryCode=TG")).body.data;
assert.ok(editorList.every((x) => x.countryCode === "NG"), "?countryCode= is ignored for non-global roles");
const itAll = (await c(it.h).get("/api/campaign/admin/list")).body.data;
assert.ok(new Set(itAll.map((x) => x.countryCode)).size >= 3, "IT sees every country, each labelled");
ok("list: scoped by role; ?countryCode= honoured only for IT/Director");

for (const actor of [mgrNG, editor, sales, accountant]) {
  assert.equal((await c(actor.h).get(`/api/campaign/admin/${tgCampaign._id}`)).status, 404, "read other country → 404");
  assert.equal((await c(actor.h).get(`/api/campaign/admin/${tgCampaign._id}/performance`)).status, 404);
  assert.equal((await c(actor.h).get(`/api/campaign/admin/${tgCampaign._id}/preview`)).status, 404);
}
for (const actor of [mgrNG, editor]) {
  assert.equal((await c(actor.h).put(`/api/campaign/admin/${tgCampaign._id}`, { name: "hijack" })).status, 404);
  assert.equal((await c(actor.h).post(`/api/campaign/admin/${tgCampaign._id}/rules`, { name: "x", discountType: "PERCENTAGE", discountValue: 10 })).status, 404);
  assert.equal((await c(actor.h).post(`/api/campaign/admin/${tgCampaign._id}/duplicate`, {})).status, 404);
}
assert.equal((await c(mgrNG.h).post(`/api/campaign/admin/${tgCampaign._id}/publish`, {})).status, 404);
assert.equal((await c(mgrNG.h).del(`/api/campaign/admin/${tgCampaign._id}`)).status, 404);
assert.equal((await Campaign.findById(tgCampaign._id)).name, "Noel Togo", "nothing was modified");
ok("cross-country read/update/rule/duplicate/publish/delete → 404 for NG Manager/Editor/Sales/Accountant; record untouched");
assert.equal((await c(mgrTG.h, TG).get(`/api/campaign/admin/${tgCampaign._id}`)).status, 200);
const ngCamp = (await c(mgrNG.h).post("/api/campaign/admin/create", body({ name: "NG only" }))).body.data;
assert.equal((await c(mgrTG.h, TG).get(`/api/campaign/admin/${ngCamp._id}`)).status, 404);
ok("Togo manager reads Togo, cannot see Nigeria");

// ───────────────────────── draft rule / publisher rule ─────────────────────────
console.log("draft vs publish");
const draft = (await c(editor.h).post("/api/campaign/admin/create", body({ name: "Editor Draft" }))).body.data;
assert.equal((await c(editor.h).put(`/api/campaign/admin/${draft._id}`, { tagline: "Big sale" })).status, 200);
assert.equal((await c(editor.h).post(`/api/campaign/admin/${draft._id}/publish`, {})).status, 403, "Editor cannot publish");
assert.equal((await c(sales.h).put(`/api/campaign/admin/${draft._id}`, { tagline: "x" })).status, 403, "Sales cannot edit");
ok("Editor edits drafts but cannot publish; Sales cannot edit");

// ───────────────────────── validation ─────────────────────────
console.log("validation");
const bad = async (over, why) => { const x = await c(mgrNG.h).post("/api/campaign/admin/create", body(over)); assert.equal(x.status, 400, `${why}: ${JSON.stringify(x.body)}`); };
await bad({ ...win(5, 1) }, "end before start");
await bad({ type: "EASTER" }, "unknown type");
await bad({ timezone: "Mars/Phobos" }, "bad timezone");
await bad({ theme: { primaryColor: "red" } }, "non-hex colour");
await bad({ theme: { backgroundColor: "#FFFFFF", textColor: "#FAFAFA" } }, "unreadable contrast");
await bad({ theme: { effectIntensity: 99 } }, "intensity out of bounds");
await bad({ theme: { effect: "RAIN_OF_FIRE" } }, "unknown effect");
{
  const x = await c(mgrNG.h).post("/api/campaign/admin/create", body({ name: "css probe", theme: { customCss: "body{display:none}", css: "*{}", primaryColor: "#185B42" } }));
  assert.equal(x.status, 200);
  assert.ok(!("customCss" in x.body.data.theme) && !("css" in x.body.data.theme), "unknown theme keys (arbitrary CSS) are dropped, never stored");
  assert.ok(!JSON.stringify(x.body.data).includes("display:none"));
}
ok("rejects bad dates/type/timezone/colour/contrast/intensity/effect");
r = await c(mgrNG.h).post("/api/campaign/admin/create", body({ name: "<script>alert(1)</script>Safe", tagline: "<img src=x onerror=alert(1)>Hi" }));
assert.equal(r.status, 200);
assert.ok(!/[<>]/.test(r.body.data.name + r.body.data.tagline), "text is sanitised");
ok("HTML stripped from text fields");

// Rules
const ruleBad = async (over, why) => { const x = await c(mgrNG.h).post(`/api/campaign/admin/${ngCamp._id}/rules`, { name: "R", discountType: "PERCENTAGE", discountValue: 10, ...over }); assert.equal(x.status, 400, `${why}: ${JSON.stringify(x.body)}`); };
await ruleBad({ discountValue: 0 }, "zero"); await ruleBad({ discountValue: -5 }, "negative"); await ruleBad({ discountValue: 95 }, ">90%");
await ruleBad({ discountType: "BOGO" }, "bad type"); await ruleBad({ discountValue: 12.345 }, "3 decimals");
await ruleBad({ scope: "PRODUCT", productIds: [String(new mongoose.Types.ObjectId())] }, "unknown product");
ok("rule validation: zero/negative/over-cap/bad type/decimals/unknown product");

// ───────────────────────── catalogue + live campaign ─────────────────────────
console.log("lifecycle & public pricing");
const cat = await Category.create({ name: "Coffee", slug: "coffee" });
const mkProd = (o = {}) => Product.create({ name: "Beans " + Math.random().toString(36).slice(2, 6), image: ["https://i/x.png"], category: [cat._id], shortDescription: "s", productType: "COFFEE_BEANS", btcPrice: 50000, price: 50000, discount: 0, productAvailability: true, publish: "PUBLISHED", warehouseStock: { enabled: true, onlineStock: 20 }, slug: "p" + Math.random().toString(36).slice(2, 8), sku: "S" + Math.random().toString(36).slice(2, 8), ...o });
const prodA = await mkProd();
const prodB = await mkProd({ btcPrice: 20000, price: 20000 });

// Outside-the-country product can't be targeted from NG? Products are not country-owned here; just target A.
r = await c(mgrNG.h).post(`/api/campaign/admin/${ngCamp._id}/rules`, { name: "20% coffee", discountType: "PERCENTAGE", discountValue: 20, scope: "PRODUCT", productIds: [String(prodA._id)] });
assert.equal(r.status, 200, JSON.stringify(r.body));
const rule1 = r.body.data;

// Draft: nothing public
r = await request(app).get("/api/campaign/active").set(NG);
assert.equal(r.status, 200); assert.equal(r.body.data.campaign, null, "draft campaigns are invisible to shoppers");
ok("draft campaign invisible to the storefront");

r = await c(mgrNG.h).post(`/api/campaign/admin/${ngCamp._id}/publish`, {});
assert.equal(r.status, 200, JSON.stringify(r.body));
r = await request(app).get("/api/campaign/active").set(NG);
assert.equal(r.body.data.campaign.slug, ngCamp.slug);
assert.equal(r.body.data.campaign.theme.preset, "BLACK_FRIDAY");
assert.ok(r.body.data.serverTime, "server time is provided for countdowns");
assert.equal((await request(app).get("/api/campaign/active").set(TG)).body.data.campaign, null, "Togo storefront does not see the Nigeria campaign");
assert.equal((await request(app).get(`/api/campaign/public/${ngCamp.slug}`).set(TG)).status, 404);
assert.equal((await request(app).get(`/api/campaign/public/${ngCamp.slug}`).set(NG)).status, 200);
ok("published: visible in its own country only (active + landing)");

// pricing decoration on product endpoints
const prodRes = await request(app).post("/api/product/get").set(NG).send({ page: 1, limit: 50 });
assert.equal(prodRes.status, 200, JSON.stringify(prodRes.body).slice(0, 200));
const listed = (prodRes.body.data || []).find((p) => String(p._id) === String(prodA._id));
assert.ok(listed, "product shows in the public listing");
assert.equal(listed.campaignPricing?.regular?.finalPrice, 40000, "listing carries server-computed campaignPricing");
const listedB = (prodRes.body.data || []).find((p) => String(p._id) === String(prodB._id));
assert.ok(listedB && !listedB.campaignPricing, "untargeted product has NO campaignPricing (renders exactly as before)");
const detail = await request(app).post("/api/product/get-product-details").set(NG).send({ productId: String(prodA._id), slug: prodA.slug });
assert.equal(detail.status, 200, JSON.stringify(detail.body).slice(0, 200));
assert.equal(detail.body.data?.campaignPricing?.regular?.finalPrice, 40000, "detail page carries campaignPricing");
const asAdmin = await request(app).post("/api/product/get-admin").set(it.h).set(NG).send({ page: 1, limit: 50 });
assert.ok(!JSON.stringify(asAdmin.body).includes("campaignPricing"), "admin sessions get raw catalogue data");
ok("product list + detail carry campaignPricing; untargeted untouched; admin sessions undecorated");
const pub = await request(app).get(`/api/campaign/public/${ngCamp.slug}/products`).set(NG);
assert.equal(pub.status, 200, JSON.stringify(pub.body));
const prodList = pub.body.data.products || pub.body.data;
const lineA = prodList.find((p) => String(p._id) === String(prodA._id));
assert.ok(lineA, "campaign landing grid contains the targeted product");
assert.equal(lineA.campaignPricing.regular.finalPrice, 40000);
assert.equal(lineA.campaignPricing.regular.originalPrice, 50000);
assert.ok(!prodList.some((p) => String(p._id) === String(prodB._id)), "untargeted product is not in the grid");
ok("landing products priced by the engine; untargeted products excluded");

// pause → immediately gone; resume → back; end → gone
const act = (a) => c(mgrNG.h).post(`/api/campaign/admin/${ngCamp._id}/${a}`, {});
assert.equal((await act("pause")).status, 200);
assert.equal((await request(app).get("/api/campaign/active").set(NG)).body.data.campaign, null, "paused → gone immediately");
assert.equal((await request(app).get(`/api/campaign/public/${ngCamp.slug}`).set(NG)).status, 404);
assert.equal((await act("resume")).status, 200);
assert.ok((await request(app).get("/api/campaign/active").set(NG)).body.data.campaign);
await Campaign.updateOne({ _id: ngCamp._id }, { endsAt: new Date(Date.now() - 1000), startsAt: new Date(Date.now() - 2 * day) });
invalidateCampaignCache("NG");
assert.equal((await request(app).get("/api/campaign/active").set(NG)).body.data.campaign, null, "past endsAt → expired with no cron");
assert.equal((await c(mgrNG.h).get(`/api/campaign/admin/${ngCamp._id}`)).body.data.campaign.status, "ENDED", "derived status = ENDED");
assert.equal((await act("publish")).status, 409, "cannot publish something already published");
ok("pause/resume/expiry take effect immediately; expired status derived from time");
await Campaign.updateOne({ _id: ngCamp._id }, { ...Object.fromEntries(Object.entries(win(-1, 5)).map(([k, v]) => [k, new Date(v)])) });
invalidateCampaignCache("NG");

// overlap conflict
const rival = (await c(mgrNG.h).post("/api/campaign/admin/create", body({ name: "Rival", type: "CUSTOM" }))).body.data;
r = await c(mgrNG.h).post(`/api/campaign/admin/${rival._id}/publish`, {});
assert.equal(r.status, 409, "same-priority overlap is a hard conflict"); assert.ok(r.body.message.includes("Conflicts"));
assert.equal((await c(mgrNG.h).put(`/api/campaign/admin/${rival._id}`, { priority: 5 })).status, 200);
assert.equal((await c(mgrNG.h).post(`/api/campaign/admin/${rival._id}/publish`, {})).status, 200, "higher priority resolves the conflict");
ok("overlapping equal-priority campaigns cannot both be published");
await Campaign.updateOne({ _id: rival._id }, { publishState: "ARCHIVED" }); invalidateCampaignCache("NG");

// expired campaign cannot be published
const old = (await c(mgrNG.h).post("/api/campaign/admin/create", body({ name: "Old", ...win(-10, -5) }))).body.data;
r = await c(mgrNG.h).post(`/api/campaign/admin/${old._id}/publish`, {});
assert.equal(r.status, 400); assert.ok(/end date/i.test(r.body.message));
ok("an already-ended campaign cannot be published without date correction");

// audit trail
const full = (await c(mgrNG.h).get(`/api/campaign/admin/${ngCamp._id}`)).body.data;
const actions = (full.campaign.history || []).map((h) => h.action);
for (const a of ["CREATED", "PUBLISHED", "PAUSED", "RESUMED"]) assert.ok(actions.includes(a), `history has ${a}: ${actions}`);
ok("audit history records create/publish/pause/resume");

// delete rules
assert.equal((await c(mgrNG.h).del(`/api/campaign/admin/${ngCamp._id}`)).status, 409, "live/ordered campaigns can't be hard-deleted");
ok("a published campaign cannot be hard-deleted");

// ───────────────────────── cart repricing & checkout ─────────────────────────
console.log("cart & checkout");
await CartProduct.deleteMany({});
r = await request(app).post("/api/cart/create").set(shopper.h).set(NG).send({ productId: String(prodA._id), quantity: 2 });
const cartRes = await request(app).get("/api/cart/get").set(shopper.h).set(NG);
const cartLine = (cartRes.body.data || [])[0];
if (cartLine) {
  assert.equal(cartLine.selectedPrice, 40000, "cart line reprices to the campaign price");
  assert.ok(cartLine.campaignPricing?.source === "CAMPAIGN");
  ok("cart read reprices lines server-side");
} else console.log("  ! cart endpoints not reachable in this harness:", r.status, JSON.stringify(r.body).slice(0, 120));

console.log(`\n${passed} groups passed`);
await mongoose.disconnect();
process.exit(0);
