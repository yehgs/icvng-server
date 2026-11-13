/**
 * controllers/seo.controller.js
 *
 * Everything search engines need, per storefront domain:
 *
 *   GET /api/seo/robots/:code            → robots.txt for that country's domain
 *   GET /api/seo/sitemap/:code/:file     → sitemap index + parts (pages, categories, blog, products-N)
 *   GET /api/seo/render/:code?path=/x    → crawler-friendly HTML (title, meta, JSON-LD, readable content)
 *   GET /api/seo/indexnow-key.txt        → IndexNow key file (INDEXNOW_KEY env)
 *   GET /api/seo/meta                    → legacy: hreflang/OG info for the detected host
 *
 * The storefront is a static SPA on Vercel, so vercel.json rewrites /robots.txt, /sitemap*.xml,
 * /indexnow-key.txt (and bot user-agents) on each domain to these endpoints. `:code` is the
 * country code or TLD (ng|tg|bj|it, any case).
 *
 * Visibility rules mirror the storefront: a product is listed only when it is PUBLISHED,
 * purchasable (buildClientVisibilityFilter) and visible in the country (visibleInCountries).
 */
import { COUNTRY_CONFIG } from "../config/countries/index.js";
import ProductModel from "../models/product.model.js";
import CategoryModel from "../models/category.model.js";
import BrandModel from "../models/brand.model.js";
import BlogPostModel from "../models/blog-post.model.js";
import SitePageModel from "../models/sitePage.model.js";
import { buildClientVisibilityFilter } from "./product.controller.js";

const PRODUCTS_PER_SITEMAP = 5000;
const CACHE = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

/** Public, indexable static pages (path → changefreq/priority). */
export const STATIC_PAGES = [
  { path: "", changefreq: "daily", priority: "1.0" },
  { path: "/shop", changefreq: "daily", priority: "0.9" },
  { path: "/blogs", changefreq: "daily", priority: "0.8" },
  { path: "/about-us", changefreq: "monthly", priority: "0.6" },
  { path: "/our-story", changefreq: "monthly", priority: "0.6" },
  { path: "/contact-us", changefreq: "monthly", priority: "0.6" },
  { path: "/faq", changefreq: "monthly", priority: "0.5" },
  { path: "/partner-with-us", changefreq: "monthly", priority: "0.5" },
  { path: "/book-barista-training", changefreq: "monthly", priority: "0.6" },
  { path: "/rent-coffee-machine", changefreq: "monthly", priority: "0.6" },
  { path: "/gift-cards/buy", changefreq: "monthly", priority: "0.5" },
  { path: "/shipping-policy", changefreq: "yearly", priority: "0.3" },
  { path: "/return-policy", changefreq: "yearly", priority: "0.3" },
  { path: "/terms-conditions", changefreq: "yearly", priority: "0.3" },
  { path: "/privacy-policy", changefreq: "yearly", priority: "0.3" },
];

/** Paths that must never be crawled/indexed (private, transactional, duplicate-by-query). */
export const DISALLOWED = [
  "/dashboard",
  "/user",
  "/cart",
  "/checkout",
  "/login",
  "/register",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
  "/verification-otp",
  "/auth/",
  "/success",
  "/cancel",
  "/order-success",
  "/payment/",
  "/bank-transfer-instructions",
  "/wishlist",
  "/compare",
  "/search",
  "/gift-cards/balance",
  "/gift-cards/paystack/",
  "/gift-cards/stripe/",
  "/gift-cards/cinetpay/",
];

/* ───────────────────────── helpers ───────────────────────── */

