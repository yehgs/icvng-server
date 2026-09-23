/**
 * config/paymentRouter.js
 *
 * Central payment-provider resolver.
 *
 * Usage in a controller:
 *
 *   import { getPaymentConfig } from '../config/paymentRouter.js';
 *
 *   const paymentConfig = await getPaymentConfig(req.countryCode);
 *   if (paymentConfig.stripe) { ... }
 *   if (paymentConfig.paystack) { ... }
 *   if (paymentConfig.cinetpay) { ... }
 *
 * PHASE: dynamic per-country indigenous gateways.
 * Stripe/Paystack availability is still config-level (config/countries/index.js)
 * — those are effectively platform-wide toggles, not per-country secrets.
 * CinetPay (and any future local gateway) is resolved per-country from
 * TWO possible sources, DB taking priority — see getCinetPayConfig:
 *   1. models/paymentGateway.model.js — added via admin (IT/DIRECTOR or
 *      that country's own MANAGER), encrypted at rest.
 *   2. CINETPAY_API_KEY_<CC> / CINETPAY_SITE_ID_<CC> env vars — a
 *      pre-provisioning fallback.
 * If NEITHER is set for a country, CinetPay is simply unavailable there
 * and checkout falls back to Stripe — exactly the same as before this
 * feature existed. That's why this module became async: resolving payment
 * config now genuinely requires a DB read, not just a config-file lookup.
 */

import Stripe from "stripe";
import { getCountryByCode, isPaymentProviderEnabled } from "./countries/index.js";
import PaymentGatewayModel from "../models/paymentGateway.model.js";

// ── CinetPay config cache ────────────────────────────────────────────────
// getPaymentConfig() now runs on EVERY request (paymentConfigMiddleware is
// mounted globally in index.js, unchanged from before this phase) — before
// this phase that was a pure config-file lookup; now it's a Mongo read PLUS
// two decryptSecret() calls for any country with an active CinetPay row.
// Doing that on every single page view/API call (not just checkout) would
// be a real, self-inflicted perf regression, so this is cached with a
// short TTL — same idiom as invalidateCountryCache/refreshCountryCache in
// controllers/countryManagement.controller.js, just simpler (no need to
// eagerly refresh; a stale read for a few seconds after an admin saves new
// keys is harmless — nobody's mid-checkout notices a few seconds' lag,
// and explicit invalidation on save/delete below already keeps that window
// short instead of relying on the TTL alone).
const CINETPAY_CACHE_TTL_MS = 60_000;
const _cinetpayCache = new Map(); // countryCode -> { value, expiresAt }

/**
 * Call after any write to a country's CinetPay row (upsert or delete) — see
 * controllers/paymentGateway.controller.js. Passing no countryCode clears
 * everything (used defensively; not currently needed by any call site).
 */
export function invalidateCinetPayCache(countryCode) {
  if (countryCode) {
    _cinetpayCache.delete(countryCode.toUpperCase());
  } else {
    _cinetpayCache.clear();
  }
}

// ── Stripe instances (one per Stripe key — usually shared across countries) ──
// We lazy-init so the module can load even if keys are absent in dev.
let _stripeInstance = null;

export function getStripeInstance() {
  if (!_stripeInstance) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not set");
    }
    _stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-04-10",
    });
  }
  return _stripeInstance;
}

/**
 * Env-var fallback for CinetPay credentials, per country:
 *   CINETPAY_API_KEY_<CC>  /  CINETPAY_SITE_ID_<CC>   e.g. _TG, _BJ
 *
 * Added per the explicit request: if nothing is configured in admin AND no
 * env keys are set for a country, checkout falls back to Stripe — same as
 * today. If EITHER the admin (DB) OR these env vars are set, CinetPay is
 * enabled; the DB always wins when both exist (see getCinetPayConfig),
 * since that's what lets a country manager self-serve without needing a
 * redeploy to override an env-configured default.
 *
 * This mirrors PAYSTACK_SECRET_KEY/STRIPE_SECRET_KEY above in spirit, just
 * per-country since — unlike Paystack (NG-only) — CinetPay needs different
 * credentials for Togo vs. Benin.
 */
