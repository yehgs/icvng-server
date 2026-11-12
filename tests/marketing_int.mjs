// Run: TEST_MONGO_URI=mongodb://127.0.0.1:27018 node tests/marketing_int.mjs
//
// Email marketing end to end through the real router (Resend HTTP API stubbed):
// permissions, country scoping for every role, audience building (dedupe, suppression,
// verified-only), batch sending, atomic start, cancel, unsubscribe, template safety.
process.env.SECRET_KEY_ACCESS_TOKEN = "testsecret";
process.env.RESEND_API_KEY = "re_test";
process.env.MARKETING_SEND_DELAY_MS = "0";
process.env.MARKETING_BATCH_SIZE = "4";
process.env.SERVER_BASE_URL = "https://api.test";
delete process.env.OPENAI_API_KEY;
import assert from "assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import request from "supertest";

// ── stub the Resend HTTP API ──
const sentMails = [];
let failFor = new Set();
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes("api.resend.com")) {
    const body = JSON.parse(opts.body);
    if (failFor.has(body.to[0])) return { ok: false, status: 422, statusText: "no", json: async () => ({ message: "invalid recipient" }) };
    sentMails.push(body);
    return { ok: true, status: 200, json: async () => ({ id: "msg_" + sentMails.length }) };
  }
  return realFetch(url, opts);
};