export function esc(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const stripHtml = (s = "") =>
  String(s).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

const clip = (s = "", n = 160) => {
  const t = stripHtml(s);
  return t.length <= n ? t : `${t.slice(0, n - 1).replace(/\s+\S*$/, "")}…`;
};

/** ng | NG | tg … → country config (or null). */
export function countryFromParam(param = "") {
  const p = String(param).toUpperCase().replace(/^\./, "");
  return COUNTRY_CONFIG[p] || null;
}

const siteUrl = (c) => `https://${c.domain}`;
const hreflangOf = (c) => `${c.language?.default || "en"}-${c.code}`;
// Verbatim port of client/src/utils/valideURLConvert.js — sitemap URLs must match what the storefront links to.
const slugify = (name) =>
  name
    ?.toString()
    .replaceAll(" ", "-")
    .replaceAll(",", "-")
    .replaceAll("&", "-")
    .replaceAll("/", "-")
    .replaceAll("\\", "-")
    .replaceAll("%", "-")
    .replaceAll("+", "-")
    .replaceAll("(", "-")
    .replaceAll(")", "-")
    .replaceAll("--", "-")
    .toLowerCase();

/** Same URL shape the client builds: /product/<name-slug>-<id>. */
export const productPath = (p) => `/product/${slugify(p.name)}-${p._id}`;

const visibleInCountry = (code) => ({
  $or: [{ visibleInCountries: { $size: 0 } }, { visibleInCountries: code }, { visibleInCountries: { $exists: false } }],
});

async function productFilter(code) {
  const base = await buildClientVisibilityFilter();
  return { $and: [base, visibleInCountry(code)] };
}

const blogFilter = (code) => ({
  status: "PUBLISHED",
  $or: [{ countryCode: code }, { countryCode: { $exists: false } }],
});

const iso = (d) => (d ? new Date(d).toISOString() : undefined);

function urlEntry({ loc, lastmod, changefreq, priority, alternates = [] }) {
  return [
    "  <url>",
    `    <loc>${esc(loc)}</loc>`,
    lastmod ? `    <lastmod>${iso(lastmod)}</lastmod>` : "",
    changefreq ? `    <changefreq>${changefreq}</changefreq>` : "",
    priority ? `    <priority>${priority}</priority>` : "",
    ...alternates.map((a) => `    <xhtml:link rel="alternate" hreflang="${esc(a.hreflang)}" href="${esc(a.href)}"/>`),
    "  </url>",
  ]
    .filter(Boolean)
    .join("\n");
}

const wrapUrlset = (entries) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join("\n")}\n</urlset>\n`;

/* ───────────────────────── robots.txt ───────────────────────── */

export function buildRobots(country) {
  const lines = [
    "# i-Coffee — crawl rules",
    "User-agent: *",
    "Allow: /",
    ...DISALLOWED.map((p) => `Disallow: ${p}`),
    "Disallow: /*?*utm_",
    "Disallow: /*?*sessionid=",
    "",
    `Sitemap: ${siteUrl(country)}/sitemap.xml`,
    "",
  ];
  return lines.join("\n");
}

export function robotsTxt(req, res) {
  const country = countryFromParam(req.params.code);
  if (!country) return res.status(404).type("text/plain").send("Not found");
  res.set("Cache-Control", CACHE).type("text/plain").send(buildRobots(country));
}

/* ───────────────────────── sitemaps ───────────────────────── */

export async function sitemapFile(req, res) {
  try {
    const country = countryFromParam(req.params.code);
    if (!country) return res.status(404).type("text/plain").send("Not found");
    const base = siteUrl(country);
    const file = String(req.params.file || "").replace(/\.xml$/, "");
    res.set("Cache-Control", CACHE).type("application/xml");

    if (file === "index") {
      const productCount = await ProductModel.countDocuments(await productFilter(country.code));
      const parts = ["pages", "categories", "blog"];
      const pages = Math.max(1, Math.ceil(productCount / PRODUCTS_PER_SITEMAP));
      for (let i = 1; i <= pages; i += 1) parts.push(`products-${i}`);
      const now = new Date().toISOString();
      return res.send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${parts
          .map((p) => `  <sitemap>\n    <loc>${base}/sitemap-${p}.xml</loc>\n    <lastmod>${now}</lastmod>\n  </sitemap>`)
          .join("\n")}\n</sitemapindex>\n`
      );
    }

    if (file === "pages") {
      const all = Object.values(COUNTRY_CONFIG);
      const entries = STATIC_PAGES.map((p) =>
        urlEntry({
          loc: `${base}${p.path}`,
          changefreq: p.changefreq,
          priority: p.priority,
          // Same page exists on every country domain → tell engines which is for whom.
          alternates: [
            ...all.map((c) => ({ hreflang: hreflangOf(c), href: `${siteUrl(c)}${p.path}` })),
            { hreflang: "x-default", href: `${siteUrl(COUNTRY_CONFIG.NG)}${p.path}` },
          ],
        })
      );
      return res.send(wrapUrlset(entries));
    }

    if (file === "categories") {
      const filter = await productFilter(country.code);
      const [catIds, brandIds] = await Promise.all([
        ProductModel.distinct("category", filter),
        ProductModel.distinct("brand", filter),
      ]);
      const [cats, brands] = await Promise.all([
        CategoryModel.find({ _id: { $in: catIds } }).select("slug updatedAt").lean(),
        BrandModel.find({ _id: { $in: brandIds } }).select("slug updatedAt").lean(),
      ]);
      const entries = [
        ...cats.filter((c) => c.slug).map((c) => urlEntry({ loc: `${base}/category/${c.slug}`, lastmod: c.updatedAt, changefreq: "weekly", priority: "0.8" })),
        ...brands.filter((b) => b.slug).map((b) => urlEntry({ loc: `${base}/brand/${b.slug}`, lastmod: b.updatedAt, changefreq: "weekly", priority: "0.7" })),
      ];
      return res.send(wrapUrlset(entries));
    }

    if (file === "blog") {
      const posts = await BlogPostModel.find(blogFilter(country.code)).select("slug updatedAt publishedAt").sort({ publishedAt: -1 }).limit(45000).lean();
      return res.send(
        wrapUrlset(posts.filter((p) => p.slug).map((p) => urlEntry({ loc: `${base}/blog/${p.slug}`, lastmod: p.updatedAt || p.publishedAt, changefreq: "monthly", priority: "0.7" })))
      );
    }

    const m = file.match(/^products-(\d+)$/);
    if (m) {
      const page = Math.max(1, Number(m[1]));
      const products = await ProductModel.find(await productFilter(country.code))
        .select("name updatedAt")
        .sort({ _id: 1 })
        .skip((page - 1) * PRODUCTS_PER_SITEMAP)
        .limit(PRODUCTS_PER_SITEMAP)
        .lean();
      return res.send(wrapUrlset(products.map((p) => urlEntry({ loc: `${base}${productPath(p)}`, lastmod: p.updatedAt, changefreq: "weekly", priority: "0.8" }))));
    }

    return res.status(404).type("text/plain").send("Not found");
  } catch (err) {
    console.error("sitemap error:", err.message);
    return res.status(500).type("text/plain").send("Sitemap unavailable");
  }
}

