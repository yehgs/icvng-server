/**
 * services/catalogue/catalogueService.js
 *
 * Builds the data behind the printable product catalogue:
 *   1. resolveCatalogueContext()  – WHO prints WHAT country/language/currency
 *   2. buildProductQuery()        – filters → Mongo query (+ in-memory post filters)
 *   3. loadCatalogueRows()        – products → localized, currency-converted rows
 *
 * Rules (see PRD_ADDENDUM_3_catalogue_and_chat.md §A):
 *   • Country-scoped (foreign) admins ALWAYS print for their own country: that
 *     country's default language and currency (Togo → French + CFA/XOF).
 *   • HQ (GLOBAL) admins print for the HQ country by default and may pick any
 *     active country (and one of its supported languages).
 *   • All stored prices are NGN (platform base currency). They are converted
 *     with the ExchangeRate collection (MANUAL rates win over API rates, same
 *     as every other conversion in the app). No rate → 422, never a silently
 *     wrong price.
 *   • B2B price is HQ-only data: stripped for country-scoped admins, exactly
 *     like the Products admin list does.
 *   • Product visibility follows `visibleInCountries` (empty = everywhere).
 */

import mongoose from "mongoose";
import ProductModel from "../../models/product.model.js";
import CategoryModel from "../../models/category.model.js";
import SubCategoryModel from "../../models/subCategory.model.js";
import BrandModel from "../../models/brand.model.js";
import "../../models/tag.model.js"; // registers the `tag` model used by populate("tags")
import DirectPricingModel from "../../models/direct-pricing.model.js";
import ExchangeRateModel from "../../models/exchange-rate.model.js";
import { computeEffectivePrices } from "../../utils/mergeDirectPricing.js";
import { getEffectiveOnlineStock } from "../../utils/manualOrderValidation.js";
import { localizeList } from "../../utils/translationService.js";
import { getHQCountry, syncByCode, listCountries } from "../countryService.js";
import { resolveCatalogueLanguage } from "./catalogueStrings.js";

export const BASE_CURRENCY = "NGN"; // all stored prices are NGN
export const MAX_PRODUCTS = 2000;
export const MAX_PRODUCTS_WITH_IMAGES = 600;

/**
 * Togglable columns. `default: true` for all — "by default all product info
 * displays, including images". `hqOnly` fields never reach country-scoped admins.
 */
export const FIELD_DEFS = [
  { key: "image", group: "media" },
  { key: "sku", group: "identity" },
  { key: "brand", group: "identity" },
  { key: "category", group: "identity" },
  { key: "subCategory", group: "identity" },
  { key: "productType", group: "identity" },
  { key: "shortDescription", group: "text" },
  { key: "description", group: "text" },
  { key: "price", group: "pricing" },
  { key: "deliveryPrices", group: "pricing" },
  { key: "discount", group: "pricing" },
  { key: "btbPrice", group: "pricing", hqOnly: true },
  { key: "availability", group: "stock" },
  { key: "stockQty", group: "stock" },
  { key: "unit", group: "specs" },
  { key: "packaging", group: "specs" },
  { key: "weight", group: "specs" },
  { key: "coffeeDetails", group: "specs" },
  { key: "tags", group: "specs" },
  { key: "rating", group: "specs" },
];

export function fieldDefsFor(isCountryScoped) {
  return FIELD_DEFS.filter((f) => !(isCountryScoped && f.hqOnly)).map((f) => ({
    ...f,
    default: true,
  }));
}

/** Normalise the requested field map → { key: boolean } with default-on. */
export function resolveFields(requested, isCountryScoped) {
  const out = {};
  for (const f of fieldDefsFor(isCountryScoped)) {
    out[f.key] = requested && f.key in requested ? !!requested[f.key] : true;
  }
  return out;
}

// ── 1. Context ───────────────────────────────────────────────────────────────

