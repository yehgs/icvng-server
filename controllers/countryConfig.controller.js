/**
 * controllers/countryConfig.controller.js
 *
 * Exposes read-only country configuration to the frontend.
 * The client calls GET /api/country/config on startup and uses the
 * response to configure currency formatting, language, payment UI, etc.
 */

import {
  COUNTRY_CONFIG,
  ALL_COUNTRY_CODES,
  getCountryByCode,
} from "../config/countries/index.js";
import { getPublicPaymentInfo } from "../config/paymentRouter.js";

/**
 * GET /api/country/config
 *
 * Returns the configuration for the domain the request came from.
 * The countryDetect middleware has already set req.countryCode.
 */
export async function getCountryConfig(req, res) {
  try {
    const country = req.country;
    const payment = getPublicPaymentInfo(req.countryCode);

    return res.json({
      success: true,
      error: false,
      data: {
        code: country.code,
        name: country.name,
        domain: country.domain,
        currency: country.currency,
        language: country.language,
        timezone: country.timezone,
        phonePrefix: country.phonePrefix,
        flagEmoji: country.flagEmoji,
        seo: country.seo,
        payment,
      },
    });
  } catch (err) {
    console.error("getCountryConfig error:", err);
    return res.status(500).json({
      success: false,
      error: true,
      message: "Could not load country configuration",
    });
  }
}

/**
 * GET /api/country/all
 *
 * Returns a public-safe list of all active countries.
 * Used by the country-switcher UI on the frontend.
 */
export async function getAllCountries(req, res) {
  try {
    const countries = ALL_COUNTRY_CODES.map((code) => {
      const c = COUNTRY_CONFIG[code];
      return {
        code: c.code,
        name: c.name,
        domain: c.domain,
        currency: c.currency,
        language: c.language,
        flagEmoji: c.flagEmoji,
      };
    });

    return res.json({
      success: true,
      error: false,
      data: countries,
    });
  } catch (err) {
    console.error("getAllCountries error:", err);
    return res.status(500).json({
      success: false,
      error: true,
      message: "Could not load countries",
    });
  }
}

/**
 * GET /api/country/detect
 *
 * Called by the frontend to get country suggestion based on IP/domain.
 * Returns the currently detected country so the client can show
 * a "switch domain?" popup if the user's locale differs.
 */
export async function detectUserCountry(req, res) {
  try {
    const detectedCountry = req.country;

    // Optionally read Accept-Language header for a language hint
    const acceptLanguage = req.headers["accept-language"] || "";
    const preferredLang = acceptLanguage.split(",")[0].split("-")[0].toLowerCase();

    return res.json({
      success: true,
      error: false,
      data: {
        detectedCountry: {
          code: detectedCountry.code,
          name: detectedCountry.name,
          domain: detectedCountry.domain,
          flagEmoji: detectedCountry.flagEmoji,
          currency: detectedCountry.currency,
        },
        preferredLanguage: preferredLang || detectedCountry.language.default,
      },
    });
  } catch (err) {
    console.error("detectUserCountry error:", err);
    return res.status(500).json({
      success: false,
      error: true,
      message: "Could not detect country",
    });
  }
}
