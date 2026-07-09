/**
 * services/countryService.js
 *
 * PHASE 3 — COUNTRY AS A FIRST-CLASS ENTITY
 *
 * Runtime resolution of country data. Reads from the Country collection with a
 * short-TTL in-process cache, falling back to config/countries/index.js so the
 * platform works before/without seeding and if the DB is briefly unavailable.
 *
 * Everything that previously imported COUNTRY_CONFIG directly can migrate to
 * these async helpers. countryDetect and other hot-path callers use the cached
 * sync accessors after the cache is warm.
 */

import CountryModel from "../models/country.model.js";
import {
  COUNTRY_CONFIG,
  DOMAIN_MAP,
  DEFAULT_COUNTRY,
  getCountryByDomain as configGetByDomain,
  getCountryByCode as configGetByCode,
} from "../config/countries/index.js";

const TTL_MS = 60 * 1000; // 1 minute

let cache = {
  byCode: new Map(), // code → country object
  byDomain: new Map(), // hostname → code
  loadedAt: 0,
  version: 0,
};

/** Normalise a Country doc (or config object) to a plain resolved shape. */
function normalise(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === "function" ? doc.toObject() : doc;
  return {
    _id: o._id ? String(o._id) : "",
    code: o.code,
    name: o.name,
    status: o.status || "ACTIVE",
    isHQ: !!o.isHQ,
    domain: o.domain || "",
    domains: o.domains || [],
    adminDomain: o.adminDomain || "",
    currency: o.currency || {},
    language: o.language || { default: "en", supported: ["en"] },
    timezone: o.timezone || "",
    phonePrefix: o.phonePrefix || "",
    flagEmoji: o.flagEmoji || "",
    payments: o.payments || {},
    tax: o.tax || {},
    shipping: o.shipping || {},
    branding: o.branding || {},
    contacts: o.contacts || {},
    content: o.content || {},
    tawk: o.tawk || {},
    seo: o.seo || {},
    featureFlags: o.featureFlags || {},
    invoiceSeries: o.invoiceSeries || { prefix: "INV", nextNumber: 1 },
  };
}

/** Build cache from config (fallback seed for the maps). */
function seedCacheFromConfig() {
  const byCode = new Map();
  const byDomain = new Map();
  for (const [code, cfg] of Object.entries(COUNTRY_CONFIG)) {
    byCode.set(code, normalise({ ...cfg, isHQ: code === DEFAULT_COUNTRY }));
  }
  for (const [host, code] of Object.entries(DOMAIN_MAP)) {
    byDomain.set(host, code);
  }
  return { byCode, byDomain };
}

/**
 * Refresh the cache from the DB. If the DB has no countries yet (unseeded) or
 * errors, keep/seed from config so nothing breaks.
 */
export async function refreshCountryCache() {
  const base = seedCacheFromConfig();
  try {
    const docs = await CountryModel.find({});
    if (docs && docs.length) {
      for (const doc of docs) {
        const c = normalise(doc);
        base.byCode.set(c.code, c);
        // Map primary + additional domains.
        if (c.domain) base.byDomain.set(c.domain.toLowerCase(), c.code);
        for (const d of c.domains) base.byDomain.set(String(d).toLowerCase(), c.code);
      }
    }
  } catch (err) {
    console.warn("countryService: DB read failed, using config fallback:", err.message);
  }
  cache = {
    byCode: base.byCode,
    byDomain: base.byDomain,
    loadedAt: Date.now(),
    version: cache.version + 1,
  };
  return cache;
}

async function ensureFresh() {
  if (Date.now() - cache.loadedAt > TTL_MS || cache.byCode.size === 0) {
    await refreshCountryCache();
  }
}

/** Force a cache bump — call after any Country write. */
export function invalidateCountryCache() {
  cache.loadedAt = 0;
}

// ── Async resolvers (preferred) ──────────────────────────────────────────────

export async function resolveByCode(code = "") {
  await ensureFresh();
  const c = cache.byCode.get(String(code).toUpperCase());
  return c || normalise(configGetByCode(code)) || cache.byCode.get(DEFAULT_COUNTRY);
}

export async function resolveByDomain(hostname = "") {
  await ensureFresh();
  const host = String(hostname).toLowerCase().split(":")[0];
  const withPort = String(hostname).toLowerCase();
  const code =
    cache.byDomain.get(withPort) ||
    cache.byDomain.get(host) ||
    DEFAULT_COUNTRY;
  return cache.byCode.get(code) || normalise(configGetByDomain(hostname));
}

export async function listCountries({ activeOnly = false } = {}) {
  await ensureFresh();
  const all = [...cache.byCode.values()];
  return activeOnly ? all.filter((c) => c.status === "ACTIVE") : all;
}

export async function getHQCountry() {
  await ensureFresh();
  return [...cache.byCode.values()].find((c) => c.isHQ) || cache.byCode.get(DEFAULT_COUNTRY);
}

// ── Sync accessors (hot path — assume cache warmed at boot) ───────────────────

export function syncByCode(code = "") {
  const c = cache.byCode.get(String(code).toUpperCase());
  return c || normalise(configGetByCode(code)) || cache.byCode.get(DEFAULT_COUNTRY) || null;
}

export function syncByDomain(hostname = "") {
  const host = String(hostname).toLowerCase().split(":")[0];
  const withPort = String(hostname).toLowerCase();
  const code =
    cache.byDomain.get(withPort) || cache.byDomain.get(host) || DEFAULT_COUNTRY;
  return cache.byCode.get(code) || normalise(configGetByDomain(hostname));
}

export function cacheVersion() {
  return cache.version;
}