export class CatalogueError extends Error {
  constructor(message, status = 400, code = "CATALOGUE_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function getRate(toCurrency) {
  const to = String(toCurrency || BASE_CURRENCY).toUpperCase();
  if (to === BASE_CURRENCY) return 1;
  const rate = await ExchangeRateModel.getRate(BASE_CURRENCY, to);
  if (!rate || !(rate > 0)) {
    throw new CatalogueError(
      `No exchange rate configured for ${BASE_CURRENCY} → ${to}. Add one in Exchange Rates before printing this catalogue.`,
      422,
      "NO_EXCHANGE_RATE",
    );
  }
  return rate;
}

/**
 * @param {object} p
 * @param {string|null} p.countryScope  req.countryScope (null = HQ/global admin)
 * @param {string} [p.country]          requested country (HQ admins only)
 * @param {string} [p.language]         requested language (HQ admins only)
 */
export async function resolveCatalogueContext({ countryScope, country, language }) {
  const isCountryScoped = !!countryScope;
  let code;
  if (isCountryScoped) {
    code = String(countryScope).toUpperCase();
  } else if (country) {
    code = String(country).toUpperCase();
  } else {
    code = (await getHQCountry())?.code || "NG";
  }

  const c = syncByCode(code);
  if (!c || c.code !== code) {
    throw new CatalogueError(`Unknown country "${code}".`, 400, "UNKNOWN_COUNTRY");
  }

  const supported = c.language?.supported?.length ? c.language.supported : [c.language?.default || "en"];
  let lang = c.language?.default || "en";
  if (!isCountryScoped && language && (supported.includes(language) || language === "en")) {
    lang = language;
  }
  const printLanguage = resolveCatalogueLanguage(lang);

  const currency = {
    code: c.currency?.code || BASE_CURRENCY,
    symbol: c.currency?.symbol || "",
    decimals: Number.isInteger(c.currency?.decimals) ? c.currency.decimals : 2,
  };
  const rate = await getRate(currency.code);

  return {
    isCountryScoped,
    countryCode: code,
    countryName: c.name,
    language: printLanguage,
    requestedLanguage: lang,
    languageFellBack: printLanguage !== lang,
    supportedLanguages: supported,
    currency,
    rate,
    brandName: c.seo?.siteName || `I-Coffee ${c.name}`,
  };
}

/** Countries an admin may print for (own country if scoped, else all active). */
export async function printableCountries(countryScope) {
  const all = await listCountries({ activeOnly: true });
  const list = countryScope ? all.filter((x) => x.code === countryScope) : all;
  return list.map((x) => ({
    code: x.code,
    name: x.name,
    flag: x.flagEmoji || "",
    currency: x.currency?.code,
    defaultLanguage: x.language?.default || "en",
    supportedLanguages: x.language?.supported || [x.language?.default || "en"],
    isHQ: !!x.isHQ,
  }));
}

// ── 2. Query ─────────────────────────────────────────────────────────────────

const oid = (v) => {
  try {
    return new mongoose.Types.ObjectId(String(v));
  } catch {
    return null;
  }
};
const idList = (v) =>
  (Array.isArray(v) ? v : v ? [v] : []).map(oid).filter(Boolean);
const strList = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(String).filter(Boolean);

export function buildProductQuery(filters = {}, countryCode) {
  const and = [
    {
      $or: [
        { visibleInCountries: { $size: 0 } },
        { visibleInCountries: { $exists: false } },
        { visibleInCountries: countryCode },
      ],
    },
  ];

  const publish = filters.publish || "PUBLISHED";
  if (publish !== "ALL") and.push({ publish });

  if (filters.search && String(filters.search).trim()) {
    const esc = String(filters.search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    and.push({
      $or: [
        { name: { $regex: esc, $options: "i" } },
        { sku: { $regex: esc, $options: "i" } },
      ],
    });
  }
  const cats = idList(filters.categories ?? filters.category);
  if (cats.length) and.push({ category: { $in: cats } });
  const subs = idList(filters.subCategories ?? filters.subCategory);
  if (subs.length) and.push({ subCategory: { $in: subs } });
  const brands = idList(filters.brands ?? filters.brand);
  if (brands.length) and.push({ brand: { $in: brands } });
  const types = strList(filters.productTypes ?? filters.productType);
  if (types.length) and.push({ productType: { $in: types } });
  const tags = idList(filters.tags);
  if (tags.length) and.push({ tags: { $in: tags } });
  if (filters.featured === true || filters.featured === "true") and.push({ featured: true });
  if (filters.btbOnly === true || filters.btbOnly === "true") and.push({ btbProduct: true });
  const roast = strList(filters.roastLevels ?? filters.roastLevel);
  if (roast.length) and.push({ roastLevel: { $in: roast } });

  return { $and: and };
}

// ── 3. Rows ──────────────────────────────────────────────────────────────────

function stripHtml(s = "", max = 600) {
  const t = String(s)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Convert an NGN amount into the print currency with the currency's decimals. */
export function convertAmount(ngnAmount, ctx) {
  const n = Number(ngnAmount) || 0;
  if (n <= 0) return 0;
  const f = 10 ** ctx.currency.decimals;
  return Math.round(n * ctx.rate * f) / f;
}

/**
 * Format money for the PDF. Helvetica (WinAnsi) has no ₦ glyph, so NGN prints
 * as "NGN 12,500"; XOF as "12 500 CFA"; EUR as "12,50 €" (fr/it) / "€12.50" (en).
 */
export function formatMoney(amount, ctx) {
  const { code, decimals } = ctx.currency;
  const locale = { fr: "fr-FR", it: "it-IT", es: "es-ES", pt: "pt-PT", nl: "nl-NL" }[ctx.language] || "en-US";
  let num = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount || 0);
  num = num.replace(/[  ]/g, " "); // narrow/no-break space is not in WinAnsi
  if (code === "XOF" || code === "XAF") return `${num} CFA`;
  if (code === "EUR") return ctx.language === "en" ? `€${num}` : `${num} €`;
  if (code === "USD") return `$${num}`;
  if (code === "GBP") return `£${num}`;
  return `${code} ${num}`;
}

/**
 * Cloudinary delivery URL → small JPEG (pdfkit only reads JPEG/PNG; webp/avif
 * delivery would fail). Non-Cloudinary URLs pass through unchanged.
 */
export function pdfImageUrl(url) {
  if (typeof url !== "string" || !url) return null;
  if (url.includes("res.cloudinary.com") && url.includes("/upload/")) {
    return url.replace("/upload/", "/upload/f_jpg,q_70,w_360,h_360,c_fit,b_white/");
  }
  return url;
}

export async function loadCatalogueRows({ filters = {}, fields, ctx, sort }) {
  const query = buildProductQuery(filters, ctx.countryCode);
  const wantImages = !!fields.image;

  const total = await ProductModel.countDocuments(query);
  const cap = wantImages ? MAX_PRODUCTS_WITH_IMAGES : MAX_PRODUCTS;
  // Post-filters (price/stock) can only shrink the set; we cap the raw set.
  if (total > cap) {
    throw new CatalogueError(
      wantImages
        ? `${total} products match — too many to print with images (max ${MAX_PRODUCTS_WITH_IMAGES}). Narrow the filters or switch images off.`
        : `${total} products match — too many to print (max ${MAX_PRODUCTS}). Narrow the filters.`,
      413,
      "TOO_MANY_PRODUCTS",
    );
  }

  let products = await ProductModel.find(query)
    .populate("category", "name")
    .populate("subCategory", "name")
    .populate("brand", "name")
    .populate("tags", "name")
    .lean();

  // DirectPricing overrides (read-only here; no write-back side effect).
  const dps = await DirectPricingModel.find({
    product: { $in: products.map((p) => p._id) },
    isActive: true,
  }).lean();
  const dpBy = new Map(dps.map((d) => [String(d.product), d]));

  // Localise product text, then taxonomy names (brands are proper nouns: skipped).
  products = await localizeList("product", products, ctx.language);
  const cats = await localizeList("category", products.map((p) => p.category).filter(Boolean), ctx.language);
  const subs = await localizeList("subCategory", products.map((p) => p.subCategory).filter(Boolean), ctx.language);
  const tagDocs = await localizeList("tag", products.flatMap((p) => p.tags || []), ctx.language);
  const byId = (arr) => new Map(arr.map((d) => [String(d._id), d]));
  const catBy = byId(cats), subBy = byId(subs), tagBy = byId(tagDocs);

  const rows = products.map((p) => {
    const eff = computeEffectivePrices(p, dpBy.get(String(p._id)));
    const regularNgn = eff.btcPrice > 0 ? eff.btcPrice : p.price;
    const stock = getEffectiveOnlineStock(p);
    const cat = p.category && (catBy.get(String(p.category._id)) || p.category);
    const sub = p.subCategory && (subBy.get(String(p.subCategory._id)) || p.subCategory);
    return {
      id: String(p._id),
      name: p.name,
      sku: p.sku,
      imageUrl: Array.isArray(p.image) && typeof p.image[0] === "string" ? p.image[0] : null,
      brand: (p.brand || []).map((b) => b.name).filter(Boolean).join(", "),
      categoryId: cat ? String(cat._id) : null,
      category: cat?.name || "",
      subCategory: sub?.name || "",
      productType: p.productType || "",
      shortDescription: stripHtml(p.shortDescription, 220),
      description: stripHtml(p.description, 600),
      priceNgn: regularNgn || 0,
      price: convertAmount(regularNgn, ctx),
      delivery3: convertAmount(eff.price3weeksDelivery, ctx),
      delivery5: convertAmount(eff.price5weeksDelivery, ctx),
      btbPrice: ctx.isCountryScoped ? 0 : convertAmount(p.btbPrice, ctx),
      discount: Number(p.discount) || 0,
      inStock: stock > 0,
      stockQty: stock,
      unit: p.unit || "",
      packaging: p.packaging || "",
      weight: p.weight || 0,
      roastLevel: p.roastLevel || "",
      blend: p.blend || "",
      origin: p.roastOrigin || p.coffeeOrigin || "",
      intensity: p.intensity || "",
      aroma: stripHtml(p.aromaticProfile || "", 160),
      tags: (p.tags || []).map((t) => (tagBy.get(String(t._id)) || t).name).filter(Boolean),
      rating: p.averageRating || 0,
      createdAt: p.createdAt,
    };
  });

  // Price + stock post-filters (price bounds are in the PRINT currency).
  const min = filters.priceMin !== undefined && filters.priceMin !== "" ? Number(filters.priceMin) : null;
  const max = filters.priceMax !== undefined && filters.priceMax !== "" ? Number(filters.priceMax) : null;
  let out = rows.filter((r) => {
    if (min !== null && !Number.isNaN(min) && r.price < min) return false;
    if (max !== null && !Number.isNaN(max) && r.price > max) return false;
    if (filters.availability === "inStock" && !r.inStock) return false;
    if (filters.availability === "onRequest" && r.inStock) return false;
    if ((filters.hasPrice === true || filters.hasPrice === "true") && !(r.price > 0)) return false;
    return true;
  });

  // Sorting (default: category A→Z, then name).
  const dir = sort?.order === "desc" ? -1 : 1;
  const cmp = {
    name: (a, b) => a.name.localeCompare(b.name),
    price: (a, b) => a.price - b.price,
    newest: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    category: (a, b) => (a.category || "~").localeCompare(b.category || "~") || a.name.localeCompare(b.name),
  }[sort?.by] || ((a, b) => (a.category || "~").localeCompare(b.category || "~") || a.name.localeCompare(b.name));
  out.sort((a, b) => dir * cmp(a, b));

  return { rows: out, matched: total };
}

/** Filter-dropdown data for the admin page. */
export async function loadFilterOptions() {
  const [categories, subCategories, brands] = await Promise.all([
    CategoryModel.find({}, "name").sort({ name: 1 }).lean(),
    SubCategoryModel.find({}, "name category").sort({ name: 1 }).lean(),
    BrandModel.find({}, "name").sort({ name: 1 }).lean(),
  ]);
  return {
    categories: categories.map((c) => ({ id: String(c._id), name: c.name })),
    subCategories: subCategories.map((c) => ({ id: String(c._id), name: c.name, category: c.category ? String(c.category) : null })),
    brands: brands.map((c) => ({ id: String(c._id), name: c.name })),
    productTypes: ["COFFEE", "COFFEE_BEANS", "MACHINE", "ACCESSORIES", "TEA", "DRINKS"],
    roastLevels: ["LIGHT", "MEDIUM", "DARK"],
  };
}
