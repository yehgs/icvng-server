/**
 * config/countries/index.js
 *
 * SINGLE SOURCE OF TRUTH for every country I-Coffee operates in.
 *
 * To add a new country:
 *   1. Add one entry to COUNTRY_CONFIG below.
 *   2. Add the domain → countryCode mapping in DOMAIN_MAP.
 *   3. Set env vars for the new Stripe/Paystack keys if needed.
 *   4. Done — no other code changes required.
 */

export const COUNTRY_CONFIG = {
  NG: {
    code: "NG",
    name: "Nigeria",
    domain: "i-coffee.ng",
    currency: {
      code: "NGN",
      symbol: "₦",
      name: "Nigerian Naira",
      decimals: 2,
    },
    language: {
      default: "en",
      supported: ["en"],
      locale: "en-NG",
    },
    payments: {
      paystack: true,
      stripe: true,
    },
    timezone: "Africa/Lagos",
    phonePrefix: "+234",
    adminDomain: "app.i-coffee.ng",
    flagEmoji: "🇳🇬",
    seo: {
      siteName: "I-Coffee Nigeria",
      tld: ".ng",
    },
  },

  TG: {
    code: "TG",
    name: "Togo",
    domain: "i-coffee.tg",
    currency: {
      code: "XOF",
      symbol: "CFA",
      name: "West African CFA Franc",
      decimals: 0,
    },
    language: {
      default: "fr",
      supported: ["fr", "en"],
      locale: "fr-TG",
    },
    payments: {
      paystack: false,
      stripe: true,
    },
    timezone: "Africa/Lome",
    phonePrefix: "+228",
    adminDomain: "app.i-coffee.tg",
    flagEmoji: "🇹🇬",
    seo: {
      siteName: "I-Coffee Togo",
      tld: ".tg",
    },
  },

  BJ: {
    code: "BJ",
    name: "Benin",
    domain: "i-coffee.bj",
    currency: {
      code: "XOF",
      symbol: "CFA",
      name: "West African CFA Franc",
      decimals: 0,
    },
    language: {
      default: "fr",
      supported: ["fr", "en"],
      locale: "fr-BJ",
    },
    payments: {
      paystack: false,
      stripe: true,
    },
    timezone: "Africa/Porto-Novo",
    phonePrefix: "+229",
    adminDomain: "app.i-coffee.bj",
    flagEmoji: "🇧🇯",
    seo: {
      siteName: "I-Coffee Benin",
      tld: ".bj",
    },
  },

  IT: {
    code: "IT",
    name: "Italy",
    domain: "i-coffee.it",
    currency: {
      code: "EUR",
      symbol: "€",
      name: "Euro",
      decimals: 2,
    },
    language: {
      default: "it",
      supported: ["it", "en"],
      locale: "it-IT",
    },
    payments: {
      paystack: false,
      stripe: true,
    },
    timezone: "Europe/Rome",
    phonePrefix: "+39",
    adminDomain: "app.i-coffee.it",
    flagEmoji: "🇮🇹",
    seo: {
      siteName: "I-Coffee Italy",
      tld: ".it",
    },
  },
};

/**
 * Domain → country code map.
 * Covers production domains, www variants, Vercel preview URLs,
 * and local-dev ports so detection works everywhere.
 */
export const DOMAIN_MAP = {
  // Nigeria
  "i-coffee.ng": "NG",
  "www.i-coffee.ng": "NG",
  "icvng-client.vercel.app": "NG",
  "italiancoffeeng.vercel.app": "NG",
  "localhost:5173": "NG",
  localhost: "NG",
  // Nigeria — admin panel
  "app.i-coffee.ng": "NG",

  // Togo
  "i-coffee.tg": "TG",
  "www.i-coffee.tg": "TG",
  "icvng-client-tg.vercel.app": "TG",
  "localhost:5175": "TG",
  // Togo — admin panel
  "app.i-coffee.tg": "TG",

  // Benin
  "i-coffee.bj": "BJ",
  "www.i-coffee.bj": "BJ",
  "icvng-client-bj.vercel.app": "BJ",
  "localhost:5176": "BJ",
  // Benin — admin panel
  "app.i-coffee.bj": "BJ",

  // Italy
  "i-coffee.it": "IT",
  "www.i-coffee.it": "IT",
  "icvng-client-it.vercel.app": "IT",
  "localhost:5177": "IT",
  // Italy — admin panel
  "app.i-coffee.it": "IT",
};

/** Default / fallback country when domain cannot be resolved */
export const DEFAULT_COUNTRY = "NG";

/**
 * Resolve a country config from a hostname string.
 * Falls back to Nigeria so existing behaviour is unchanged.
 *
 * @param {string} hostname  e.g. "i-coffee.it" or "localhost:5177"
 * @returns {object}  Full country config object
 */
export function getCountryByDomain(hostname = "") {
  const host = hostname.toLowerCase().split(":")[0]; // strip port for lookup
  const hostWithPort = hostname.toLowerCase(); // keep port for localhost variants

  const code =
    DOMAIN_MAP[hostWithPort] ||
    DOMAIN_MAP[host] ||
    DOMAIN_MAP[hostname] ||
    DEFAULT_COUNTRY;

  return COUNTRY_CONFIG[code] || COUNTRY_CONFIG[DEFAULT_COUNTRY];
}

/**
 * Resolve a country config from a country code.
 *
 * @param {string} code  e.g. "NG"
 * @returns {object|null}
 */
export function getCountryByCode(code = "") {
  return COUNTRY_CONFIG[code.toUpperCase()] || null;
}

/**
 * Returns true when the payment provider is available in a country.
 *
 * @param {string} countryCode  e.g. "NG"
 * @param {"paystack"|"stripe"} provider
 * @returns {boolean}
 */
export function isPaymentProviderEnabled(countryCode, provider) {
  const country = getCountryByCode(countryCode);
  if (!country) return false;
  return Boolean(country.payments[provider]);
}

/** Convenience: list of all supported country codes */
export const ALL_COUNTRY_CODES = Object.keys(COUNTRY_CONFIG);

/**
 * Site-wide languages offered purely for reach/accessibility — not tied to
 * any single country's default storefront language, unlike the languages
 * derived from COUNTRY_CONFIG below. A shopper in any country (NG, BJ, IT,
 * TG, or a future market) can pick one of these from the language switcher
 * and see the UI chrome + AI-translated product/blog copy in it, same as
 * en/fr/it — it's just not any country's *default*. Add a code here (and
 * its native display name in LANGUAGE_NAMES in i18n/index.js, client-side
 * and admin-side) to make it available everywhere; the auto-translate
 * pipeline (translationService.js) and scripts/bulkTranslateContent.js
 * both pick it up automatically since they read ALL_SUPPORTED_LANGUAGES.
 */
export const GLOBAL_EXTRA_LANGUAGES = ["es", "pt", "nl", "ar", "hi", "zh"];

/**
 * PHASE 5: the union of every language any country supports, plus the
 * site-wide extra languages above — the single source of truth for the
 * translation system's language set. Adding a market with a new language
 * (e.g. Portuguese for a future country) here makes it valid everywhere, no
 * schema edits needed; same for adding a new *global* language above.
 */
export const ALL_SUPPORTED_LANGUAGES = Array.from(
  new Set([
    ...Object.values(COUNTRY_CONFIG).flatMap((c) => c.language?.supported || []),
    ...GLOBAL_EXTRA_LANGUAGES,
  ]),
).sort();