/* ───────────────────────── crawler render ───────────────────────── */

const PAGE_COPY = {
  en: {
    "": ["Buy Coffee, Espresso Machines & Accessories Online", "Shop premium Italian coffee, espresso machines and accessories with delivery from I-Coffee."],
    "/shop": ["Shop Coffee, Machines & Accessories", "Browse our full range of coffee beans, capsules, machines and accessories."],
    "/blogs": ["Coffee Stories & Insights", "Brewing guides, coffee culture and news from the I-Coffee team."],
    "/about-us": ["About Us", "Learn who we are and why we love coffee."],
    "/our-story": ["Our Story", "How I-Coffee began and what drives us."],
    "/contact-us": ["Contact Us", "Get in touch with the I-Coffee team."],
    "/faq": ["Frequently Asked Questions", "Answers about orders, delivery, payments and products."],
    "/partner-with-us": ["Partner With Us", "Become an I-Coffee partner."],
    "/book-barista-training": ["Barista Training", "Book professional barista training."],
    "/rent-coffee-machine": ["Rent a Coffee Machine", "Rent professional coffee machines for your business or event."],
    "/gift-cards/buy": ["Gift Cards", "Give the gift of great coffee with an I-Coffee gift card."],
    "/shipping-policy": ["Shipping Policy", "How we ship your order."],
    "/return-policy": ["Returns & Refunds", "Our returns and refunds policy."],
    "/terms-conditions": ["Terms & Conditions", "Terms of use for I-Coffee."],
    "/privacy-policy": ["Privacy Policy", "How we handle your personal data."],
  },
  fr: {
    "": ["Café, machines à expresso et accessoires en ligne", "Achetez du café italien premium, des machines à expresso et des accessoires avec livraison chez I-Coffee."],
    "/shop": ["Boutique : café, machines et accessoires", "Parcourez notre gamme de grains, capsules, machines et accessoires."],
    "/blogs": ["Histoires et conseils café", "Guides de préparation, culture café et actualités de l'équipe I-Coffee."],
    "/about-us": ["À propos", "Découvrez qui nous sommes."],
    "/our-story": ["Notre histoire", "Comment I-Coffee est né."],
    "/contact-us": ["Contactez-nous", "Contactez l'équipe I-Coffee."],
    "/faq": ["Questions fréquentes", "Réponses sur les commandes, la livraison et les paiements."],
  },
  it: {
    "": ["Caffè, macchine espresso e accessori online", "Acquista caffè italiano premium, macchine espresso e accessori con consegna da I-Coffee."],
    "/shop": ["Negozio: caffè, macchine e accessori", "Scopri la nostra gamma di caffè in grani, capsule, macchine e accessori."],
    "/blogs": ["Storie e approfondimenti sul caffè", "Guide, cultura del caffè e novità dal team I-Coffee."],
    "/about-us": ["Chi siamo", "Scopri chi siamo."],
    "/our-story": ["La nostra storia", "Come è nata I-Coffee."],
    "/contact-us": ["Contattaci", "Contatta il team I-Coffee."],
    "/faq": ["Domande frequenti", "Risposte su ordini, consegna e pagamenti."],
  },
};

