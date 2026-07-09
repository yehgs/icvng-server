/**
 * utils/formatCurrency.js
 *
 * PHASE 5 — server-side currency formatting driven by country config, so
 * invoices/emails/PDFs show the correct currency and locale per market instead
 * of hardcoded NGN.
 */

import { getCountryByCode } from "../config/countries/index.js";

/**
 * Format an amount for a country.
 * @param {number} amount
 * @param {string} countryCode  e.g. "TG"
 * @returns {string}
 */
export function formatCurrencyForCountry(amount, countryCode = "NG") {
  const country = getCountryByCode(countryCode) || getCountryByCode("NG");
  const currency = country?.currency || {};
  const code = currency.code || "NGN";
  const locale = country?.language?.locale || currency.locale || "en-NG";

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
    }).format(amount || 0);
  } catch {
    // Fallback for exotic locale/currency combos Intl may reject.
    const symbol = currency.symbol || "";
    return `${symbol}${Number(amount || 0).toLocaleString()}`;
  }
}

/** Return a country's currency code (e.g. "XOF"). */
export function currencyCodeFor(countryCode = "NG") {
  const country = getCountryByCode(countryCode) || getCountryByCode("NG");
  return country?.currency?.code || "NGN";
}