function getCinetPayEnvCredentials(countryCode) {
  const code = (countryCode || "").toUpperCase();
  const apiKey = process.env[`CINETPAY_API_KEY_${code}`];
  const siteId = process.env[`CINETPAY_SITE_ID_${code}`];
  if (!apiKey || !siteId) return null;
  return { apiKey, siteId };
}

/**
 * Boolean-only check, exported for the admin listing
 * (controllers/paymentGateway.controller.js) so it can show "active via
 * environment variables" for a country with no DB row, instead of the
 * misleading "Not set — Stripe only" a manager would otherwise see while
 * CinetPay is actually live for their country.
 */
export function isCinetPayEnvConfigured(countryCode) {
  return Boolean(getCinetPayEnvCredentials(countryCode));
}

/**
 * Is CinetPay active + configured for this country? Checks, in order:
 *   1. The DB (models/paymentGateway.model.js) — an active row an admin
 *      or country-scoped MANAGER configured. Takes priority so a manager
 *      can always override/replace an env-configured default without
 *      needing IT to touch the server.
 *   2. Env vars (CINETPAY_API_KEY_<CC> / CINETPAY_SITE_ID_<CC>) — a
 *      pre-provisioning path, e.g. for a country IT wants live from day
 *      one before anyone's touched the admin UI.
 *   3. Neither → disabled. Checkout falls back to Stripe, exactly as if
 *      CinetPay didn't exist for that country.
 *
 * DB-backed, unlike isPaymentProviderEnabled (stripe/paystack), which
 * reads the static config file. Kept as its own export so
 * order.controller.js's cinetpayPaymentController can gate on it
 * directly, mirroring how paystackPaymentController/stripePaymentController
 * gate on isPaymentProviderEnabled. Cached — see the comment above
 * _cinetpayCache.
 *
 * @param {string} countryCode
 * @returns {Promise<{
 *   enabled: boolean,
 *   credentials: {apiKey:string, siteId:string} | null,
 *   isDefault: boolean,
 *   source: 'db' | 'env' | 'none',
 * }>}
 */
export async function getCinetPayConfig(countryCode) {
  const code = (countryCode || "").toUpperCase();
  const cached = _cinetpayCache.get(code);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const dbResult = await PaymentGatewayModel.getActiveForCountry(code, "cinetpay");

  let value;
  if (dbResult) {
    value = {
      enabled: true,
      credentials: dbResult.credentials,
      doc: dbResult.doc,
      // Defaults to true (matches the schema default) so an existing row
      // saved before isDefault existed still behaves as "preselect this".
      isDefault: dbResult.doc.isDefault !== false,
      source: "db",
    };
  } else {
    const envCreds = getCinetPayEnvCredentials(code);
    value = envCreds
      ? { enabled: true, credentials: envCreds, doc: null, isDefault: true, source: "env" }
      : { enabled: false, credentials: null, doc: null, isDefault: false, source: "none" };
  }

  _cinetpayCache.set(code, { value, expiresAt: Date.now() + CINETPAY_CACHE_TTL_MS });
  return value;
}

/**
 * Returns a payment config object for the given country code.
 *
 * @param {string} countryCode  e.g. "NG" | "IT" | "TG" | "BJ"
 * @returns {Promise<{
 *   countryCode: string,
 *   currency: string,
 *   stripe: boolean,
 *   stripeInstance: import('stripe').Stripe | null,
 *   paystack: boolean,
 *   paystackPublicKey: string | null,
 *   paystackSecretKey: string | null,
 *   cinetpay: boolean,
 *   cinetpayCredentials: {apiKey:string, siteId:string} | null,
 *   availableProviders: string[],
 *   defaultProvider: string,
 * }>}
 */
