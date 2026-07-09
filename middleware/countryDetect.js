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

import jwt from "jsonwebtoken";
import UserModel from "../models/user.model.js";
import {
  getCountryByDomain,
  getCountryByCode,
  DEFAULT_COUNTRY,
  COUNTRY_CONFIG,
} from "../config/countries/index.js";

/**
 * PHASE 1 SECURITY: verify that the caller presenting X-Country-Code is a
 * real, active, GLOBAL-scoped ADMIN. Previously the header was honored from
 * ANY caller, letting any client impersonate another country's context
 * (payment gateway selection, order stamping, content scoping).
 *
 * Returns true only when the request carries a valid access token belonging
 * to an active ADMIN with scope === "GLOBAL" (the HQ "view as country" case
 * the override exists for). Any failure → false, and the header is ignored.
 */
async function isTrustedCountryOverride(req) {
  try {
    const token =
      req.cookies?.accessToken || req.headers?.authorization?.split(" ")[1];
    if (!token) return false;

    const decoded = jwt.verify(token, process.env.SECRET_KEY_ACCESS_TOKEN);
    if (!decoded?.id) return false;

    const user = await UserModel.findById(decoded.id).select(
      "role scope status",
    );
    return (
      !!user &&
      user.role === "ADMIN" &&
      user.status === "Active" &&
      user.scope === "GLOBAL"
    );
  } catch {
    return false;
  }
}

/**
 * Trust list of internal/admin callers that are allowed to override
 * the country via the X-Country-Code header.
 * In production keep this to your server-side admin panel IP or a
 * secret header value.
 */
const TRUSTED_OVERRIDE_HEADER = "x-country-code";
const STOREFRONT_HOST_HEADER = "x-storefront-host";

const countryDetect = async (req, res, next) => {
  try {
    // ── 1. Admin / internal override (highest priority, trusted callers only) ──
    // PHASE 1: the override is now honored ONLY for verified GLOBAL admins.
    // Untrusted callers sending the header fall through to normal detection.
    const headerOverride = req.headers[TRUSTED_OVERRIDE_HEADER];
    if (headerOverride && COUNTRY_CONFIG[headerOverride.toUpperCase()]) {
      const trusted = await isTrustedCountryOverride(req);
      if (trusted) {
        req.country = COUNTRY_CONFIG[headerOverride.toUpperCase()];
        req.countryCode = req.country.code;
        return next();
      }
      // Not trusted → ignore the header and continue detection below.
    }

    // ── 2. Storefront hostname sent by the client SPA ────────────────────────
    // The API is served from one shared domain across every country's
    // deployment, so req.headers.host is always the API's own host, never
    // the storefront's. The client sends the browser's real hostname here;
    // it still goes through the same getCountryByDomain/DOMAIN_MAP lookup
    // as the Host header would, so a client can't claim an arbitrary
    // country code — only one that actually maps to a real domain.
    const storefrontHost = req.headers[STOREFRONT_HOST_HEADER];
    if (storefrontHost) {
      const country = getCountryByDomain(storefrontHost);
      req.country = country;
      req.countryCode = country.code;
      return next();
    }

    // ── 3. Derive from Host header (fallback, e.g. direct API hits) ──────────
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
