// Run: TEST_MONGO_URI=mongodb://127.0.0.1:27018 node tests/social_int.mjs
// Social-media page cards: permissions, country scoping, "ALL" entries, URL/platform validation, public feed.
process.env.SECRET_KEY_ACCESS_TOKEN = "testsecret";
process.env.PAYMENT_SECRETS_KEY = "a".repeat(64);
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

const graphHits = [];
const realFetch = globalThis.fetch;
let graphFail = false;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("https://graph.facebook.com/")) {
    graphHits.push(u);
    if (graphFail) return { ok: false, status: 500, json: async () => ({}) };
    if (u.includes("/PAGE123/posts")) return { ok: true, status: 200, json: async () => ({ data: Array.from({ length: 6 }, (_, i) => ({ id: "p" + i, message: "Fresh roast " + i, full_picture: `https://scontent.test/${i}.jpg`, permalink_url: `https://www.facebook.com/icoffeetogo/posts/${i}`, created_time: "2026-11-1" + i + "T10:00:00+0000" })) }) };
    if (u.includes("/IG456/media")) return { ok: true, status: 200, json: async () => ({ data: [{ id: "i1", caption: "Espresso", media_type: "IMAGE", media_url: "https://cdn.test/1.jpg", permalink: "https://www.instagram.com/p/AAA/", timestamp: "2026-11-12T08:00:00+0000" }, { id: "i2", caption: "Reel", media_type: "VIDEO", thumbnail_url: "https://cdn.test/t2.jpg", media_url: "https://cdn.test/v2.mp4", permalink: "https://www.instagram.com/reel/BBB/", timestamp: "2026-11-11T08:00:00+0000" }] }) };
  }
  if (u.startsWith("https://www.youtube.com/feeds/")) return { ok: true, status: 200, text: async () => "<feed><entry><yt:videoId>abc123XYZ_-</yt:videoId><title>Brew &amp; chill</title><published>2026-11-10T00:00:00+00:00</published></entry></feed>" };
  return realFetch(url, opts);
};
const { _clearFeedCache } = await import("../services/socialFeed.js");
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

