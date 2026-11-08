# PRD Addendum 4 — Seasonal Campaigns (Black Friday, Christmas, custom) + admin create-product fix

**Status:** implemented. Shared package bumped to `@yehgs/icvng-core` **0.10.0**
(`file:./calstins-icvng-core-0.10.0.tgz` in server-adjacent apps: admin, client, mobile).
This file is identical in `server/`, `admin/` and `client/`; the mobile app records its part in
`mobile/MANIFEST.md` and `mobile/BACKLOG.md`.

---

## A. Architecture summary

One reusable, country-scoped campaign engine; Black Friday and Christmas are **presets**, not code paths.

```
Admin (CRUD, preview)            Server (single source of truth)               Customers
 /dashboard/campaigns  ──────►  /api/campaign/admin/*   (RBAC + country scope)
                                 models: Campaign, CampaignDiscountRule,
                                         CampaignContentBlock
                                 services/campaignPricing.js  ◄── the ONLY place a price is computed
                                        │  (integer kobo, best single rule, no stacking)
                                        ├─ middleware/campaignPricingResponse → product/wishlist/compare/fomo/home-content
                                        ├─ cartproduct.updatePriceFromProduct → cart rows (selectedPrice + line campaignPricing)
                                        └─ order.controller → re-prices every checkout, snapshots onto order lines
                                 /api/campaign/active|public/:slug|public/:slug/products ─► web + mobile
```

Rules that are not negotiable and are enforced in code:

1. **Server-authoritative pricing.** Web/mobile only display `campaignPricing` the API returns
   (`@yehgs/icvng-core/campaigns` contains no discount maths). Cart and checkout are re-priced on the server.
2. **Country scope on the server**, in handlers and queries — not just hidden buttons.
3. **Status is derived from timestamps** (no cron): `DRAFT → SCHEDULED → ACTIVE → ENDED`, plus `PAUSED`/`ARCHIVED`
   as explicit intents. Expiry needs no job.
4. **Failure is silent**: if the campaign API fails, the storefront/app renders exactly as before campaigns existed.
5. **No arbitrary CSS/JS/HTML** from editors — the theme is a closed set of validated tokens.

---

## B. Roles, permissions and country scope

New permissions (`config/permissions.js`, module `campaigns`): `campaigns.view`, `campaigns.manage`, `campaigns.publish`.

| Sub-role | view | manage (drafts, rules, blocks, theme) | publish (publish/pause/resume/end/archive/restore/delete, edit live) | Country scope for campaigns |
|---|---|---|---|---|
| IT | ✔ | ✔ | ✔ | **All countries** (country selector) |
| DIRECTOR | ✔ | ✔ | ✔ | **All countries** |
| **MANAGER** *(new)* | ✔ | ✔ | ✔ | **Their assigned country only** (COUNTRY-scoped, e.g. Togo Manager → TG); a non-COUNTRY-scoped manager → Nigeria (HQ) |
| EDITOR | ✔ | ✔ (drafts only) | ✘ | Nigeria (HQ) only |
| SALES_MANAGER | ✔ | ✘ | ✘ | Nigeria (HQ) only |
| SALES | ✔ | ✘ | ✘ | Nigeria (HQ) only |
| ACCOUNTANT | ✔ | ✘ | ✘ | Nigeria (HQ) only |
| WAREHOUSE | ✘ | ✘ | ✘ | — |

* Scope is resolved by `utils/campaignScope.js`, **stricter than the generic `countryScope`** (which treats
  EDITOR/ACCOUNTANT/WAREHOUSE as global). A null/global `scope` on an operational role never grants other markets.
* Out-of-territory record → **404** (existence not leaked); create/update that names a different country → **403**.
  Country cannot be changed after creation (duplicate instead).
* Non-publishers may only modify **DRAFT** campaigns. Live/paused/archived edits need `campaigns.publish`.
* **Open decision:** Editor/Sales/Accountant are treated as Nigeria-only because the repo has no per-user country
  assignment for those roles outside COUNTRY scope. If they should be per-country, assign them `scope: COUNTRY` +
  `assignedCountry` — the resolver already honours it, no code change.

Manager "managerial country-scope access": a COUNTRY-scoped MANAGER can run the full campaign lifecycle for their own
country only (verified for NG and TG, including every cross-country read/write attempt).

---

## C. API contract

Base `/api/campaign`. Country on public routes comes from the storefront host (`X-Storefront-Host`) or the app header
(`X-App-Country`) via `countryDetect` — **never** from a body/query value. Envelope: `{ success, error, data, … }`.

