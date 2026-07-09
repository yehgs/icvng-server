/**
 * utils/seo.js
 *
 * PHASE 6 — per-domain SEO: canonical URL, hreflang alternates, and Open
 * Graph locale derived from the resolved country. Storefront pages call
 * buildSeoTags(country, path) to emit correct per-market metadata instead of
 * one global set.
 */

import { listCountries } from "../services/countryService.js";

/**
 * Build SEO metadata for a country + path.
 * @param {object} country  resolved country (from countryService)
 * @param {string} path     request path e.g. "/product/espresso"
 * @returns {Promise<object>}  { canonical, alternates[], ogLocale, siteName }
 */
export async function buildSeoTags(country, path = "/") {
  const all = await listCountries({ activeOnly: true });
  const cleanPath = path.startsWith("/") ? path : `/${path}`;

  const canonical = country?.domain
    ? `https://${country.domain}${cleanPath}`
    : `https://i-coffee.ng${cleanPath}`;

  // hreflang alternates: one per active country's default language + domain.
  const alternates = all
    .filter((c) => c.domain)
    .map((c) => ({
      hreflang: `${c.language?.default || "en"}-${c.code}`,
      href: `https://${c.domain}${cleanPath}`,
    }));

  // x-default points at HQ.
  const hq = all.find((c) => c.isHQ);
  if (hq?.domain) {
    alternates.push({ hreflang: "x-default", href: `https://${hq.domain}${cleanPath}` });
  }

  const lang = country?.language?.default || "en";
  const ogLocale = `${lang}_${country?.code || "NG"}`;

  return {
    canonical,
    alternates,
    ogLocale,
    siteName: country?.seo?.siteName || "I-Coffee",
    lang,
  };
}

/** Render hreflang <link> tags as an HTML string (for SSR/meta injection). */
export function renderHreflangLinks(alternates = []) {
  return alternates
    .map((a) => `<link rel="alternate" hreflang="${a.hreflang}" href="${a.href}" />`)
    .join("\n");
}
