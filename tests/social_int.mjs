// Run: TEST_MONGO_URI=mongodb://127.0.0.1:27018 node tests/social_int.mjs
// Social-media page cards: permissions, country scoping, "ALL" entries, URL/platform validation, public feed.
process.env.SECRET_KEY_ACCESS_TOKEN = "testsecret";
import assert from "assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import request from "supertest";

await mongoose.connect((process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27018") + "/icv_test_social_" + Date.now());
const { default: socialRouter } = await import("../route/social.route.js");
const { default: User } = await import("../models/user.model.js");
const { refreshCountryCache } = await import("../services/countryService.js");
await refreshCountryCache();

const app = express();
app.use(express.json()); app.use(cookieParser());
// stand-in for countryDetect on the public route
app.use((req, _res, next) => { req.countryCode = req.headers["x-test-country"] || "NG"; next(); });
app.use("/api/social", socialRouter);

let n = 0;
const mk = async (subRole, scope = "GLOBAL", assignedCountry = null) => {
  const u = await User.create({ name: subRole, email: `s${++n}@t.com`, password: "x", role: "ADMIN", subRole, scope, assignedCountry, status: "Active" });
  return { h: { Authorization: `Bearer ${jwt.sign({ id: String(u._id) }, "testsecret")}` } };
};
const it = await mk("IT"), director = await mk("DIRECTOR"), mgrTG = await mk("MANAGER", "COUNTRY", "TG"), mgrNG = await mk("MANAGER", "COUNTRY", "NG");
const edTG = await mk("EDITOR", "COUNTRY", "TG"), sales = await mk("SALES", "COUNTRY", "TG"), acct = await mk("ACCOUNTANT"), hr = await mk("HR");
const c = (h) => ({ get: (u) => request(app).get(u).set(h), post: (u, b) => request(app).post(u).set(h).send(b), put: (u, b) => request(app).put(u).set(h).send(b), del: (u) => request(app).delete(u).set(h) });
let passed = 0; const ok = (m) => { passed++; console.log("  ✓", m); };
const fb = (over = {}) => ({ platform: "FACEBOOK", name: "i-Coffee Togo", url: "https://www.facebook.com/icoffeetogo", description: "News from Lomé", showFeed: true, ...over });

// 1 permissions
assert.equal((await c(sales.h).get("/api/social/admin/list")).status, 403);
assert.equal((await c(acct.h).get("/api/social/admin/list")).status, 403);
assert.equal((await c(hr.h).post("/api/social/admin/create", fb())).status, 403);
assert.equal((await request(app).get("/api/social/admin/list")).status, 401);
ok("only IT/Director/Manager/Editor hold social permissions");

// 2 manager creates in own country; editor too; tampered country 403; ALL refused for them
let r = await c(mgrTG.h).post("/api/social/admin/create", fb());
assert.equal(r.status, 200); assert.equal(r.body.data.countryCode, "TG"); const tgId = r.body.data._id;
r = await c(edTG.h).post("/api/social/admin/create", { platform: "INSTAGRAM", name: "IG TG", url: "https://instagram.com/icoffee_tg" });
assert.equal(r.status, 200); assert.equal(r.body.data.sortOrder, 1);
assert.equal((await c(mgrTG.h).post("/api/social/admin/create", fb({ countryCode: "NG" }))).status, 403);
assert.equal((await c(mgrTG.h).post("/api/social/admin/create", fb({ countryCode: "ALL" }))).status, 403);
ok("manager/editor create in their own country; other country and ALL are 403");

// 3 validation
for (const bad of [fb({ url: "http://facebook.com/x" }), fb({ url: "https://evil.com/facebook.com" }), fb({ url: "javascript:alert(1)" }), fb({ platform: "INSTAGRAM" }), fb({ name: "  " }), fb({ imageUrl: "http://x/y.png" }), fb({ platform: "NOPE" })]) {
  assert.equal((await c(mgrTG.h).post("/api/social/admin/create", bad)).status, 400, JSON.stringify(bad).slice(0, 60));
}
r = await c(mgrTG.h).post("/api/social/admin/create", { platform: "INSTAGRAM", name: "<b>IG</b>", url: "https://www.instagram.com/x", showFeed: true });
assert.equal(r.body.data.name, "IG"); assert.equal(r.body.data.showFeed, false);
ok("https + platform-host validation, text sanitised, live feed is Facebook-only");

// 4 isolation: NG manager cannot see/edit/delete TG cards (404)
r = await c(mgrNG.h).get("/api/social/admin/list"); assert.equal(r.body.data.length, 0);
assert.equal((await c(mgrNG.h).put(`/api/social/admin/${tgId}`, { name: "x" })).status, 404);
assert.equal((await c(mgrNG.h).del(`/api/social/admin/${tgId}`)).status, 404);
ok("another country's manager gets empty list and 404s");

// 5 IT: all countries, ALL entry; scoped managers see ALL read-only
r = await c(it.h).get("/api/social/admin/list"); assert.equal(r.body.data.length, 3);
r = await c(it.h).post("/api/social/admin/create", { platform: "FACEBOOK", name: "i-Coffee Global", url: "https://facebook.com/icoffee", countryCode: "ALL" });
assert.equal(r.status, 200); const allId = r.body.data._id;
assert.equal((await c(director.h).post("/api/social/admin/create", { ...fb(), countryCode: "NG" })).status, 200);
assert.equal((await c(it.h).post("/api/social/admin/create", fb())).status, 400); // global admin must name a country
r = await c(mgrTG.h).get("/api/social/admin/list");
assert.equal(r.body.data.some((x) => x._id === allId && x.editable === false), true);
assert.equal((await c(mgrTG.h).put(`/api/social/admin/${allId}`, { name: "hack" })).status, 403);
assert.equal((await c(mgrTG.h).del(`/api/social/admin/${allId}`)).status, 403);
ok("IT/Director manage every country and publish ALL; scoped staff see ALL read-only");

// 6 update + reorder
assert.equal((await c(mgrTG.h).put(`/api/social/admin/${tgId}`, { followersLabel: "12K followers", isActive: true })).body.data.followersLabel, "12K followers");
assert.equal((await c(mgrTG.h).put(`/api/social/admin/${tgId}`, { countryCode: "NG" })).status, 403);
const tgRows = (await c(mgrTG.h).get("/api/social/admin/list")).body.data.filter((x) => x.countryCode === "TG").map((x) => x._id);
assert.equal((await c(mgrTG.h).post("/api/social/admin/reorder", { ids: [...tgRows].reverse() })).status, 200);
assert.equal((await c(mgrTG.h).post("/api/social/admin/reorder", { ids: [allId] })).status, 404);
ok("update, country change blocked, reorder only within own cards");

// 6b deactivate then public
await c(mgrTG.h).put(`/api/social/admin/${tgRows[0]}`, { isActive: false });
r = await request(app).get("/api/social/public").set("x-test-country", "TG");
const names = r.body.data.map((x) => x.name);
assert.ok(!names.includes("<b>IG</b>")); assert.ok(names.includes("i-Coffee Global"));
assert.equal(names[names.length - 1], "i-Coffee Global"); // country cards first, ALL after
assert.ok(r.body.data.every((x) => x.countryCode === undefined && x.sortOrder === undefined));
r = await request(app).get("/api/social/public").set("x-test-country", "NG");
assert.ok(!r.body.data.some((x) => x.name === "IG TG")); assert.ok(r.body.data.some((x) => x.name === "i-Coffee Global"));
ok("public feed: own country + ALL, inactive hidden, no internal fields, no cross-country leakage");

// 7 delete
assert.equal((await c(mgrTG.h).del(`/api/social/admin/${tgId}`)).status, 200);
assert.equal((await c(it.h).del(`/api/social/admin/${allId}`)).status, 200);
ok("delete in territory");

console.log(`\nall ${passed} social groups passed`);
await mongoose.disconnect(); process.exit(0);