const isDisallowedPath = (p) => DISALLOWED.some((d) => (d.endsWith("/") ? p.startsWith(d) : p === d || p.startsWith(`${d}/`)));

async function cmsSeo(code, slug) {
  const docs = await SitePageModel.find({ slug, countryCode: { $in: [code, "GLOBAL"] }, isPublished: { $ne: false } }).select("countryCode seo").lean();
  const doc = docs.find((d) => d.countryCode === code) || docs[0];
  return doc?.seo || {};
}

/** Resolve the SEO record (title/description/image/jsonLd/status) for a storefront path. */
export async function resolveSeo(country, rawPath = "/") {
  const base = siteUrl(country);
  const path = ("/" + String(rawPath).split("?")[0].split("#")[0]).replace(/\/{2,}/g, "/").replace(/\/$/, "");
  const lang = country.language?.default || "en";
  const copy = PAGE_COPY[lang] || PAGE_COPY.en;
  const siteName = country.seo?.siteName || "I-Coffee";
  const out = { status: 200, path, canonical: `${base}${path}`, type: "website", jsonLd: [], links: [] };

  if (isDisallowedPath(path)) return { ...out, status: 200, title: siteName, description: "", noindex: true };

  const crumbs = (items) => ({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, url], i) => ({ "@type": "ListItem", position: i + 1, name, item: url })),
  });

  // Product
  let m = path.match(/^\/product\/.*-([a-f0-9]{24})$/i);
  if (m) {
    const p = await ProductModel.findOne({ _id: m[1], ...(await productFilter(country.code).then((f) => f)) })
      .select("name image description shortDescription seoTitle seoDescription productAvailability brand")
      .populate("brand", "name")
      .lean()
      .catch(() => null);
    if (!p) return { ...out, status: 404, title: siteName, description: "", noindex: true };
    const img = Array.isArray(p.image) ? p.image.find((x) => typeof x === "string") : "";
    const desc = p.seoDescription || clip(p.shortDescription || p.description, 160);
    out.canonical = `${base}${productPath(p)}`;
    out.title = p.seoTitle || p.name;
    out.description = desc;
    out.image = img;
    out.type = "product";
    out.h1 = p.name;
    out.jsonLd.push({
      "@context": "https://schema.org",
      "@type": "Product",
      name: p.name,
      description: desc,
      image: Array.isArray(p.image) ? p.image.filter((x) => typeof x === "string").slice(0, 6) : undefined,
      brand: p.brand?.[0]?.name ? { "@type": "Brand", name: p.brand[0].name } : undefined,
      url: out.canonical,
    });
    out.jsonLd.push(crumbs([[siteName, base], ["Shop", `${base}/shop`], [p.name, out.canonical]]));
    return out;
  }

  // Blog post
  m = path.match(/^\/blog\/([^/]+)$/);
  if (m) {
    const b = await BlogPostModel.findOne({ slug: m[1].toLowerCase(), ...blogFilter(country.code) })
      .select("title excerpt featuredImage seoTitle seoDescription publishedAt updatedAt author")
      .lean();
    if (!b) return { ...out, status: 404, title: siteName, description: "", noindex: true };
    out.title = b.seoTitle || b.title;
    out.description = b.seoDescription || clip(b.excerpt, 160);
    out.image = typeof b.featuredImage === "string" ? b.featuredImage : b.featuredImage?.url;
    out.type = "article";
    out.h1 = b.title;
    out.published = iso(b.publishedAt);
    out.modified = iso(b.updatedAt);
    out.jsonLd.push({
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: b.title,
      description: out.description,
      image: out.image || undefined,
      datePublished: out.published,
      dateModified: out.modified,
      mainEntityOfPage: out.canonical,
      publisher: { "@type": "Organization", name: siteName, logo: { "@type": "ImageObject", url: `${base}/favicon.svg` } },
    });
    out.jsonLd.push(crumbs([[siteName, base], ["Blog", `${base}/blogs`], [b.title, out.canonical]]));
    return out;
  }

  // Category / brand
  m = path.match(/^\/(category|brand)\/([^/]+)$/) || path.match(/^\/(category)\/([^/]+)\/(?:subcategory|brand)\/.+$/);
  if (m) {
    const Model = m[1] === "brand" ? BrandModel : CategoryModel;
    const doc = await Model.findOne({ slug: m[2] }).select("name image").lean();
    if (!doc) return { ...out, status: 404, title: siteName, description: "", noindex: true };
    out.title = doc.name;
    out.description = `${doc.name} — ${copy["/shop"]?.[1] || ""}`.trim();
    out.image = doc.image || undefined;
    out.h1 = doc.name;
    out.canonical = `${base}/${m[1]}/${m[2]}`;
    out.jsonLd.push({ "@context": "https://schema.org", "@type": "CollectionPage", name: doc.name, url: out.canonical });
    out.jsonLd.push(crumbs([[siteName, base], [doc.name, out.canonical]]));
    return out;
  }

  // Static pages
  const known = STATIC_PAGES.find((p) => p.path === path);
  if (known) {
    const slug = path === "" ? "site-index" : path.replace(/^\//, "").replace(/\//g, "-");
    const seo = await cmsSeo(country.code, slug).catch(() => ({}));
    const [t, d] = copy[path] || PAGE_COPY.en[path] || [siteName, ""];
    out.title = seo.title || t;
    out.description = seo.description || d;
    out.image = seo.ogImage || undefined;
    out.h1 = seo.title || t;
    if (path === "") {
      out.jsonLd.push(
        { "@context": "https://schema.org", "@type": "Organization", name: siteName, url: base, logo: `${base}/favicon.svg` },
        {
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: siteName,
          url: base,
          inLanguage: country.language?.locale,
          potentialAction: { "@type": "SearchAction", target: `${base}/search?q={search_term_string}`, "query-input": "required name=search_term_string" },
        }
      );
    }
    return out;
  }

  return { ...out, status: 404, title: siteName, description: "", noindex: true };
}