export async function getPaymentConfig(countryCode = "NG") {
  const country = getCountryByCode(countryCode);
  if (!country) {
    throw new Error(`Unknown country code: ${countryCode}`);
  }

  const stripeEnabled = isPaymentProviderEnabled(countryCode, "stripe");
  const paystackEnabled = isPaymentProviderEnabled(countryCode, "paystack");
  const cinetpay = await getCinetPayConfig(countryCode);

  // ── Default provider at checkout ────────────────────────────────────────
  // The rule requested: the country's own indigenous gateway is the
  // default when one is configured/active AND not explicitly un-defaulted
  // (CinetPay for TG/BJ, same role Paystack already plays for NG);
  // otherwise fall back to whichever of paystack/stripe applies, exactly
  // as today. Stripe remains the universal fallback for foreign-currency
  // checkout regardless of which provider is default — this only decides
  // what's PRESELECTED.
  //
  // BUGFIX: this previously checked only `cinetpay.enabled`, never
  // `cinetpay.isDefault` — so the admin settings page's "Preselect by
  // default" checkbox was stored but silently ignored here. An admin who
  // activated CinetPay but unchecked that box would still see it
  // preselected at checkout regardless.
  const defaultProvider = cinetpay.enabled && cinetpay.isDefault
    ? "cinetpay"
    : paystackEnabled
      ? "paystack"
      : "stripe";

  return {
    countryCode,
    currency: country.currency.code,
    // Stripe
    stripe: stripeEnabled,
    stripeInstance: stripeEnabled ? getStripeInstance() : null,
    stripePublicKey: stripeEnabled
      ? process.env.STRIPE_PUBLISHABLE_KEY || null
      : null,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || null,
    // Paystack
    paystack: paystackEnabled,
    paystackPublicKey: paystackEnabled
      ? process.env.PAYSTACK_PUBLIC_KEY || null
      : null,
    paystackSecretKey: paystackEnabled
      ? process.env.PAYSTACK_SECRET_KEY || null
      : null,
    // CinetPay — country-scoped, DB-backed. Credentials are server-side
    // only (CinetPay's hosted-checkout flow needs no public key on the
    // client, unlike Stripe/Paystack) — never surfaced via getPublicPaymentInfo.
    cinetpay: cinetpay.enabled,
    cinetpayCredentials: cinetpay.credentials,
    // Helpers
    availableProviders: [
      ...(stripeEnabled ? ["stripe"] : []),
      ...(paystackEnabled ? ["paystack"] : []),
      ...(cinetpay.enabled ? ["cinetpay"] : []),
    ],
    defaultProvider,
  };
}

/**
 * Express middleware that attaches payment config to req.
 *
 *   req.paymentConfig  → result of getPaymentConfig(req.countryCode)
 *
 * Mount AFTER countryDetect. Now async (CinetPay resolution needs a DB
 * read) — every call site was already inside an async request handler, so
 * this only changes this middleware itself, not its callers' signatures.
 */
export async function paymentConfigMiddleware(req, res, next) {
  try {
    req.paymentConfig = await getPaymentConfig(req.countryCode || "NG");
  } catch (err) {
    console.error("paymentConfigMiddleware error:", err.message);
    // Don't block the request — individual route handlers will validate
    req.paymentConfig = null;
  }
  next();
}

/**
 * Returns the public-safe payment info the client needs at checkout.
 * Call from a /api/payment/config endpoint (or, today, GET /api/country/config
 * — see controllers/countryConfig.controller.js).
 *
 * @param {string} countryCode
 */
export async function getPublicPaymentInfo(countryCode = "NG") {
  const config = await getPaymentConfig(countryCode);
  return {
    availableProviders: config.availableProviders,
    defaultProvider: config.defaultProvider,
    currency: config.currency,
    stripePublicKey: config.stripePublicKey,
    paystackPublicKey: config.paystackPublicKey,
  };
}
