/**
 * controllers/seo.controller.js
 *
 * Serves domain-aware SEO files:
 *   GET /robots.txt   → correct sitemap URL per domain
 *   GET /sitemap.xml  → product + category URLs for the detected country
 */

import { getCountryByCode } from "../config/countries/index.js";

/**
 * GET /robots.txt
 */
export function robotsTxt(req, res) {
  const country = req.country;
  const domain = `https://${country.domain}`;

  const content = `User-agent: *
Allow: /

Sitemap: ${domain}/sitemap.xml
`;

  res.type("text/plain").send(content);
}

/**
 * GET /sitemap.xml
 * Returns a basic sitemap for the detected domain.
 * Extend this with dynamic product/category URLs from DB if needed.
 */
export async function sitemapXml(req, res) {
  const country = req.country;
  const domain = `https://${country.domain}`;
  const lang = country.language.default;

  const staticPaths = [
    "",
    "/shop",
    "/about",
    "/contact",
    "/blog",
    "/cart",
    "/login",
  ];

  const urls = staticPaths
    .map(
      (p) => `
  <url>
    <loc>${domain}${p}</loc>
    <changefreq>weekly</changefreq>
    <priority>${p === "" ? "1.0" : "0.8"}</priority>
  </url>`
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>`;

  res.type("application/xml").send(xml);
}

/**
 * GET /api/seo/meta
 * Returns Open Graph + hreflang meta for the current domain.
 * Used by the React client to inject <head> tags via react-helmet or similar.
 */
export function getSeoMeta(req, res) {
  const country = req.country;
  const domain = `https://${country.domain}`;

  // hreflang alternate links for all supported languages
  const hreflangLinks = country.language.supported.map((lang) => ({
    hreflang: `${lang}-${country.code}`,
    href: domain,
  }));

  return res.json({
    success: true,
    error: false,
    data: {
      siteName: country.seo.siteName,
      domain,
      locale: country.language.locale,
      language: country.language.default,
      currency: country.currency.code,
      openGraph: {
        siteName: country.seo.siteName,
        locale: country.language.locale,
        type: "website",
      },
      hreflang: hreflangLinks,
      canonicalBase: domain,
      tld: country.seo.tld,
    },
  });
}