/** Self-contained HTML for non-JS crawlers & link-preview bots. */
export function renderHtml(country, seo) {
  const base = siteUrl(country);
  const siteName = country.seo?.siteName || "I-Coffee";
  const title = seo.title && seo.title !== siteName ? `${seo.title} | ${siteName}` : siteName;
  const all = Object.values(COUNTRY_CONFIG);
  const isStatic = STATIC_PAGES.some((p) => p.path === seo.path);
  const tags = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${esc(title)}</title>`,
    seo.description ? `<meta name="description" content="${esc(seo.description)}">` : "",
    `<meta name="robots" content="${seo.noindex ? "noindex,nofollow" : "index,follow,max-image-preview:large"}">`,
    `<link rel="canonical" href="${esc(seo.canonical)}">`,
    ...(isStatic
      ? [
          ...all.map((c) => `<link rel="alternate" hreflang="${esc(hreflangOf(c))}" href="${esc(siteUrl(c) + seo.path)}">`),
          `<link rel="alternate" hreflang="x-default" href="${esc(siteUrl(COUNTRY_CONFIG.NG) + seo.path)}">`,
        ]
      : []),
    `<meta property="og:site_name" content="${esc(siteName)}">`,
    `<meta property="og:locale" content="${esc((country.language?.locale || "en-NG").replace("-", "_"))}">`,
    `<meta property="og:type" content="${seo.type === "article" ? "article" : seo.type === "product" ? "og:product" : "website"}">`,
    `<meta property="og:title" content="${esc(seo.title || siteName)}">`,
    seo.description ? `<meta property="og:description" content="${esc(seo.description)}">` : "",
    `<meta property="og:url" content="${esc(seo.canonical)}">`,
    seo.image ? `<meta property="og:image" content="${esc(seo.image)}">` : "",
    `<meta name="twitter:card" content="${seo.image ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${esc(seo.title || siteName)}">`,
    seo.description ? `<meta name="twitter:description" content="${esc(seo.description)}">` : "",
    seo.image ? `<meta name="twitter:image" content="${esc(seo.image)}">` : "",
    seo.published ? `<meta property="article:published_time" content="${esc(seo.published)}">` : "",
    seo.modified ? `<meta property="article:modified_time" content="${esc(seo.modified)}">` : "",
    ...seo.jsonLd.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`),
  ].filter(Boolean);

  const nav = STATIC_PAGES.slice(1, 10).map((p) => `<li><a href="${base}${p.path}">${esc(PAGE_COPY.en[p.path]?.[0] || p.path)}</a></li>`).join("");
  return `<!doctype html>\n<html lang="${esc(country.language?.default || "en")}"><head>${tags.join("\n")}</head><body>
<header><a href="${base}">${esc(siteName)}</a></header>
<main><h1>${esc(seo.h1 || seo.title || siteName)}</h1>${seo.image ? `<p><img src="${esc(seo.image)}" alt="${esc(seo.h1 || seo.title || "")}" width="600"></p>` : ""}${seo.description ? `<p>${esc(seo.description)}</p>` : ""}</main>
<nav><ul>${nav}</ul></nav></body></html>`;
}

