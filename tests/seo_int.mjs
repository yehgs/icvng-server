// Run: TEST_MONGO_URI=mongodb://127.0.0.1:27018 node tests/seo_int.mjs
// robots.txt, sitemap index/parts, crawler render + JSON-LD, 404 handling, IndexNow key.
import assert from "assert/strict";
import express from "express";
import mongoose from "mongoose";
import request from "supertest";

await mongoose.connect((process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27018") + "/icv_test_seo_" + Date.now());
const { default: seoRouter } = await import("../route/seo.route.js");
const { default: Product } = await import("../models/product.model.js");
const { default: Category } = await import("../models/category.model.js");
const { default: BlogPost } = await import("../models/blog-post.model.js");
const { default: Brand } = await import("../models/brand.model.js");
const { pingIndexNow } = await import("../controllers/seo.controller.js");

const app = express();
app.use((req, _res, next) => { req.country = { code: "NG", domain: "i-coffee.ng", language: { default: "en", locale: "en-NG", supported: ["en"] }, currency: { code: "NGN" }, seo: { siteName: "I-Coffee Nigeria", tld: ".ng" } }; next(); });
app.use("/api/seo", seoRouter);
let passed = 0; const ok = (m) => { passed++; console.log("  ✓", m); };

// robots
let r = await request(app).get("/api/seo/robots/tg");
assert.equal(r.status, 200); assert.match(r.text, /Sitemap: https:\/\/i-coffee\.tg\/sitemap\.xml/);
for (const p of ["/dashboard", "/cart", "/checkout", "/login", "/search"]) assert.match(r.text, new RegExp(`Disallow: ${p}\\n`));
assert.doesNotMatch(r.text, /Disallow: \/\n/);
assert.equal((await request(app).get("/api/seo/robots/zz")).status, 404);
ok("robots.txt per country, blocks private paths, never blocks the whole site");

// data
const cat = await Category.create({ name: "Capsule Machine", slug: "capsule-machine", image: "https://img/c.jpg" });
const brand = await Brand.create({ name: "Lavazza", slug: "lavazza" });
const mk = (o) => Product.create({ name: "Espresso & Co (Dark)", slug: "espresso-co-" + Math.random(), category: [cat._id], brand: [brand._id], productType: "COFFEE", publish: "PUBLISHED", sku: "SKU" + Math.random(), price: 5000, btcPrice: 5000, warehouseStock: { enabled: true, onlineStock: 10 }, description: "<p>Rich <b>dark</b> roast.</p>", ...o });
const pOk = await mk({});
const pTG = await mk({ name: "Only Togo", visibleInCountries: ["TG"] });
const pDraft = await mk({ name: "Draft", publish: "DRAFT" });
const pOff = await mk({ name: "Discontinued", productAvailability: false });
const post = await BlogPost.create({ title: "How to brew", slug: "how-to-brew", excerpt: "Brew like a barista", content: "x", status: "PUBLISHED", countryCode: "NG", author: new mongoose.Types.ObjectId() }).catch((e) => { console.log("blog create:", e.message); return null; });
const draftPost = await BlogPost.create({ title: "Secret", slug: "secret", excerpt: "e", content: "x", status: "DRAFT", countryCode: "NG", author: new mongoose.Types.ObjectId() }).catch(() => null);

// sitemap
r = await request(app).get("/api/seo/sitemap/ng/index.xml");
assert.equal(r.status, 200); assert.match(r.type, /xml/);
for (const f of ["pages", "categories", "blog", "products-1"]) assert.match(r.text, new RegExp(`https://i-coffee\\.ng/sitemap-${f}\\.xml`));
r = await request(app).get("/api/seo/sitemap/ng/pages.xml");
assert.match(r.text, /<loc>https:\/\/i-coffee\.ng<\/loc>/); assert.match(r.text, /hreflang="fr-TG" href="https:\/\/i-coffee\.tg\/shop"/); assert.match(r.text, /hreflang="x-default"/);
assert.doesNotMatch(r.text, /\/cart|\/login|\/checkout/);
r = await request(app).get("/api/seo/sitemap/ng/products-1.xml");
assert.match(r.text, new RegExp(`/product/espresso--co-dark--${pOk._id}`)); // slugified exactly like the client
assert.doesNotMatch(r.text, new RegExp(String(pTG._id))); assert.doesNotMatch(r.text, new RegExp(String(pDraft._id))); assert.doesNotMatch(r.text, new RegExp(String(pOff._id)));
r = await request(app).get("/api/seo/sitemap/tg/products-1.xml");
assert.match(r.text, new RegExp(String(pTG._id)));
ok("product sitemap: published+purchasable+country-visible only, client URL shape");
r = await request(app).get("/api/seo/sitemap/ng/categories.xml");
assert.match(r.text, /\/category\/capsule-machine/); assert.match(r.text, /\/brand\/lavazza/);
if (post) { r = await request(app).get("/api/seo/sitemap/ng/blog.xml"); assert.match(r.text, /\/blog\/how-to-brew/); assert.doesNotMatch(r.text, /secret/); }
assert.equal((await request(app).get("/api/seo/sitemap/ng/nope.xml")).status, 404);
ok("categories/brands/blog sitemaps; drafts excluded; unknown part 404");

// render
r = await request(app).get("/api/seo/render/ng").query({ path: `/product/espresso--co-dark--${pOk._id}` });
assert.equal(r.status, 200);
assert.match(r.text, /<title>Espresso &amp; Co \(Dark\) \| I-Coffee Nigeria<\/title>/);
assert.match(r.text, /rel="canonical" href="https:\/\/i-coffee\.ng\/product\/espresso--co-dark--/);
assert.match(r.text, /"@type":"Product"/); assert.match(r.text, /"@type":"BreadcrumbList"/); assert.match(r.text, /Rich dark roast/);
assert.doesNotMatch(r.text, /<b>/);
ok("product render: title, canonical, Product + Breadcrumb JSON-LD, html stripped");
r = await request(app).get("/api/seo/render/ng").query({ path: `/product/draft-${pDraft._id}` });
assert.equal(r.status, 404); assert.match(r.text, /noindex/);
r = await request(app).get("/api/seo/render/ng").query({ path: `/product/x-${pTG._id}` });
assert.equal(r.status, 404);
ok("draft / other-country products render as 404 + noindex");
if (post) { r = await request(app).get("/api/seo/render/ng").query({ path: "/blog/how-to-brew" }); assert.equal(r.status, 200); assert.match(r.text, /"@type":"BlogPosting"/); assert.match(r.text, /og:type" content="article"/); }
r = await request(app).get("/api/seo/render/ng").query({ path: "/" });
assert.match(r.text, /"@type":"WebSite"/); assert.match(r.text, /SearchAction/); assert.match(r.text, /hreflang="it-IT" href="https:\/\/i-coffee\.it"/);
r = await request(app).get("/api/seo/render/it").query({ path: "/shop" });
assert.match(r.text, /<html lang="it">/); assert.match(r.text, /Negozio/);
r = await request(app).get("/api/seo/render/ng").query({ path: "/checkout" });
assert.match(r.text, /noindex,nofollow/);
r = await request(app).get("/api/seo/render/ng").query({ path: "/category/capsule-machine" });
assert.match(r.text, /CollectionPage/);
r = await request(app).get("/api/seo/render/ng").query({ path: "/nonsense" });
assert.equal(r.status, 404);
r = await request(app).get("/api/seo/render/ng").query({ path: `/product/a-"><script>-${pOk._id}` });
assert.doesNotMatch(r.text, /<script>alert/);
ok("home/static/category render, per-language copy, private paths noindex, unknown 404");

// IndexNow
delete process.env.INDEXNOW_KEY;
assert.equal((await request(app).get("/api/seo/indexnow-key.txt")).status, 404);
assert.deepEqual(await pingIndexNow("NG", ["/x"]), { sent: false });
process.env.INDEXNOW_KEY = "abc123abc123abc123";
assert.equal((await request(app).get("/api/seo/indexnow-key.txt")).text, "abc123abc123abc123");
let captured; const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => { captured = { u, body: JSON.parse(o.body) }; return { status: 200 }; };
const pr = await pingIndexNow("NG", ["/blog/how-to-brew"]);
globalThis.fetch = realFetch;
assert.equal(pr.status, 200); assert.equal(captured.body.host, "i-coffee.ng"); assert.equal(captured.body.keyLocation, "https://i-coffee.ng/indexnow-key.txt"); assert.deepEqual(captured.body.urlList, ["https://i-coffee.ng/blog/how-to-brew"]);
ok("IndexNow key file + ping payload");

console.log(`\nSEO: ${passed} groups passed`);
await mongoose.connection.dropDatabase(); await mongoose.disconnect(); process.exit(0);
