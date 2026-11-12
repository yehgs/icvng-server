// Run: TEST_MONGO_URI=mongodb://127.0.0.1:27018 node tests/campaign_roles_int.mjs
//
// Addendum 5 — role/scope behaviour added on top of the seasonal-campaign engine:
//   * ACCOUNTANT / EDITOR can now be assigned to a country (they were HQ-only).
//   * ACCOUNTANT ("campaigns.discounts") can CRUD DISCOUNT RULES only — on live
//     campaigns too — inside their own country; nothing else about a campaign.
//   * EDITOR stays draft-only for rules. MANAGER runs the full lifecycle in-country.
//   * An HQ (GLOBAL) accountant is Nigeria-only for campaigns; IT/Director global.
process.env.SECRET_KEY_ACCESS_TOKEN = "testsecret";
process.env.CAMPAIGN_CACHE_TTL_MS = "0";
delete process.env.OPENAI_API_KEY;
import assert from "assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import request from "supertest";

await mongoose.connect((process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27018") + "/icv_test_roles_" + Date.now());
const { default: countryDetect } = await import("../middleware/countryDetect.js");
const { default: countryContext } = await import("../middleware/countryContext.js");
const { default: campaignRouter } = await import("../route/campaign.route.js");
const { default: User } = await import("../models/user.model.js");
const { default: Rule } = await import("../models/campaign-discount-rule.model.js");
for (const m of ["category", "brand", "product", "tag", "attribute", "subCategory", "compatible", "roasted-area"]) await import(`../models/${m}.model.js`).catch(() => {});
const { refreshCountryCache } = await import("../services/countryService.js");
await refreshCountryCache();
const { getEffectivePermissions } = await import("../middleware/requirePermission.js");
const { HQ_ONLY_SUBROLES, resolveScopeForSubRole } = await import("../config/roles.js");

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(countryDetect);
app.use(countryContext);
app.use("/api/campaign", campaignRouter);
const TG = { "X-Storefront-Host": "i-coffee.tg" };
const NG = { "X-Storefront-Host": "i-coffee.ng" };

let n = 0;
const mk = async (subRole, scope = "GLOBAL", assignedCountry = null) => {
  const u = await User.create({ name: `${subRole}${assignedCountry || ""}`, email: `r${++n}@t.com`, password: "x", role: "ADMIN", subRole, scope, assignedCountry, status: "Active", avatar: "https://img/a.png" });
  return { u, h: { Authorization: `Bearer ${jwt.sign({ id: String(u._id) }, "testsecret")}` } };
};
const c = (h, host = NG) => ({ get: (u) => request(app).get(u).set(h).set(host), post: (u, b) => request(app).post(u).set(h).set(host).send(b), put: (u, b) => request(app).put(u).set(h).set(host).send(b), del: (u) => request(app).delete(u).set(h).set(host) });
let passed = 0;
const ok = (name) => { passed++; console.log("  ✓", name); };
const day = 86400000;
const win = (a, b) => ({ startsAt: new Date(Date.now() + a * day).toISOString(), endsAt: new Date(Date.now() + b * day).toISOString() });
const camp = (over = {}) => ({ name: "Noel " + Math.random().toString(36).slice(2, 6), type: "CHRISTMAS", ...win(-1, 5), ...over });
const rule = (over = {}) => ({ name: "Acc rule", discountType: "PERCENTAGE", discountValue: 15, scope: "ALL", ...over });

// ─── role definitions ───
assert.deepEqual([...HQ_ONLY_SUBROLES].sort(), ["DIRECTOR", "IT", "WAREHOUSE"], "only IT/Director/Warehouse remain HQ-only");
assert.deepEqual(resolveScopeForSubRole("ACCOUNTANT", "COUNTRY", "TG"), { scope: "COUNTRY", assignedCountry: "TG" });
assert.deepEqual(resolveScopeForSubRole("IT", "COUNTRY", "TG"), { scope: "GLOBAL", assignedCountry: null }, "IT is still forced global");
const accTG = await mk("ACCOUNTANT", "COUNTRY", "TG");
const accHQ = await mk("ACCOUNTANT");
const editorTG = await mk("EDITOR", "COUNTRY", "TG");
const mgrTG = await mk("MANAGER", "COUNTRY", "TG");
const mgrNG = await mk("MANAGER", "COUNTRY", "NG");
const sales = await mk("SALES", "COUNTRY", "TG");
const it = await mk("IT");
await assert.rejects(() => mk("IT", "COUNTRY", "TG"), /GLOBAL/, "schema still refuses a country-scoped IT");
const perms = (a) => getEffectivePermissions(a.u);
assert.ok(perms(accTG).has("campaigns.discounts") && !perms(accTG).has("campaigns.manage") && !perms(accTG).has("campaigns.publish"));
assert.ok(!perms(sales).has("campaigns.discounts") && !perms(editorTG).has("campaigns.discounts"));
ok("ACCOUNTANT/EDITOR are country-assignable; accountant holds campaigns.discounts only; IT stays global");

// ─── set up a LIVE Togo campaign (manager) and a LIVE Nigeria one ───
let r = await c(mgrTG.h, TG).post("/api/campaign/admin/create", camp());
assert.equal(r.status, 200, JSON.stringify(r.body));
const tg = r.body.data;
assert.equal((await c(mgrTG.h, TG).post(`/api/campaign/admin/${tg._id}/publish`, {})).status, 200);
r = await c(mgrNG.h).post("/api/campaign/admin/create", camp({ name: "Noel Nigeria" }));
const ng = r.body.data;
assert.equal((await c(mgrNG.h).post(`/api/campaign/admin/${ng._id}/publish`, {})).status, 200);

// ─── Accountant (TG): Discounts tab on a LIVE campaign ───
r = await c(accTG.h, TG).get("/api/campaign/admin/meta");
assert.equal(r.status, 200);
assert.deepEqual([r.body.data.permissions.manage, r.body.data.permissions.publish, r.body.data.permissions.discounts], [false, false, true], "meta tells the UI: discounts tab only");
assert.equal(r.body.data.countryCode, "TG");
r = await c(accTG.h, TG).post(`/api/campaign/admin/${tg._id}/rules`, rule());
assert.equal(r.status, 200, JSON.stringify(r.body));
const accRule = r.body.data;
assert.equal(accRule.countryCode, "TG", "country inherited from the campaign");
r = await c(accTG.h, TG).put(`/api/campaign/admin/${tg._id}/rules/${accRule._id}`, { discountValue: 25 });
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.data.discountValue, 25);
assert.equal((await c(accTG.h, TG).post(`/api/campaign/admin/${tg._id}/rules/${accRule._id}/pause`, {})).status, 200);
assert.equal((await Rule.findById(accRule._id)).status, "PAUSED");
assert.equal((await c(accTG.h, TG).post(`/api/campaign/admin/${tg._id}/rules/${accRule._id}/activate`, {})).status, 200);
const rBody = (await c(accTG.h, TG).get(`/api/campaign/admin/${tg._id}`)).body.data;
assert.equal(rBody.rules.length, 1, "accountant can read the campaign + rules");
assert.equal((await c(accTG.h, TG).del(`/api/campaign/admin/${tg._id}/rules/${accRule._id}`)).status, 200);
assert.equal(await Rule.countDocuments({ campaignId: tg._id }), 0);
ok("country Accountant: create/update/pause/activate/delete discount rules on a LIVE campaign");

// ─── Accountant cannot do anything else ───
const forbidden = [
  ["put", `/api/campaign/admin/${tg._id}`, { name: "x" }],
  ["post", "/api/campaign/admin/create", camp({ countryCode: "TG" })],
  ["post", `/api/campaign/admin/${tg._id}/publish`, {}],
  ["post", `/api/campaign/admin/${tg._id}/pause`, {}],
  ["post", `/api/campaign/admin/${tg._id}/duplicate`, {}],
  ["post", `/api/campaign/admin/${tg._id}/blocks`, { type: "HERO", title: "x" }],
  ["del", `/api/campaign/admin/${tg._id}`, undefined],
];
for (const [m, url, b] of forbidden) {
  const rr = await c(accTG.h, TG)[m](url, b);
  assert.equal(rr.status, 403, `${m} ${url} → ${rr.status}`);
}
ok("accountant: campaign edit / create / publish / pause / duplicate / content blocks / delete → 403");

// ─── Accountant is country-bound ───
for (const [m, url, b] of [
  ["get", `/api/campaign/admin/${ng._id}`],
  ["post", `/api/campaign/admin/${ng._id}/rules`, rule()],
]) assert.equal((await c(accTG.h, TG)[m](url, b)).status, 404, `${m} ${url} must not leak NG to a TG accountant`);
r = await c(accTG.h, TG).get("/api/campaign/admin/list?countryCode=NG");
assert.ok(r.body.data.length > 0 && r.body.data.every((x) => x.countryCode === "TG"), "list ignores ?countryCode for non-global roles");
const ngRule = (await c(mgrNG.h).post(`/api/campaign/admin/${ng._id}/rules`, rule({ name: "NG rule" }))).body.data;
for (const act of ["", "/pause", "/activate"]) {
  const rr = act ? await c(accTG.h, TG).post(`/api/campaign/admin/${ng._id}/rules/${ngRule._id}${act}`, {}) : await c(accTG.h, TG).del(`/api/campaign/admin/${ng._id}/rules/${ngRule._id}`);
  assert.equal(rr.status, 404, "TG accountant cannot touch an NG rule");
}
assert.equal((await c(accTG.h, TG).put(`/api/campaign/admin/${tg._id}/rules/${ngRule._id}`, { discountValue: 90 })).status, 404);
assert.equal((await Rule.findById(ngRule._id)).discountValue, 15, "NG rule untouched");
ok("country Accountant cannot read or change Nigeria's campaigns/rules (404, record untouched)");

// ─── HQ accountant (GLOBAL scope) → Nigeria only ───
assert.equal((await c(accHQ.h).post(`/api/campaign/admin/${ng._id}/rules`, rule({ name: "HQ acc" }))).status, 200);
assert.equal((await c(accHQ.h).get(`/api/campaign/admin/${tg._id}`)).status, 404, "unscoped accountant never gets another market");
ok("HQ (GLOBAL) accountant: Nigeria only — a null scope never grants other markets");

// ─── Editor: drafts only, even with country assignment ───
const draftTG = (await c(mgrTG.h, TG).post("/api/campaign/admin/create", camp({ name: "Draft TG" }))).body.data;
assert.equal((await c(editorTG.h, TG).post(`/api/campaign/admin/${draftTG._id}/rules`, rule())).status, 200, "editor may add rules to a DRAFT");
assert.equal((await c(editorTG.h, TG).post(`/api/campaign/admin/${tg._id}/rules`, rule())).status, 403, "editor may NOT touch a LIVE campaign's rules");
assert.equal((await c(sales.h, TG).post(`/api/campaign/admin/${draftTG._id}/rules`, rule())).status, 403, "sales view-only");
ok("editor: draft rules only; sales: view only");

// ─── Manager sees the module and runs it in-country ───
r = await c(mgrTG.h, TG).get("/api/campaign/admin/meta");
assert.deepEqual([r.body.data.permissions.manage, r.body.data.permissions.publish, r.body.data.permissions.discounts], [true, true, true]);
assert.equal((await c(mgrTG.h, TG).post(`/api/campaign/admin/${tg._id}/pause`, {})).status, 200);
assert.equal((await c(mgrTG.h, TG).post(`/api/campaign/admin/${ng._id}/pause`, {})).status, 404);
ok("country Manager: full lifecycle in Togo, 404 on Nigeria");

// ─── IT global ───
const all = (await c(it.h).get("/api/campaign/admin/list")).body.data;
assert.ok(new Set(all.map((x) => x.countryCode)).size >= 2);
ok("IT lists every country");

console.log(`\n${passed} groups passed`);
await mongoose.disconnect();
process.exit(0);