**Public (no auth, no-cache)**

| Route | Returns |
|---|---|
| `GET /active` | `{ serverTime, countryCode, campaign \| null, others[] }` — the live campaign (theme, `endsAt`, discounts summary, ordered blocks with featured products/categories) |
| `GET /public/:slug` | Landing payload; **404** unless live in *this* storefront country |
| `GET /public/:slug/products?page&limit` | Priced product grid (`campaignPricing` attached) + `pagination` |

**Admin** (`/admin/*`, `auth + admin + requirePermission`)

view: `GET meta`, `GET selector/:kind`, `GET list`, `GET :id`, `GET :id/preview`, `GET :id/performance`
manage: `POST create`, `PUT :id`, `POST :id/duplicate`, rules `POST :id/rules`, `PUT|DELETE :id/rules/:ruleId`,
`POST :id/rules/:ruleId/activate|pause`; blocks `POST :id/blocks`, `PUT :id/blocks/reorder` (`{order:[ids]}`),
`PUT|DELETE :id/blocks/:blockId`
publish: `POST :id/publish|pause|resume|end|archive|restore`, `DELETE :id`

**Product / cart pricing object** (attached as `campaignPricing`, keyed by price option on products; flat on cart rows):

```json
{ "originalPrice": 50000, "finalPrice": 40000, "discountAmount": 10000, "discountPercentage": 20,
  "currency": "NGN", "isDiscounted": true, "source": "CAMPAIGN",
  "campaign": { "id": "…", "name": "Black Friday", "type": "BLACK_FRIDAY", "endsAt": "2026-11-30T22:59:59.000Z" },
  "rule": { "id": "…", "label": "", "discountType": "PERCENTAGE", "discountValue": 20 } }
```

Amounts are the platform's stored **NGN base**; clients convert for display with the existing currency formatter.

**Checkout integrity.** Bank-transfer, Paystack, CinetPay and Stripe initiation re-price the cart. A stale client
subtotal returns **HTTP 409 `{ code: "PRICE_CHANGED", … }`**; web and mobile refresh the cart + campaign and ask the
shopper to review. Tolerance = Σ quantities (≥ ₦1) for sub-naira rounding only.

---

## D. Discount and stacking policy

* Percentage: `discount = ⌈price × pct⌉` in integer kobo (rounded **up** to the kobo); fixed: `min(fixed, price)`;
  `final = max(0, price − discount)`. Percentage 1–90 (2 decimals), fixed ≤ 100,000,000 NGN-base. No float currency maths.
* **Best single eligible rule wins — no stacking.** The largest discount wins; ties break deterministically on rule priority → campaign priority → oldest rule → lowest id.
* A campaign price applies only if **strictly cheaper** than the product's standing `discount`; otherwise the standing
  discount is used unchanged (they never combine).
* Eligibility: campaign + rule ACTIVE and inside both windows (server clock), same country, scope match
  (ALL / PRODUCT / CATEGORY / BRAND), min-quantity met, product purchasable.
* **Special-order prices (3/5-week delivery) and out-of-stock prices are excluded** unless the rule sets
  `includeSpecialOrder`. "In stock" mirrors core `getApplicablePrice` (online stock > 0, or partner stock enabled & qty > 0).
* Overlapping campaigns: the highest `priority` campaign supplies the **theme/banner**; pricing still takes the single best
  discount across all live rules (priority only breaks ties). **Two equal-priority overlapping campaigns cannot both be
  published** (409 with the conflicting name).
* Each order document (one per product line) stores an immutable `campaignSnapshot` (campaign, rule, original/final unit price, discount, applied-at);
  editing/pausing a campaign afterwards never changes a placed order. Gateway flows lock per-line unit price
  (+ snapshot) in the payment metadata so the order created after the webhook equals what the customer was charged.

---

## E. Scheduling and lifecycle

* Times stored as UTC instants; the campaign carries an IANA `timezone` used only for entering/displaying dates
  (admin converts both ways; DST-safe). Activation and expiry follow the **server** clock.
* Pause/end remove discounts and the seasonal look immediately, bounded by a 15 s per-country cache
  (`CAMPAIGN_CACHE_TTL_MS`; `0` disables) that is also invalidated on every mutation.
* Clients expose a server-clock offset so countdowns are right on wrong device clocks, drop the campaign the moment
  `endsAt` passes, re-fetch on foreground/visibility (> 2 min stale) and on country/language change (previous country's
  state is cleared first), and re-fetch the cart when campaign data changes.
