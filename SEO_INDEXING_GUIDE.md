# i-Coffee — SEO audit & search-engine indexing guide

## 1. What the audit found (and what was changed)

| # | Finding | Impact | Fix shipped |
|---|---|---|---|
| 1 | `/robots.txt` and `/sitemap.xml` on **i-coffee.ng** returned the SPA `index.html` (the server generated them, but only on the API host; Vercel's catch-all rewrite swallowed the storefront URLs). This is why Search Console shows *no sitemaps*. | Critical | `vercel.json` now rewrites `/robots.txt`, `/sitemap*.xml`, `/indexnow-key.txt` per domain to the API (`/api/seo/...`). |
| 2 | Old sitemap listed 7 hard-coded paths, several wrong (`/about`, `/contact`, `/cart`, `/login`) and **no products, categories, brands or blog posts**. | Critical | Dynamic sitemap index → `pages`, `categories` (+brands), `blog`, `products-N` (5 000 URLs each), per country domain, with `lastmod`, only PUBLISHED + purchasable + country-visible items, URLs identical to what the storefront links to. |
| 3 | robots.txt allowed everything, incl. cart/checkout/dashboard/login/search. | High | Private & transactional paths disallowed; sitemap line per domain. |
| 4 | **Canonical bug:** the root `SiteMeta` overwrote every page's canonical/title/OG with the *homepage's* values after load (`useSeoMeta` existed but no page used it). | Critical (duplicate-content / wrong snippets) | `SiteMeta` now re-evaluates per route and steps aside when a page sets its own tags; pages claim the head via `useSeoMeta`. |
| 5 | No per-page meta on product, blog, category/brand pages. | High | Dynamic title, description, canonical (query-string stripped), Open Graph, Twitter card per page; product pages use `seoTitle`/`seoDescription` when set. |
| 6 | No structured data. | High | JSON-LD: `Organization` + `WebSite`(SearchAction) on home, `Product`(+`Offer` with the displayed price/currency, `AggregateRating` when reviews exist) + `BreadcrumbList`, `BlogPosting` + `BreadcrumbList`, `CollectionPage`. |
| 7 | `index.html` hard-coded a canonical/`og:url` of `https://www.i-coffee.ng` for **all four country domains** (and `www` vs non-`www` disagreed with Search Console). | High | Static canonical removed; set per page/country. `www.` → apex 301 in `vercel.json`. |
| 8 | hreflang pointed each language at the same URL; no cross-domain alternates. | Medium | `hreflang` (en-NG, fr-TG, fr-BJ, it-IT, x-default) across the four domains for pages that exist on all of them (home, shop, info pages), in `<head>` and in the sitemap. |
| 9 | Non-JS crawlers (Bingbot social/link previews, Yandex, Baidu, Facebook/WhatsApp/LinkedIn) saw an empty shell. | High | Crawler user-agents are routed to `/api/seo/render/:country`, a lightweight HTML page with the real title, meta, JSON-LD and readable content (Googlebot still gets the normal JS site). |
| 10 | Any `/blog/<anything>` rendered an invented "Ethiopian coffee" article with HTTP 200 when the fetch failed (soft-404 + fake content). | High | Removed; unknown slugs show not-found and `noindex`. Missing products/posts render as HTTP 404 for crawlers. |
| 11 | Private pages (cart, checkout, login, account, search…) were indexable. | Medium | `noindex,nofollow` set client-side and disallowed in robots.txt. |
| 12 | `og:image` used `http://`. No `max-image-preview`, theme-color, HSTS. | Low | Fixed in `index.html` / headers. |
| 13 | New content only discovered when crawled. | Medium | **IndexNow** push (Bing, Yandex, Seznam, Naver…) on every blog publish/update + bulk script. |

### Known limits (be aware)
* The site is still a client-side SPA. Google renders JS fine; other engines get the crawler HTML above. Full SSR/prerendering (e.g. moving to Next.js or a prerender service) would be the next level but is a larger project.
* Vercel serves real files before rewrites, so for `/` a bot receives `index.html` (which carries Nigeria's fallback title/description) rather than the per-country render. Inner pages are rendered per country. Tell me if you want the home page fixed too (needs an edge function).
* Product `Offer` markup comes from the price shown on the page (country currency). Products with only a "request/waitlist" state emit no `Offer`.
* I could not call Google/Bing from the build environment, so submission and live validation (below) are steps you perform.

---

## 2. Deploy (do these first)

1. **Server** (api.i-coffee.ng): set `INDEXNOW_KEY` (generate: `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`) and deploy.
2. **Client** (each country's Vercel project — NG, TG, BJ, IT): deploy with the new `vercel.json`. Make sure each custom domain is attached to its project.
3. Check from any terminal (replace the domain for each country):
   ```
   curl -s https://i-coffee.ng/robots.txt        # shows Disallow lines + "Sitemap: https://i-coffee.ng/sitemap.xml"
   curl -s https://i-coffee.ng/sitemap.xml       # <sitemapindex> listing pages/categories/blog/products-1
   curl -s https://i-coffee.ng/sitemap-products-1.xml | head
   curl -s https://i-coffee.ng/indexnow-key.txt  # prints your key
   curl -s -A "bingbot" https://i-coffee.ng/product/<any-product-url> | grep -E "<title>|canonical|ld\+json"
   ```
   If `robots.txt` still shows HTML, the rewrite didn't apply — confirm the deployment used this `vercel.json` and the domain is on that project.
4. Open one product and one blog post in a browser → view-source won't show tags (JS-set); use DevTools → Elements, or the URL Inspection tool below.

## 3. Google Search Console (you already added i-coffee.ng)

Repeat for **each domain** (i-coffee.tg, i-coffee.bj, i-coffee.it) — each is its own property.

1. Search Console → **Add property** → **Domain** (e.g. `i-coffee.tg`) → add the DNS TXT record at your registrar → Verify. (A Domain property covers `www`, `http` and `https` together.)
2. **Indexing → Sitemaps** → "Add a new sitemap" → type `sitemap.xml` → **Submit**. Status should become *Success* within minutes; click it to see the child sitemaps and "Discovered URLs".
3. **URL Inspection** → paste the home page, `/shop`, one category, one product, one blog post → **Test live URL** → **Request indexing**. (Daily quota is small; the sitemap does the bulk.)
4. **Enhancements** (left menu, appears after crawl): check *Products*, *Breadcrumbs*, *Sitelinks searchbox* for errors.
5. After ~1–2 weeks: **Indexing → Pages** shows why URLs aren't indexed. "Crawled – currently not indexed" on thin pages is normal; "Duplicate without user-selected canonical" should now be rare.
6. Optional: Settings → *International targeting is retired*; hreflang is handled in the markup.
7. Validate markup: https://search.google.com/test/rich-results with a product URL and a blog URL.

## 4. Bing Webmaster Tools (also powers DuckDuckGo, Yahoo, Ecosia, etc.)

1. https://www.bing.com/webmasters → sign in.
2. Easiest: **Import from Google Search Console** → authorise → select your verified properties. (Or *Add a site* and verify by DNS CNAME / meta tag / XML file.)
3. **Sitemaps** → *Submit sitemap* → `https://i-coffee.ng/sitemap.xml` (repeat per domain; imported sites usually carry the GSC sitemaps over).
4. **IndexNow** is already integrated: with `INDEXNOW_KEY` set, publishing a blog post notifies Bing instantly. Check Webmaster Tools → *IndexNow* for received submissions.
5. Run once after go-live to push every URL: `cd server && node scripts/indexnowSubmitAll.js` (or `... NG`).
6. **URL Submission** for a few key URLs; **Site Scan** for a free SEO report.

## 5. Yandex (Russia/CIS; also supports IndexNow)

1. https://webmaster.yandex.com → *Add site* (use the apex domain) → verify (DNS TXT or meta tag).
2. **Indexing → Sitemap files** → add `https://i-coffee.ng/sitemap.xml`.
3. Optional: set region (*Site info → Regionality*). Only worth it if you target those markets.

## 6. Other engines
* **Baidu** (China): needs Baidu Webmaster account, usually a Chinese phone number, and ranks poorly without ICP/China hosting — skip unless you sell there.
* **Naver** (Korea) and **Seznam** (Czechia): receive IndexNow pushes automatically; register with Naver Search Advisor / Seznam Webmaster only if you target those countries.
* **DuckDuckGo, Ecosia, Yahoo, Brave**: use Bing/own indexes — covered by Bing Webmaster Tools + `robots.txt`. **Applebot / Siri**: follows robots.txt, no submission.
* **Social previews**: test a product/blog URL in the Facebook Sharing Debugger and LinkedIn Post Inspector (they get the crawler HTML with correct og tags).

## 7. Ongoing checklist
* Fill **SEO title / description** on every product and blog post in the admin (they feed the tags; otherwise the product name/excerpt is used).
* Admin → Site Pages → each page's SEO box overrides the built-in title/description per country (e.g. *Site Default (index.html)* for the home page).
* Keep product images and blog images on https with descriptive `alt` text.
* Re-check Search Console *Pages* and *Sitemaps* weekly for the first month, then monthly.
* Core Web Vitals: Search Console → *Experience*. The JS bundle is large (>500 kB chunks); route-level code-splitting is the next performance win.
