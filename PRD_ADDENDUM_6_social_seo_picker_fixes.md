# PRD Addendum 6 — Social pages, SEO/indexing, picker & HR fixes (2026-11-13)

## 1. Campaign discount target picker
* Selected products/categories/brands now show **names** (not ids): names come from search results, and ids without a cached name are resolved via `GET /api/campaign/admin/selector/:kind?ids=a,b,c` (country-scoped, ≤100 ids).
* The result list opens only while the input is focused/typing and closes on outside click, touch or Escape; selected items are ticked.

## 2. HR — staff creation from an existing account
Choosing an account prefills full name, phone and **photo** (HTTPS avatar only). The server applies the same avatar fallback when `photoUrl` is omitted. Personal email is deliberately not prefilled (the account email may be a work address).

## 3. Social media page cards (storefront "Coffee Stories")
* Model `SocialPage` (platform FACEBOOK/INSTAGRAM/X/TIKTOK/YOUTUBE/LINKEDIN/WHATSAPP/TELEGRAM/OTHER, name, handle, https URL validated against the platform's hosts, description, followers label, image, `showFeed`, `isActive`, `sortOrder`, `countryCode` or `ALL`).
* Permissions `social.view` / `social.manage` — MANAGER and EDITOR (country-scoped: own country only, `ALL` entries read-only); IT/DIRECTOR global and may publish `ALL` ("every country"). Out-of-territory → 404, tampered country → 403.
* API `/api/social/public` (country from host; the country's cards first, then `ALL`), admin `/api/social/admin/*`. Admin screen **Social Pages**.
* Storefront: dark-indigo band rendered **before** the blog cards; Facebook pages may embed the official Page plugin (lazy iframe). Nothing renders when a country has no cards.
* Removed invented fallback blog posts (home blog section and single post page).

## 4. SEO & search-engine indexing
See `client/SEO_INDEXING_GUIDE.md` (audit table, deploy checks, Google/Bing/Yandex steps).
* Server `/api/seo/robots/:code`, `/api/seo/sitemap/:code/:file` (index, pages, categories, blog, products-N), `/api/seo/render/:code` (crawler HTML + JSON-LD), `/api/seo/indexnow-key.txt`; `INDEXNOW_KEY` env; IndexNow ping on blog publish/update; `scripts/indexnowSubmitAll.js`.
* Client `vercel.json` (rewrites for robots/sitemaps/IndexNow key/crawler UAs, www→apex 301, HSTS), `SiteMeta` per-route defaults, `useSeoMeta` per-page tags (title, description, canonical, OG, Twitter, hreflang, JSON-LD), noindex for private pages.
* Tests: `server/tests/seo_int.mjs`, `social_int.mjs`.

## Out of scope / backlog
Mobile social-cards screen; full SSR/prerender; home-page per-country crawler render; per-product multi-currency Offer data on the server render.
