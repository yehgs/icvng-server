// Run: TEST_MONGO_URI=mongodb://127.0.0.1:27017 node tests/chat_catalogue_int.mjs  (needs `npm i -D supertest`)
process.env.SECRET_KEY_ACCESS_TOKEN = "testsecret";
process.env.OPENAI_API_KEY = "sk-test-0000000000";
import assert from "assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import request from "supertest";

await mongoose.connect((process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27018") + "/icv_test_" + Date.now());
const { default: countryDetect } = await import("../middleware/countryDetect.js");
const { default: countryContext } = await import("../middleware/countryContext.js");
const { default: catalogueRouter } = await import("../route/catalogue.route.js");
const { default: chatRouter } = await import("../route/chat.route.js");
const { default: chatAdminRouter } = await import("../route/chat-admin.route.js");
const { default: User } = await import("../models/user.model.js");
const { default: Product } = await import("../models/product.model.js");
const { default: Category } = await import("../models/category.model.js");
const { default: Brand } = await import("../models/brand.model.js");
const { default: Translation } = await import("../models/translation.model.js");
const { default: ExchangeRate } = await import("../models/exchange-rate.model.js");
const { default: Notification } = await import("../models/notification.model.js");
const { default: Conv } = await import("../models/chat-conversation.model.js");
const { getOpenAIClient } = await import("../services/ai/openaiTranslationClient.js");
const { refreshCountryCache } = await import("../services/countryService.js");
await refreshCountryCache();

const app = express();
app.use(express.json()); app.use(cookieParser()); app.use(countryDetect); app.use(countryContext);
app.use("/api/admin/catalogue", catalogueRouter);
app.use("/api/chat", chatRouter);
app.use("/api/admin/chat", chatAdminRouter);

// ── fixtures ─────────────────────────────────────────────────────────────────
let n = 0;
const mk = async (subRole, scope = "GLOBAL", assignedCountry = null, extra = {}) => {
  const u = await User.create({ name: `${subRole} ${assignedCountry || "HQ"}`, email: `u${++n}@t.com`, password: "x", role: "ADMIN", subRole, scope, assignedCountry, status: "Active", avatar: `https://img/${subRole}.png`, ...extra });
  return { u, h: { Authorization: `Bearer ${jwt.sign({ id: String(u._id) }, "testsecret")}` } };
};
const hqSales = await mk("SALES"), hqMgr = await mk("MANAGER"), it = await mk("IT"), dir = await mk("DIRECTOR"), acct = await mk("ACCOUNTANT");
const tgMgr = await mk("MANAGER", "COUNTRY", "TG"), tgSales = await mk("SALES", "COUNTRY", "TG");

await ExchangeRate.create({ baseCurrency: "NGN", targetCurrency: "XOF", rate: 0.4, source: "MANUAL", updatedBy: it.u._id });
const cat = await Category.create({ name: "Coffee Beans", slug: "beans" });
const brand = await Brand.create({ name: "Lavazza", slug: "lavazza" });
const brand2 = await Brand.create({ name: "Illy", slug: "illy" });
const p1 = await Product.create({ name: "Espresso Intenso", slug: "esp", sku: "S1", category: cat._id, brand: [brand._id], productType: "COFFEE_BEANS", price: 10000, btcPrice: 10000, btbPrice: 8000, publish: "PUBLISHED", warehouseStock: { enabled: true, onlineStock: 5 }, description: "<p>Rich &amp; bold</p>" });
const p2 = await Product.create({ name: "Hidden NG only", slug: "ng", sku: "S2", category: cat._id, brand: [brand2._id], productType: "TEA", price: 5000, btcPrice: 5000, publish: "PUBLISHED", visibleInCountries: ["NG"] });
await Product.create({ name: "Draft thing", slug: "dr", sku: "S3", category: cat._id, price: 100, publish: "DRAFT" });
await Translation.create({ entityType: "product", entityId: p1._id, language: "fr", fields: { name: "Espresso Intense", description: "Riche et corsé" } });

// ── catalogue ────────────────────────────────────────────────────────────────
let r = await request(app).get("/api/admin/catalogue/options");
assert.equal(r.status, 401);
r = await request(app).get("/api/admin/catalogue/options").set(tgMgr.h);
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.deepEqual([r.body.data.context.countryCode, r.body.data.context.language, r.body.data.context.currency.code, r.body.data.context.locked, r.body.data.context.rate], ["TG", "fr", "XOF", true, 0.4]);
assert.ok(!r.body.data.fields.some((f) => f.key === "btbPrice"), "foreign manager must not get B2B field");
assert.equal(r.body.data.countries.length, 1);

r = await request(app).post("/api/admin/catalogue/preview").set(tgMgr.h).send({ country: "NG", language: "en" });
assert.equal(r.body.data.context.countryCode, "TG", "foreign admin cannot override country");
assert.equal(r.body.data.total, 1, "NG-only product hidden for TG; draft excluded");
assert.equal(r.body.data.sample[0].name, "Espresso Intense");
assert.equal(r.body.data.sample[0].price, 4000); // 10000 NGN * 0.4

r = await request(app).post("/api/admin/catalogue/pdf").set(tgMgr.h).send({ fields: { image: false } }).buffer().parse((res, cb) => { const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); });
assert.equal(r.status, 200); assert.match(r.headers["content-type"], /application\/pdf/); assert.equal(r.body.slice(0, 4).toString(), "%PDF"); assert.match(r.headers["content-disposition"], /catalogue-TG-fr-/);

assert.equal((await request(app).post("/api/admin/catalogue/pdf").set(tgSales.h).send({})).status, 403, "foreign sales denied");
assert.equal((await request(app).post("/api/admin/catalogue/pdf").set(acct.h).send({})).status, 403, "accountant denied");
r = await request(app).post("/api/admin/catalogue/preview").set(hqSales.h).send({});
assert.equal(r.body.data.context.countryCode, "NG"); assert.equal(r.body.data.total, 2);
r = await request(app).post("/api/admin/catalogue/preview").set(hqSales.h).send({ filters: { brands: [String(brand2._id)] } });
assert.equal(r.body.data.total, 1);
r = await request(app).post("/api/admin/catalogue/preview").set(dir.h).send({ country: "TG", filters: { priceMin: 3000, priceMax: 5000 } });
assert.equal(r.body.data.context.currency.code, "XOF"); assert.equal(r.body.data.total, 1);
r = await request(app).post("/api/admin/catalogue/preview").set(it.h).send({ country: "IT" });
assert.equal(r.status, 422); assert.equal(r.body.code, "NO_EXCHANGE_RATE");
console.log("catalogue ✓");
// ── brochure ─────────────────────────────────────────────────────────────────
const bin = (res, cb) => { const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); };
r = await request(app).get("/api/admin/catalogue/options").set(tgMgr.h);
assert.ok(r.body.data.brochure.fields.every((f) => !["btbPrice", "stockQty", "deliveryPrices", "productType"].includes(f.key)), "internal fields never offered in brochure");
assert.deepEqual(r.body.data.brochure.fields.filter((f) => f.default).map((f) => f.key).sort(), ["brand", "image", "price", "shortDescription"], "minimal defaults");
assert.ok(r.body.data.brochure.contacts.some((c) => c.id === String(tgMgr.u._id)), "TG manager is a TG sales contact");
assert.equal(r.body.data.brochure.defaultContactId, String(tgMgr.u._id));
assert.ok(!r.body.data.brochure.contacts.some((c) => c.id === String(hqSales.u._id)), "HQ sales is not a TG contact");
r = await request(app).post("/api/admin/catalogue/brochure?inline=1").set(tgMgr.h).send({ country: "NG", brochure: { title: "Hôtel offer", preparedFor: "Hôtel Le Lac" } }).buffer().parse(bin);
assert.equal(r.status, 200, r.body.toString().slice(0, 200)); assert.equal(r.body.slice(0, 4).toString(), "%PDF");
assert.match(r.headers["content-disposition"], /^inline; filename="brochure-TG-fr-/); assert.equal(r.headers["x-catalogue-count"], "1");
r = await request(app).post("/api/admin/catalogue/brochure").set(tgMgr.h).send({ contactUserId: String(hqSales.u._id) });
assert.equal(r.status, 400); assert.equal(r.body.code, "BAD_CONTACT");
r = await request(app).post("/api/admin/catalogue/brochure").set(tgSales.h).send({}); assert.equal(r.status, 403);
r = await request(app).post("/api/admin/catalogue/brochure").set(hqSales.h).send({ contact: { none: true }, brochure: { layout: "list", cover: false, backCover: false }, fields: { image: false, price: false } }).buffer().parse(bin);
assert.equal(r.status, 200); assert.match(r.headers["content-disposition"], /^attachment; filename="brochure-NG-/); assert.equal(r.headers["x-catalogue-count"], "2");
console.log("brochure ✓");


// ── chat ─────────────────────────────────────────────────────────────────────
const ai = getOpenAIClient();
let aiScript = [];
ai.responses.create = async () => { const next = aiScript.shift(); if (next === "FAIL") throw new Error("boom"); return { output_text: JSON.stringify({ reply: "ok", action: "none", escalate_to: null, reason: "", summary: "", captured_name: null, captured_email: null, captured_whatsapp: null, ...next }) }; };

const pub = (m, p) => request(app)[m]("/api/chat" + p).set("x-app-country", "TG");
r = await pub("get", "/config?language=fr");
assert.equal(r.body.data.countryCode, "TG"); assert.match(r.body.data.welcome, /Bonjour/);

r = await pub("post", "/conversations").send({ visitorId: "dev-1", language: "fr", channel: "mobile" });
assert.equal(r.status, 200, JSON.stringify(r.body));
const cid = r.body.data.conversation.id, tok = r.body.data.token;
assert.equal(r.body.data.conversation.countryCode, "TG"); assert.match(r.body.data.messages[0].text, /Bonjour/);
const H = { "x-chat-token": tok };

assert.equal((await pub("get", `/conversations/${cid}`).set("x-chat-token", "bad")).status, 404);

aiScript = [{ reply: "Voici nos cafés.", action: "none" }];
r = await pub("post", `/conversations/${cid}/messages`).set(H).send({ text: "Bonjour, prix du café Espresso ?" });
assert.equal(r.body.data.messages.at(-1).text, "Voici nos cafés."); assert.equal(r.body.data.conversation.waitingForAgent, false);
assert.equal((await Notification.countDocuments({ type: "CHAT" })) >= 1, true, "'user on chat' notification on first message");

// AI wants to escalate, but contact unknown → asks for contact first
aiScript = [{ reply: "Je vous passe un conseiller.", action: "escalate", escalate_to: "sales", reason: "wants human", summary: "Wants a person" }];
r = await pub("post", `/conversations/${cid}/messages`).set(H).send({ text: "Je veux parler à un humain" });
assert.equal(r.body.data.conversation.waitingForAgent, false);
assert.match(r.body.data.messages.at(-1).text, /e-mail|WhatsApp/);

aiScript = [{ reply: "Merci, un conseiller arrive.", action: "escalate", escalate_to: "sales", reason: "wants human", summary: "Wants a person; asked price" }];
r = await pub("post", `/conversations/${cid}/messages`).set(H).send({ text: "mon email est kofi@example.com et whatsapp 90 12 34 56 ; ou +228 90 12 34 56" });
assert.equal(r.body.data.conversation.waitingForAgent, true);
assert.equal(r.body.data.conversation.visitor.email, "kofi@example.com");
assert.equal(r.body.data.conversation.visitor.whatsapp, "+22890123456");
assert.ok(r.body.data.messages.some((m) => m.kind === "escalation"));

// notifications routed to TG sales/sales-manager (COUNTRY) + IT/DIRECTOR (HQ_ONLY)
const ns = await Notification.find({ type: "CHAT", title: /needs/i }).lean();
assert.ok(ns.some((x) => x.targetScope === "COUNTRY" && x.targetCountry === "TG" && x.targetRoles.includes("SALES")));
assert.ok(ns.some((x) => x.targetScope === "HQ_ONLY" && x.targetRoles.includes("IT") && x.targetRoles.includes("DIRECTOR")));
assert.ok(!ns.some((x) => x.targetRoles.includes("MANAGER") && x.targetScope === "COUNTRY"), "manager not paged for a sales escalation");

// scoping
const list = async (who) => (await request(app).get("/api/admin/chat/conversations").set(who.h)).body.data.map((c) => c.id);
assert.deepEqual(await list(tgSales), [cid]); assert.deepEqual(await list(tgMgr), [cid]);
assert.deepEqual(await list(it), [cid]); assert.deepEqual(await list(dir), [cid]);
assert.deepEqual(await list(hqSales), [], "HQ roles only see HQ-country chats"); assert.deepEqual(await list(hqMgr), []);
assert.equal((await request(app).get(`/api/admin/chat/conversations/${cid}`).set(hqSales.h)).status, 404);
assert.equal((await request(app).post(`/api/admin/chat/conversations/${cid}/messages`).set(hqMgr.h).send({ text: "x" })).status, 404);
assert.equal((await request(app).get("/api/admin/chat/alerts").set(acct.h)).status, 403);

// alarm
r = await request(app).get("/api/admin/chat/alerts").set(tgSales.h);
assert.equal(r.body.data.waitingForMe, 1); assert.equal(r.body.data.alarm, true); assert.equal(r.body.data.items[0].targetRole, "SALES");
r = await request(app).get("/api/admin/chat/alerts").set(tgMgr.h);
assert.equal(r.body.data.waiting, 1); assert.equal(r.body.data.waitingForMe, 0);
r = await request(app).get("/api/admin/chat/alerts").set(hqSales.h);
assert.equal(r.body.data.waiting, 0);

// presence
await pub("get", `/conversations/${cid}`).set(H);
r = await request(app).get("/api/admin/chat/alerts").set(it.h);
assert.equal(r.body.data.onlineVisitors, 1);

// agent reply → visitor sees name/role/image
r = await request(app).post(`/api/admin/chat/conversations/${cid}/messages`).set(tgSales.h).send({ text: "Bonjour, je suis là !" });
assert.equal(r.status, 200); assert.equal(r.body.data.conversation.status, "agent"); assert.equal(r.body.data.conversation.assigned.roleLabel, "Sales Agent");
r = await pub("get", `/conversations/${cid}?after=0`).set(H);
assert.equal(r.body.data.conversation.agent.name, "SALES TG"); assert.equal(r.body.data.conversation.agent.role, "Sales Agent"); assert.match(r.body.data.conversation.agent.image, /SALES\.png/);
assert.ok(r.body.data.messages.some((m) => m.senderType === "agent" && m.sender.image));
// internal notes hidden from visitor
await request(app).post(`/api/admin/chat/conversations/${cid}/messages`).set(tgSales.h).send({ text: "note: VIP", internal: true });
r = await pub("get", `/conversations/${cid}?after=0`).set(H);
assert.ok(!r.body.data.messages.some((m) => /VIP/.test(m.text)));
r = await request(app).get(`/api/admin/chat/conversations/${cid}`).set(tgMgr.h);
assert.ok(r.body.data.messages.some((m) => /VIP/.test(m.text) && m.internal));

// visitor message while with agent → no AI call
aiScript = ["FAIL"];
r = await pub("post", `/conversations/${cid}/messages`).set(H).send({ text: "merci" });
assert.equal(r.status, 200); assert.equal(aiScript.length, 1, "AI not invoked while agent is engaged");
aiScript = [];

// transfer up to manager, then HQ-only settings guard
r = await request(app).post(`/api/admin/chat/conversations/${cid}/transfer`).set(tgSales.h).send({ role: "MANAGER" });
assert.equal(r.body.data.conversation.status, "waiting_agent"); assert.equal(r.body.data.conversation.escalation.targetRole, "MANAGER"); assert.equal(r.body.data.conversation.assigned, null);
assert.equal((await request(app).get("/api/admin/chat/alerts").set(tgMgr.h)).body.data.waitingForMe, 1);
assert.equal((await request(app).put("/api/admin/chat/settings").set(tgMgr.h).send({ enabled: false })).status, 403);
assert.equal((await request(app).put("/api/admin/chat/settings").set(it.h).send({ slaSeconds: 60 })).body.data.slaSeconds, 60);

// overdue sweep → one urgent notification
await Conv.updateOne({ _id: cid }, { $set: { "escalation.requestedAt": new Date(Date.now() - 600000), "escalation.overdueNotifiedAt": null } });
r = await request(app).get("/api/admin/chat/alerts").set(tgMgr.h);
assert.equal(r.body.data.urgent, true);
await request(app).get("/api/admin/chat/alerts").set(tgMgr.h);
assert.equal(await Notification.countDocuments({ title: /OVERDUE/ }) >= 1, true);
const od = await Notification.countDocuments({ title: /OVERDUE/, priority: "urgent" });
await request(app).get("/api/admin/chat/alerts").set(it.h);
assert.equal(await Notification.countDocuments({ title: /OVERDUE/, priority: "urgent" }), od, "overdue fires once");

// export + stats + close + rate
r = await request(app).get("/api/admin/chat/conversations/export.csv").set(tgMgr.h);
assert.match(r.text, /kofi@example.com/); assert.match(r.text, /\+22890123456/);
assert.equal((await request(app).get("/api/admin/chat/conversations/export.csv").set(hqSales.h)).text.includes("kofi"), false);
r = await request(app).get("/api/admin/chat/stats").set(it.h); assert.equal(r.body.data.total, 1); assert.equal(r.body.data.leads, 1);
r = await request(app).post(`/api/admin/chat/conversations/${cid}/close`).set(tgMgr.h).send({});
assert.equal(r.body.data.conversation.status, "closed");
assert.equal((await pub("post", `/conversations/${cid}/messages`).set(H).send({ text: "hello" })).status, 409);
assert.equal((await pub("post", `/conversations/${cid}/rate`).set(H).send({ score: 5, comment: "great" })).status, 200);

// AI outage → graceful escalation (HQ visitor, NG)
r = await request(app).post("/api/chat/conversations").set("x-app-country", "NG").send({ visitorId: "dev-2", language: "en" });
const c2 = r.body.data.conversation.id, t2 = r.body.data.token;
aiScript = ["FAIL"];
r = await request(app).post(`/api/chat/conversations/${c2}/messages`).set("x-app-country", "NG").set("x-chat-token", t2).send({ text: "help with my order" });
assert.equal(r.body.data.conversation.waitingForAgent, true); assert.ok(r.body.data.messages.some((m) => /unavailable/i.test(m.text)));
assert.deepEqual(await list(hqSales), [c2]); assert.deepEqual(await list(hqMgr), [c2]); assert.deepEqual(await list(tgMgr), [cid]);
// visitor button
r = await request(app).post("/api/chat/conversations").set("x-app-country", "NG").send({ visitorId: "dev-3" });
const c3 = r.body.data.conversation.id, t3 = r.body.data.token;
r = await request(app).post(`/api/chat/conversations/${c3}/human`).set("x-app-country", "NG").set("x-chat-token", t3).send({});
assert.equal(r.body.data.conversation.waitingForAgent, true);
// disabled country
await request(app).put("/api/admin/chat/settings").set(it.h).send({ disabledCountries: ["TG"] });
assert.equal((await pub("post", "/conversations").send({})).status, 403);
// rate limit
let last; for (let i = 0; i < 14; i++) last = await request(app).post("/api/chat/conversations").set("x-app-country", "NG").send({ visitorId: "flood" });
assert.equal(last.status, 429);
console.log("chat ✓");
await mongoose.disconnect(); process.exit(0);