* Audit: every create/edit/publish/pause/resume/end/archive/restore/duplicate and rule/block change is recorded
  (`CAMPAIGN_*` activity-log actions + per-campaign history shown in the editor). Campaigns with orders cannot be
  hard-deleted — archive them.

---

## F. Theme and effects

* Presets `BLACK_FRIDAY` (near-black / gold) and `CHRISTMAS` (cream / forest green / burgundy / gold) plus `CUSTOM`;
  every colour is editable per campaign. Tokens: background, surface, primary, secondary, accent, text, muted text,
  badge background, badge text (6-digit hex). Fonts: `DEFAULT | SERIF | SANS` only.
* **Contrast enforced on save/publish (≥ 4.5:1)**: text/background, text/surface, muted/background, muted/surface,
  badge text/badge background. The admin shows the failing pair live; the server refuses it regardless.
* Effects `NONE | SNOWFALL | SPARKLE | SUBTLE_PARTICLES`, intensity 1–10, ≤ 60 particles (fewer on small screens/low power).
  Web: CSS transform/opacity, `aria-hidden`, `pointer-events:none`, **off** for `prefers-reduced-motion`, hidden tabs and
  `/checkout`. Mobile: native-driver `Animated`, hidden from accessibility, `pointerEvents="none"`, stopped when the app
  backgrounds and for reduce-motion, shown only on Home and the campaign screen. Removed automatically when the campaign
  is paused/ends. Banners/CTAs: internal paths or validated `https://` only; text is HTML-stripped.
* Scope of theming: campaign surfaces (announcement bar, banners, landing page, badges, effect). The base storefront
  palette is intentionally **not** re-skinned (the existing UI uses fixed Tailwind/RN tokens).

---

## G. Files by area

**Server** — `config/permissions.js`, `config/roles.js`, `route/campaign.route.js`, `controllers/campaign.controller.js`,
`controllers/order.controller.js`, `controllers/product.controller.js` (create-product fix), `models/campaign.model.js`,
`models/campaign-discount-rule.model.js`, `models/campaign-content-block.model.js`, `models/order.model.js`,
`models/cartproduct.model.js`, `models/activity-log.model.js`, `models/translation.model.js`, `middleware/campaignPricingResponse.js`,
`services/campaignPricing.js`, `utils/campaignScope.js`, `utils/campaignTheme.js`, `utils/campaignValidation.js`,
`utils/translationService.js`, `index.js`, `tests/campaign_*.mjs`, `tests/product_create_partner_int.mjs`.

**Core 0.10.0** — new `@yehgs/icvng-core/campaigns` (endpoints, `fetchActiveCampaign` (never throws), landing/products fetchers,
server-clock countdown, read-only `getCampaignPricing`, `getDiscountBadge`, `getThemeTokens`/`themeToCssVars`,
`getEffectSpec`, `isPriceChanged`, `safeCampaignLink`); checkout helpers now return `code` + `status` on failures.

**Admin** — `pages/marketing/CampaignManagement.jsx`, `components/campaign/{CampaignEditor,CampaignRulesPanel,CampaignBlocksPanel,CampaignThemePreview,campaignUtils,ui}`,
`App.jsx` (route `/dashboard/campaigns`), `components/layout/AdminSidebar.jsx` (Seasonal Campaigns under Content),
i18n `campaigns.*` + `nav.seasonalCampaigns` (en/fr/it; other languages fall back to English).

**Storefront** — `context/CampaignContext.jsx`, `utils/campaignPrices.js`, `components/campaign/{CampaignShell,CampaignBlocks,CampaignBadge,CampaignCountdown,SeasonalEffect}.jsx`,
`pages/CampaignLandingPage.jsx` (`/campaign/:slug`), `components/CardProduct.jsx`, `pages/ProductDisplayPage.jsx`,
`components/{DisplayCartItem,CheckoutCartDisplay}.jsx`, `pages/CheckoutPage.jsx` (409 handling), `provider/GlobalProvider.jsx`
(totals + cart refresh), `App.jsx`, `main.jsx`, `route/index.jsx`, i18n `campaign.*` (en/fr/it).

**Mobile** — see `mobile/MANIFEST.md` (Addendum 4 section).

---

## H. Migrations, deployment and rollback

