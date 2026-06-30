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

  // Togo
  "i-coffee.tg": "TG",
  "www.i-coffee.tg": "TG",
  "icvng-client-tg.vercel.app": "TG",
  "localhost:5175": "TG",

  // Benin
  "i-coffee.bj": "BJ",
  "www.i-coffee.bj": "BJ",
  "icvng-client-bj.vercel.app": "BJ",
  "localhost:5176": "BJ",

  // Italy
  "i-coffee.it": "IT",
  "www.i-coffee.it": "IT",
  "icvng-client-it.vercel.app": "IT",
  "localhost:5177": "IT",
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