export async function renderForCrawler(req, res) {
  try {
    const country = countryFromParam(req.params.code);
    if (!country) return res.status(404).type("text/plain").send("Not found");
    const seo = await resolveSeo(country, req.query.path || "/");
    res
      .status(seo.status)
      .set("Cache-Control", "public, max-age=60, s-maxage=600, stale-while-revalidate=3600")
      .set("Vary", "User-Agent")
      .type("text/html")
      .send(renderHtml(country, seo));
  } catch (err) {
    console.error("seo render error:", err.message);
    res.status(500).type("text/plain").send("Render unavailable");
  }
}

/* ───────────────────────── IndexNow ───────────────────────── */

export function indexNowKeyFile(req, res) {
  const key = process.env.INDEXNOW_KEY;
  if (!key) return res.status(404).type("text/plain").send("IndexNow not configured");
  res.set("Cache-Control", "public, max-age=86400").type("text/plain").send(key);
}

/**
 * Tell Bing, Yandex, Seznam, Naver (and other IndexNow engines) about new/changed URLs.
 * Fire-and-forget: never throws, no-op without INDEXNOW_KEY.
 * @param {string} countryCode  e.g. "NG"
 * @param {string[]} paths      storefront paths, e.g. ["/blog/my-post"]
 */
export async function pingIndexNow(countryCode, paths = []) {
  try {
    const key = process.env.INDEXNOW_KEY;
    const country = countryFromParam(countryCode);
    if (!key || !country || !paths.length) return { sent: false };
    const host = country.domain;
    const body = {
      host,
      key,
      keyLocation: `https://${host}/indexnow-key.txt`,
      urlList: paths.slice(0, 10000).map((p) => `https://${host}${p}`),
    };
    const r = await fetch("https://api.indexnow.org/IndexNow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    return { sent: true, status: r.status };
  } catch (err) {
    console.warn("IndexNow ping failed:", err.message);
    return { sent: false, error: err.message };
  }
}

/* ───────────────────────── legacy meta endpoint ───────────────────────── */

export function getSeoMeta(req, res) {
  const country = req.country;
  const domain = siteUrl(country);
  const all = Object.values(COUNTRY_CONFIG);
  return res.json({
    success: true,
    error: false,
    data: {
      siteName: country.seo.siteName,
      domain,
      locale: country.language.locale,
      language: country.language.default,
      currency: country.currency.code,
      openGraph: { siteName: country.seo.siteName, locale: country.language.locale, type: "website" },
      hreflang: [
        ...all.map((c) => ({ hreflang: hreflangOf(c), href: siteUrl(c), country: c.code })),
        { hreflang: "x-default", href: siteUrl(COUNTRY_CONFIG.NG), country: "NG" },
      ],
      canonicalBase: domain,
      tld: country.seo.tld,
    },
  });
}