// 8 latest-post cards
console.log("post cards");
_clearFeedCache();
let r8 = await c(mgrTG.h).post("/api/social/admin/create", fb({ externalId: "PAGE123", accessToken: "EAAB-secret-token", showFeed: false }));
assert.equal(r8.status, 200, JSON.stringify(r8.body));
assert.equal(r8.body.data.hasToken, true); assert.equal(r8.body.data.accessTokenEnc, undefined, "token never returned on create");
const fbId = r8.body.data._id;
r8 = await c(mgrTG.h).get("/api/social/admin/list");
assert.ok(!JSON.stringify(r8.body).includes("EAAB-secret-token") && !JSON.stringify(r8.body).includes("accessTokenEnc"), "token never in admin list");
assert.ok(r8.body.data.find((x) => x._id === fbId).hasToken);
const ig = await c(mgrTG.h).post("/api/social/admin/create", { platform: "INSTAGRAM", name: "IG Togo", url: "https://www.instagram.com/icoffeetogo", externalId: "IG456", accessToken: "IGtoken1" });
assert.equal(ig.status, 200);
const yt = await c(mgrTG.h).post("/api/social/admin/create", { platform: "YOUTUBE", name: "YT Togo", url: "https://www.youtube.com/@icoffeetogo", externalId: "UCabcdef123" });
assert.equal(yt.status, 200);
const tt = await c(mgrTG.h).post("/api/social/admin/create", { platform: "TIKTOK", name: "TikTok Togo", url: "https://www.tiktok.com/@icoffeetogo", manualPosts: [{ url: "https://www.tiktok.com/@icoffeetogo/video/1", imageUrl: "https://cdn.test/a.jpg", caption: "Old", postedAt: "2026-01-01" }, { url: "https://www.tiktok.com/@icoffeetogo/video/2123456789", caption: "<b>New</b>", postedAt: "2026-06-01" }] });
assert.equal(tt.status, 200, JSON.stringify(tt.body));
r8 = await request(app).get("/api/social/public").set("x-test-country", "TG");
const by = (nm) => r8.body.data.find((x) => x.name === nm);
assert.equal(by("i-Coffee Togo").posts.length, 6); assert.equal(by("i-Coffee Togo").posts[0].url, "https://www.facebook.com/icoffeetogo/posts/0");
assert.ok(by("i-Coffee Togo").posts.every((p) => p.imageUrl && p.caption));
assert.equal(by("IG Togo").posts.length, 2); assert.equal(by("IG Togo").posts[1].imageUrl, "https://cdn.test/t2.jpg", "video uses its thumbnail");
assert.equal(by("YT Togo").posts[0].caption, "Brew & chill"); assert.equal(by("YT Togo").posts[0].imageUrl, "https://i.ytimg.com/vi/abc123XYZ_-/hqdefault.jpg");
assert.deepEqual(by("TikTok Togo").posts.map((p) => p.caption), ["New", "Old"], "manual posts newest first, text sanitised");
assert.ok(!JSON.stringify(r8.body).includes("EAAB-secret-token") && !JSON.stringify(r8.body).includes("accessToken") && !JSON.stringify(r8.body).includes("externalId"));
const igv = by("IG Togo").posts[1];
assert.equal(igv.type, "VIDEO"); assert.equal(igv.videoUrl, "https://cdn.test/v2.mp4"); assert.equal(by("IG Togo").posts[0].type, "IMAGE"); assert.equal(by("IG Togo").posts[0].videoUrl, "");
const ytp = by("YT Togo").posts[0]; assert.equal(ytp.type, "VIDEO"); assert.match(ytp.embedUrl, /^https:\/\/www\.youtube-nocookie\.com\/embed\/abc123XYZ_-/);
const ttp = by("TikTok Togo").posts[0]; assert.equal(ttp.type, "VIDEO"); assert.equal(ttp.embedUrl, "https://www.tiktok.com/embed/v2/2123456789");
assert.equal(by("TikTok Togo").posts[1].type, "IMAGE", "a non-embeddable link stays an image card");
assert.equal(by("i-Coffee Togo").posts[0].type, "IMAGE");
ok("videos play: IG video file, YouTube/TikTok embeds, images stay images");
ok("Facebook, Instagram, YouTube and manual posts are returned as post cards; no token or id leaks");
const hits = graphHits.length;
await request(app).get("/api/social/public").set("x-test-country", "TG");
assert.equal(graphHits.length, hits, "second request served from the 15-minute cache");
ok("feeds are cached");
// failure → manual fallback / stale
graphFail = true; _clearFeedCache();
await c(mgrTG.h).put(`/api/social/admin/${fbId}`, { manualPosts: [{ url: "https://www.facebook.com/icoffeetogo/posts/99", caption: "Pinned fallback" }] });
r8 = await request(app).get("/api/social/public").set("x-test-country", "TG");
assert.deepEqual(by2(r8, "i-Coffee Togo").posts.map((p) => p.caption), ["Pinned fallback"]);
function by2(r, nm) { return r.body.data.find((x) => x.name === nm); }
ok("when Facebook is down the hand-picked posts are shown instead");
graphFail = false;
// validation
assert.equal((await c(mgrTG.h).put(`/api/social/admin/${fbId}`, { manualPosts: [{ url: "https://evil.example/x" }] })).status, 400);
assert.equal((await c(mgrTG.h).put(`/api/social/admin/${fbId}`, { manualPosts: [{ url: "https://www.facebook.com/x/posts/1", imageUrl: "http://insecure/x.jpg" }] })).status, 400);
assert.equal((await c(mgrTG.h).put(`/api/social/admin/${fbId}`, { manualPosts: Array.from({ length: 13 }, () => ({ url: "https://www.facebook.com/x/posts/1" })) })).status, 400);
assert.equal((await c(mgrTG.h).put(`/api/social/admin/${fbId}`, { externalId: "bad id!" })).status, 400);
assert.equal((await c(mgrNG.h).put(`/api/social/admin/${fbId}`, { accessToken: "x1" })).status, 404, "other country cannot touch the token");
r8 = await c(mgrTG.h).put(`/api/social/admin/${fbId}`, { accessToken: "" });
assert.equal(r8.body.data.hasToken, false);
ok("manual-post/ID/token validation, country scope on the token, token can be cleared");

console.log(`\nall ${passed} social groups passed`);
await mongoose.disconnect(); process.exit(0);
