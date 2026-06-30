/**
 * middleware/countryDetect.js
 *
 * Runs early in the Express pipeline.  Reads the incoming Host header
 * (or the X-Country-Code header from trusted proxies / admin overrides),
 * resolves the matching country config, and attaches it to:
 *
 *   req.country       → full country config object  (COUNTRY_CONFIG[code])
 *   req.countryCode   → e.g. "NG"
 *
 * No other middleware or controller needs to import the country config
 * directly — they just read from req.country.
 */

import {
  getCountryByDomain,
  getCountryByCode,
  DEFAULT_COUNTRY,
  COUNTRY_CONFIG,
} from "../config/countries/index.js";

/**
 * Trust list of internal/admin callers that are allowed to override
 * the country via the X-Country-Code header.
 * In production keep this to your server-side admin panel IP or a
 * secret header value.
 */
const TRUSTED_OVERRIDE_HEADER = "x-country-code";

const countryDetect = (req, res, next) => {
  try {
    // ── 1. Admin / internal override (highest priority) ─────────────────
    const headerOverride = req.headers[TRUSTED_OVERRIDE_HEADER];
    if (headerOverride && COUNTRY_CONFIG[headerOverride.toUpperCase()]) {
      req.country = COUNTRY_CONFIG[headerOverride.toUpperCase()];
      req.countryCode = req.country.code;
      return next();
    }

    // ── 2. Derive from Host header ───────────────────────────────────────
    const host = req.headers.host || "";
    const country = getCountryByDomain(host);

    req.country = country;
    req.countryCode = country.code;

    next();
  } catch (err) {
    // Never crash on detection failure — fall back to default
    console.error("countryDetect middleware error:", err.message);
    req.country = COUNTRY_CONFIG[DEFAULT_COUNTRY];
    req.countryCode = DEFAULT_COUNTRY;
    next();
  }
};

export default countryDetect;