* **No data migration.** Three new collections are created on first write: `campaigns`, `campaigndiscountrules`,
  `campaigncontentblocks`. `orders.campaignSnapshot` (default `null`) and `cartproducts.campaignPricing`
  (default `null`) are additive fields; existing documents are valid as-is.
* Deploy order: **server first** (additive, no behaviour change until a campaign is published) → admin → storefront → mobile.
  Run `npm install` in admin/client/mobile after replacing the `.tgz` (all three now reference
  `file:./calstins-icvng-core-0.10.0.tgz`; the 0.9.4 tarball was removed).
* Optional env: `CAMPAIGN_CACHE_TTL_MS` (default 15000).
* Run `translateUiLocales.js` + `seedUiTranslations.js` to fill es/pt/nl/ar/hi/zh for the new `campaigns.*`/`campaign.*` keys.
* **Rollback:** end/archive live campaigns (instant, customer-visible effect within the cache TTL) → redeploy previous
  builds. The new collections and the two additive fields can stay (ignored by old code); to remove, drop the three
  collections and `$unset` `orders.campaignSnapshot` / `cartproducts.campaignPricing`. Placed orders keep correct totals either way.
  Old clients still work: they simply show the pre-campaign price and get the 409 text on a stale cart.

---

## I. Related fix — admin "Create Product" dropped partnership stock

On *create*, `partnerStock` (enabled / quantity / partner details) and `colors` were not persisted, while *edit* saved
them. `controllers/product.controller.js#buildPartnerStockForCreate` now normalises and stores them on create, using the
same shape as update. Audit of the create path found no other fields dropped. Test: `tests/product_create_partner_int.mjs`.

---

## J. Verification (what was actually run)

| Check | Result |
|---|---|
| `tests/campaign_pricing_unit.mjs` (engine, rounding, caps, exclusions, tolerance) | **33 passed** |
| `tests/campaign_api_int.mjs` (permission matrix for all 8 sub-roles, cross-country read/write for every operational role, draft-vs-publish, validation, lifecycle, public visibility, listing/detail pricing, overlap conflicts, expiry, audit, delete refusal, cart reprice) | **20 groups passed** |
| `tests/campaign_checkout_int.mjs` (409 on bank/Paystack, CinetPay refusal outside its countries, order snapshot, performance report, immutability, standing-discount parity) | **9 checks passed** |
| Regression: `product_create_partner_int`, `giftcard_cinetpay_int`, `chat_catalogue_int` | pass |
| Core `campaigns` module tests | 17 passed (source + built ESM) |
| Admin `eslint` on new/changed files | 0 errors (1 pre-existing warning in `App.jsx`); `npm run build` ✓ |
| Storefront `vite build` | ✓; `i18n:guard` 266 / 458 allowed |
| Mobile | files parse (esbuild JSX) and every relative / `@yehgs/icvng-core/campaigns` import resolves. **Not** built with Metro/Expo and **not** run on a device or simulator |

DB-backed tests ran against **FerretDB (Mongo-compatible)**, not a real MongoDB instance.

---

## K. Known limitations / follow-ups

1. **Guest checkout** (`guest_order.controller.js`) still trusts client prices — pre-existing, unchanged. Campaign prices
   are not applied there; do not enable guest checkout during a campaign without server re-pricing.
2. **Manual (staff) orders** are staff-priced; campaigns are not applied.
3. **Guest carts** (localStorage / AsyncStorage) show regular prices; campaign pricing applies once the cart is on the server.
4. The webhook-time locked-price order creation and the Stripe line-metadata snapshot are **not covered by automated
   tests** (they need real gateway callbacks); the code paths mirror the tested bank-transfer path. Verify in staging
   with Paystack/Stripe test keys before a real campaign.
5. Paystack `shippingCost` is still supplied by the client (pre-existing); only the product subtotal is guarded.
6. Mobile: no deep link for `/campaign/:slug` yet (`linking.js` only wires verify-email); campaign blocks of type
   product/category are represented by the product grid rather than separate rails.
7. Per-customer / total usage limits and order-wide (cart-level) discounts are **not** implemented (rules are
   line-level only), by design for v1 to keep pricing deterministic.
8. Storefront ESLint config contains a pre-existing typo (`eslintreact/no-unescaped-entities`), so `npm run lint`
   cannot run there until fixed (`react/no-unescaped-entities`).
9. Admin install under `--legacy-peer-deps` needs `react-is` added for `recharts` at build time (pre-existing peer issue).
10. Editor / Sales / Accountant are Nigeria-only for campaigns (see §B open decision).