await mongoose.connect((process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27018") + "/icv_test_mkt_" + Date.now());
const { default: marketingRouter } = await import("../route/marketing.route.js");
const { default: User } = await import("../models/user.model.js");
const { default: Customer } = await import("../models/customer.model.js");
const { default: Subscriber } = await import("../models/subscriber.model.js");
const { default: Suppression } = await import("../models/marketing-suppression.model.js");
const { default: Recipient } = await import("../models/marketing-recipient.model.js");
const { default: MarketingEmail } = await import("../models/marketing-email.model.js");
const { buildMarketingEmailHtml, unsubscribeSignature } = await import("../services/marketing/template.js");
const { refreshCountryCache } = await import("../services/countryService.js");
await refreshCountryCache();

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/marketing", marketingRouter);

let n = 0;
const mk = async (subRole, scope = "GLOBAL", assignedCountry = null) => {
  const u = await User.create({ name: `${subRole}${assignedCountry || ""}`, email: `staff${++n}@t.com`, password: "x", role: "ADMIN", subRole, scope, assignedCountry, status: "Active", avatar: "https://img/a.png" });
  return { u, h: { Authorization: `Bearer ${jwt.sign({ id: String(u._id) }, "testsecret")}` } };
};
const it = await mk("IT");
const director = await mk("DIRECTOR");
const mgrTG = await mk("MANAGER", "COUNTRY", "TG");
const mgrNG = await mk("MANAGER", "COUNTRY", "NG");
const salesTG = await mk("SALES", "COUNTRY", "TG");
const editorTG = await mk("EDITOR", "COUNTRY", "TG");
const editorHQ = await mk("EDITOR");
const accountant = await mk("ACCOUNTANT");
const hr = await mk("HR");
const c = (h) => ({ get: (u) => request(app).get(u).set(h), post: (u, b) => request(app).post(u).set(h).send(b), put: (u, b) => request(app).put(u).set(h).send(b), del: (u) => request(app).delete(u).set(h) });
let passed = 0;
const ok = (name) => { passed++; console.log("  ✓", name); };
const body = (over = {}) => ({ name: "Black Friday blast", subject: "Hi {{firstName}}, 20% off", template: { headline: "Big savings", body: "Hello **there**\n\n- one\n- two", ctaLabel: "Shop", ctaUrl: "/shop" }, ...over });

// ── audience data: TG has 3 users (1 unverified, 1 inactive), 1 customer dup, 2 subscribers; NG has its own ──
const user = (email, countryCode, extra = {}) => User.create({ name: email.split("@")[0], email, password: "x", role: "USER", subRole: "BTC", countryCode, status: "Active", verify_email: true, ...extra });
await user("ama@tg.com", "TG"); await user("kofi@tg.com", "TG");
await user("unverified@tg.com", "TG", { verify_email: false });
await user("gone@tg.com", "TG", { status: "Inactive" });
await user("ngbuyer@ng.com", "NG");
await Customer.create({ countryCode: "TG", name: "Ama Dup", email: "ama@tg.com", mobile: "1", customerType: "BTC", customerMode: "ONLINE", createdBy: it.u._id, userId: director.u._id });
await Customer.create({ countryCode: "TG", name: "Biz Ltd", email: "biz@tg.com", mobile: "2", customerType: "BTB", customerMode: "OFFLINE", companyName: "Biz", registrationNumber: "R1", createdBy: it.u._id, userId: hr.u._id });
await Subscriber.create({ email: "news@tg.com", countryCode: "TG" });
await Subscriber.create({ email: "kofi@tg.com", countryCode: "TG" });
await Subscriber.create({ email: "optout@tg.com", countryCode: "TG" });
await Suppression.create({ email: "optout@tg.com", countryCode: "TG" });
await Subscriber.create({ email: "ngnews@ng.com", countryCode: "NG" });

// ── permissions ──
console.log("permissions");
assert.equal((await request(app).get("/api/marketing/admin/list")).status, 401);
for (const [who, a, view, manage] of [["it", it, 200, 200], ["director", director, 200, 200], ["mgr", mgrTG, 200, 200], ["sales", salesTG, 200, 200], ["editor", editorTG, 200, 200], ["accountant", accountant, 403, 403], ["hr", hr, 403, 403]]) {
  assert.equal((await c(a.h).get("/api/marketing/admin/list")).status, view, `${who} view`);
  const r = await c(a.h).post("/api/marketing/admin/create", body({ countryCode: ["it", "director"].includes(who) ? "TG" : undefined }));
  assert.equal(r.status === 200 ? 200 : r.status, manage === 200 ? 200 : 403, `${who} create → ${r.status}`);
}
ok("IT/Director/Manager/Sales/Editor have access; Accountant and HR are refused");

// ── country scoping ──
console.log("country scope");
await MarketingEmail.deleteMany({});
let r = await c(mgrTG.h).post("/api/marketing/admin/create", body());
assert.equal(r.status, 200, JSON.stringify(r.body));
const tg = r.body.data;
assert.equal(tg.countryCode, "TG");
assert.equal(tg.language, "fr", "language defaults from the country");
assert.equal((await c(mgrTG.h).post("/api/marketing/admin/create", body({ countryCode: "NG" }))).status, 403, "tampering with country → 403");
assert.equal((await c(it.h).post("/api/marketing/admin/create", body())).status, 400, "global admin must name a country");
const ng = (await c(mgrNG.h).post("/api/marketing/admin/create", body({ name: "NG one" }))).body.data;
const hqEditor = (await c(editorHQ.h).post("/api/marketing/admin/create", body({ name: "HQ editor" }))).body.data;
assert.equal(hqEditor.countryCode, "NG", "an unscoped (HQ) editor is Nigeria-only");
for (const a of [mgrNG, salesTG, editorTG, editorHQ]) {
  const target = [mgrNG, editorHQ].includes(a) ? tg : ng;
  for (const call of [
    () => c(a.h).get(`/api/marketing/admin/${target._id}`),
    () => c(a.h).put(`/api/marketing/admin/${target._id}`, { name: "hijack" }),
    () => c(a.h).post(`/api/marketing/admin/${target._id}/send`, { confirm: true }),
    () => c(a.h).post(`/api/marketing/admin/${target._id}/test`, { emails: ["x@y.com"] }),
    () => c(a.h).del(`/api/marketing/admin/${target._id}`),
    () => c(a.h).get(`/api/marketing/admin/${target._id}/recipients`),
    () => c(a.h).post(`/api/marketing/admin/${target._id}/duplicate`, {}),
  ]) assert.equal((await call()).status, 404, "other country's campaign is invisible");
}
assert.equal((await MarketingEmail.findById(tg._id)).name, "Black Friday blast", "nothing modified");
const listTG = (await c(salesTG.h).get("/api/marketing/admin/list?countryCode=NG")).body.data;
assert.ok(listTG.length && listTG.every((x) => x.countryCode === "TG"), "?countryCode ignored for scoped roles");
assert.ok(new Set((await c(it.h).get("/api/marketing/admin/list")).body.data.map((x) => x.countryCode)).size >= 2, "IT sees all countries");
assert.equal((await c(it.h).get("/api/marketing/admin/list?countryCode=NG")).body.data.every((x) => x.countryCode === "NG"), true);
r = await c(mgrTG.h).get("/api/marketing/admin/audience/count");
assert.equal(r.body.data.countryCode, "TG");
assert.equal((await c(mgrTG.h).get("/api/marketing/admin/audience/count?countryCode=NG")).status, 403, "scoped role can't count another country's audience");
ok("Manager/Sales/Editor confined to their country (404/403, nothing modified); IT/Director global with explicit country");

// ── audience ──
console.log("audience");
// TG expected: ama (user, deduped w/ customer), kofi (user, deduped w/ subscriber), biz (customer), news (subscriber). Not: unverified, inactive, optout (suppressed), NG people.
r = await c(mgrTG.h).get("/api/marketing/admin/audience/count");
assert.equal(r.body.data.total, 4, JSON.stringify(r.body.data));
assert.equal(r.body.data.suppressed, 1);
assert.equal((await c(mgrTG.h).get("/api/marketing/admin/audience/count?verifiedOnly=false")).body.data.total, 5, "unverified included when allowed (inactive still excluded)");
assert.equal((await c(mgrTG.h).get("/api/marketing/admin/audience/count?customerTypes=BTB")).body.data.total, 1, "BTB filter");
ok("de-duplicated per e-mail, own country only, verified-only default, suppressed and inactive removed");

// ── preview / test / validation ──
console.log("compose");
r = await c(mgrTG.h).post("/api/marketing/admin/preview", { subject: "S", template: { headline: "<script>alert(1)</script>Hi", body: "x [bad](javascript:alert(1))", ctaUrl: "/shop", ctaLabel: "Go" } });
assert.equal(r.status, 200);
assert.ok(!r.body.data.html.includes("<script>") && !r.body.data.html.includes("javascript:"));
assert.ok(r.body.data.html.includes("i-coffee.tg"), "links resolve to the country's own domain");
assert.equal((await c(mgrTG.h).put(`/api/marketing/admin/${tg._id}`, { template: { ctaUrl: "javascript:alert(1)" } })).status, 400);
assert.equal((await c(mgrTG.h).put(`/api/marketing/admin/${tg._id}`, { template: { accentColor: "red" } })).status, 400);
assert.equal((await c(mgrTG.h).put(`/api/marketing/admin/${tg._id}`, { countryCode: "NG" })).status, 403, "country is immutable");
r = await c(mgrTG.h).post(`/api/marketing/admin/${tg._id}/test`, { emails: ["me@t.com"] });
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.ok(sentMails.at(-1).subject.startsWith("[TEST]"));
const html = buildMarketingEmailHtml({ countryCode: "IT", campaign: { subject: "s", language: "it", template: { headline: "h", body: "b" } }, recipient: { name: "Luca" }, unsubscribeUrl: "https://u" });
assert.ok(html.includes("Annulla l&#39;iscrizione") || html.includes("Annulla l'iscrizione") || html.includes("Annulla l&#39;iscrizione".replace("&#39;", "'")), "Italian footer");
ok("preview is escaped; unsafe links/colours rejected; country immutable; test send works; fr/it wording");

// ── sending ──
console.log("send");
sentMails.length = 0;
assert.equal((await c(mgrTG.h).post(`/api/marketing/admin/${tg._id}/send`, {})).status, 400, "must confirm");
failFor = new Set(["biz@tg.com"]);
r = await c(mgrTG.h).post(`/api/marketing/admin/${tg._id}/send`, { confirm: true });
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.data.stats.total, 4);
assert.equal((await c(mgrTG.h).post(`/api/marketing/admin/${tg._id}/send`, { confirm: true })).status, 409, "cannot be started twice");
assert.equal((await c(mgrTG.h).put(`/api/marketing/admin/${tg._id}`, { name: "late edit" })).status, 409, "locked once sending");
let guard = 0, last = r.body;
while (!last.done && guard++ < 20) last = (await c(mgrTG.h).post(`/api/marketing/admin/${tg._id}/process-batch`, {})).body;
const done = (await c(mgrTG.h).get(`/api/marketing/admin/${tg._id}`)).body.data;
// biz fails 3 times (attempts) → FAILED; others SENT
assert.equal(done.status, "SENT", JSON.stringify(done.stats));
assert.deepEqual([done.stats.sent, done.stats.failed, done.stats.pending], [3, 1, 0]);
const delivered = sentMails.map((m) => m.to[0]).sort();
assert.deepEqual(delivered, ["ama@tg.com", "kofi@tg.com", "news@tg.com"], "only eligible TG recipients were mailed, each exactly once");
assert.ok(sentMails.every((m) => m.from.includes("i-coffee.tg") || m.from.includes("Togo")), "sent from the Togo identity");
assert.ok(sentMails[0].html.includes("https://api.test/api/marketing/unsubscribe?"), "every mail carries a signed unsubscribe link");
assert.equal(sentMails.find((m) => m.to[0] === "ama@tg.com").subject, "Hi ama, 20% off", "subject personalised per recipient");
const failed = (await c(mgrTG.h).get(`/api/marketing/admin/${tg._id}/recipients?status=FAILED`)).body.data;
assert.equal(failed.length, 1);
assert.match(failed[0].error, /invalid recipient/);
assert.equal((await Recipient.countDocuments({ marketingEmailId: tg._id })), 4);
assert.equal((await c(mgrTG.h).del(`/api/marketing/admin/${tg._id}`)).status, 409, "sent campaigns are kept for the record");
ok("claims recipients atomically, retries then FAILs, exactly-once delivery, locked once sent");

// ── cancel ──
console.log("cancel");
sentMails.length = 0; failFor = new Set();
const c2 = (await c(mgrTG.h).post("/api/marketing/admin/create", body({ name: "to cancel" }))).body.data;
r = await c(mgrTG.h).post(`/api/marketing/admin/${c2._id}/send`, { confirm: true });
assert.equal(r.body.data.status, "SENT", "an audience that fits one batch completes immediately");
// batch size 4 means it may already be done; force a bigger audience to test cancel
await MarketingEmail.deleteOne({ _id: c2._id }); await Recipient.deleteMany({ marketingEmailId: c2._id });
for (let i = 0; i < 10; i++) await user(`bulk${i}@tg.com`, "TG");
const c3 = (await c(mgrTG.h).post("/api/marketing/admin/create", body({ name: "big" }))).body.data;
r = await c(mgrTG.h).post(`/api/marketing/admin/${c3._id}/send`, { confirm: true });
assert.equal(r.body.data.status, "SENDING");
assert.equal(r.body.data.stats.sent, 4);
r = await c(mgrTG.h).post(`/api/marketing/admin/${c3._id}/cancel`, {});
assert.equal(r.status, 200);
assert.equal(r.body.data.status, "CANCELLED");
const mailsAtCancel = sentMails.length;
await c(mgrTG.h).post(`/api/marketing/admin/${c3._id}/process-batch`, {});
assert.equal(sentMails.length, mailsAtCancel, "nothing is sent after cancel");
assert.equal((await Recipient.countDocuments({ marketingEmailId: c3._id, status: "SKIPPED" })), 10);
assert.equal((await c(mgrTG.h).del(`/api/marketing/admin/${c3._id}`)).status, 200, "cancelled campaigns can be deleted");
ok("cancel stops the send; remaining recipients skipped; no mail afterwards");

// ── unsubscribe ──
console.log("unsubscribe");
const e = Buffer.from("ama@tg.com").toString("base64url");
r = await request(app).get(`/api/marketing/unsubscribe?e=${e}&c=TG&t=${unsubscribeSignature("ama@tg.com", "TG")}`);
assert.equal(r.status, 200);
assert.ok(r.text.includes("Désabonné"), "page in the country's language");
assert.ok(await Suppression.findOne({ email: "ama@tg.com", countryCode: "TG" }));
assert.equal((await request(app).get(`/api/marketing/unsubscribe?e=${e}&c=TG&t=forged`)).status, 400);
assert.equal((await request(app).get(`/api/marketing/unsubscribe?e=${e}&c=NG&t=${unsubscribeSignature("ama@tg.com", "TG")}`)).status, 400, "signature binds the country");
assert.equal((await request(app).post(`/api/marketing/unsubscribe`).send({ e: Buffer.from("kofi@tg.com").toString("base64url"), c: "TG", t: unsubscribeSignature("kofi@tg.com", "TG") })).status, 200, "one-click POST");
r = await c(mgrTG.h).get("/api/marketing/admin/audience/count?sources=USERS,CUSTOMERS,SUBSCRIBERS");
assert.ok(!(await import("../services/marketing/audience.js").then((m) => m.buildAudience("TG", {}))).recipients.some((x) => x.email === "ama@tg.com"), "unsubscribed address leaves the audience");
ok("signed one-click unsubscribe (GET+POST), forged/other-country links refused, audience honours it");

console.log(`\n${passed} groups passed`);
await mongoose.disconnect();
process.exit(0);
