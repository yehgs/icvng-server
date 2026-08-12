# I-Coffee (ICVNG) — Product Requirements Document

**Status:** Living document — reflects the platform as built, not just as planned.
Update this whenever a rule, role, or module changes; it's the fastest way for
Claude (or a new engineer) to get oriented without re-reading the whole codebase.

**Repos covered:** `icvng-server` (API), `icvng-admin` (internal admin panel),
`icvng-client` (customer-facing storefront). One product, three codebases.

---

## 1. What this product is

I-Coffee is a multi-country e-commerce platform for coffee, tea, coffee
machines/accessories, and related drinks products, run by Calstins Ltd out of
Abuja, Nigeria (HQ). The storefront sells directly to consumers (BTC) and
supports business-to-business (BTB) pricing. An internal admin panel gives
staff (Accountants, Editors, Warehouse, Sales, IT, Director, etc.) the tools
to manage the catalog, pricing, orders, logistics, stock, content, and staff
accounts across every market the business operates in.

**Live markets today:** Nigeria (NG, HQ), Togo (TG), Benin (BJ), Italy (IT).
Adding a market is meant to be config-only (see §4).

---

## 2. Goals

- One codebase serves every country market — no forked repos per country.
- HQ (Nigeria) staff can see and manage everything, everywhere, by default.
- Country/"foreign" staff (where they exist) see and touch only their own
  country's data — enforced server-side, not just hidden in the UI.
- Pricing is centrally controlled by Accounting/HQ, never left open to
  whoever happens to be editing a product, except where the business
  explicitly wants it open (partner/supplier-driven products).
- Every admin action is attributable (who set this price, who approved this
  order, who touched this user account) and reversible where it matters
  (price history, activity log).

## 3. Non-goals (for now)

- Multi-warehouse-per-country inventory. Stock/warehouse is currently a
  single HQ-managed pool with country-aware storefront visibility, not a
  per-country warehouse network.
- Departments/team hierarchy below subRole (flagged in code as "Phase 2.x
  departments", not implemented).

---

## 4. Multi-country architecture

Single source of truth: `server/config/countries/index.js` (`COUNTRY_CONFIG`).
Each country entry defines: code, name, domain, admin domain, currency
(code/symbol/decimals), supported languages + default, payment gateways
enabled (Paystack / Stripe), timezone, phone prefix, flag emoji, SEO site
name. Adding a market is meant to require only:

1. One new entry in `COUNTRY_CONFIG`.
2. A domain → country mapping (`DOMAIN_MAP`) so the storefront/admin can
   detect which market a request belongs to.
3. Payment gateway keys in env vars if needed.

The storefront and admin both detect the active country from the request's
hostname (`x-storefront-host` header from the admin panel, since the API
only sees its own hostname otherwise) and adjust currency, language, and
available payment methods accordingly.

**Data scoping** (who sees which country's orders/customers/etc.) is a
*separate* axis from the country config above — see §6.

---

## 5. User-facing apps (storefront)

Key storefront capabilities (non-exhaustive, see `client/src/pages`):

- Product browsing: home, category/sub-category, search, product detail,
  brand pages, comparisons, wishlist.
- BTC checkout (guest + registered) and BTB flows, with Paystack and Stripe
  routed per-country per `COUNTRY_CONFIG.payments`.
- Order tracking, order history, invoices.
- Product requests (customer asks for a product not yet listed).
- Content: blog, FAQ, About/Our Story, policies (privacy, returns,
  shipping, T&Cs), partner-with-us, contact.
- Auth: email/password, Google OAuth, OTP verification, password
  reset/recovery.
- i18n: English always; French and Italian per-market (see `COUNTRY_CONFIG`
  per-country `language.supported`).

## 6. Admin panel — roles & access model (RBAC)

Two **orthogonal** axes control what an admin can do. Keep them mentally
separate — a bug in this system is almost always someone conflating the two:

1. **Capability** — *what modules/actions* a subRole can use. Defined in
   `server/config/roles.js` (`ROLE_DEFINITIONS`), expressed as permission
   keys (`pricing.manage`, `orders.refund`, etc.), consumed via
   `requirePermission` middleware and the `/me/capabilities` endpoint.
2. **Territory** — *whose data* an admin sees. Driven purely by
   `user.scope` (`GLOBAL` | `COUNTRY`) and `user.assignedCountry`. A
   `GLOBAL` admin sees every country; a `COUNTRY` admin ("foreign admin")
   sees only their assigned country's orders/customers/etc.

**The same subRole can, in principle, exist at both HQ and country level**
(e.g. a country-scoped MANAGER vs. an HQ MANAGER) — subRole alone cannot
tell them apart; scope must be checked too wherever that distinction
matters (pricing rights are the current example — see §7).

### 6.1 Current staff roles

| subRole | HQ-only (always `scope: GLOBAL`)? | Summary |
|---|---|---|
| `IT` | Yes | Full technical access, all modules, all countries. |
| `DIRECTOR` | Yes | Executive — full access, all modules, all countries. |
| `ACCOUNTANT` | Yes | Finance & pricing owner — invoices, finance entries, pricing (full: general pricing, price list, Direct Pricing, pricing config, price calc/utilities), exchange rates, reports. **There is only ever one Accountant role — no country/"foreign" Accountant accounts.** |
| `WAREHOUSE` | Yes | HQ inventory — stock, warehouse, purchase-order fulfilment. Same "always HQ" rule as Accountant. |
| `EDITOR` | Yes | Content & catalog — products, blog, banners, sliders, translations, Direct Pricing (view/limited). Same "always HQ" rule. |
| `MANAGER` | **No — can be either** | Broad operational access excluding system settings/role/user management. An **HQ Manager** (scope GLOBAL) additionally has pricing-edit rights (product form + Direct Pricing creation); a country/"foreign" Manager does not, even though it's the same subRole — see §7. |
| `SALES_MANAGER` / `SALES` | No | Orders, customers, CRM, product/order requests. Can be HQ or country-scoped. |
| `HR` | No | Bounded user management (cannot touch DIRECTOR/IT/MANAGER accounts), stock/warehouse visibility. |
| `LOGISTICS` | **No — can be either** | Shipping/tracking/logistics ops. A country-scoped LOGISTICS admin manages only their own country's shipping zones/methods (`ShippingZone`/`ShippingMethod` carry `countryScopedPlugin`, same isolation mechanism as orders/customers); an HQ LOGISTICS admin (scope GLOBAL) sees/manages every country's. This shipped after being a temporary HQ-only constraint — `LOGISTICS` was removed from `HQ_ONLY_SUBROLES` once the country-scoped logistics system landed. |
| `GRAPHICS` | No | Visual/marketing content only. |

`HQ_ONLY_SUBROLES` (exported from `server/config/roles.js`) is the single
source of truth for "this subRole can never be country-scoped" — both the
admin-creation UI (`CreateUserModal`/`EditUserModal`) and the backend
(`admin_user.controller.js`, `middleware/countryScope.js`,
`capabilities.controller.js`) read from the same list so they can't drift
apart. **Never hardcode a second copy of this list** — import it.

### 6.2 Enforcement layers (defense in depth)

A country-scoped/"foreign" admin is blocked from HQ-only modules
(Procurement, Pricing, Bank Transfer settings, Exchange Rates, Password
Vault, etc.) at three independent layers, all of which must stay in sync.
(Logistics is **not** in this HQ-only group any more — see §6.1 — it uses
the country-scoped-data pattern instead, the same as orders/customers.)

1. **UI** — `AdminSidebar.jsx` hides whole sections (`COUNTRY_BLOCKED_TOP_LEVEL`)
   and sub-items (`COUNTRY_BLOCKED_SUB_PATHS`) for non-global admins.
2. **Route middleware** — `blockCountryScopedAdmins` (in
   `middleware/countryScope.js`) hard-blocks COUNTRY-scoped admins from
   HQ-only route groups with a 403.
3. **Controller-level checks** — e.g. `isPricingOwnerRole()` in
   `product.controller.js` / `directPricing.controller.js` for the
   HQ-Manager pricing exception (§7).

HQ-only subRoles are additionally self-healing at three points so a stale
`scope: COUNTRY` value on an Accountant/Warehouse/Editor/etc. record can
never cause a data leak or a broken dashboard: on login
(`admin_auth.controller.js`), on any IT/DIRECTOR-driven user update
(`admin_user.controller.js`), and defensively on every request
(`middleware/countryScope.js`, `capabilities.controller.js`).

---

## 7. Pricing architecture

Three price fields drive what a customer can actually buy — see
`server/PRODUCT_VISIBILITY_RULES.md` for the full purchasability formula.
This section covers **who can set them and how**.

### 7.1 Pricing owners

"Pricing owner" = `ACCOUNTANT`, `IT`, `DIRECTOR`, or an **HQ Manager**
(`MANAGER` with `scope !== "COUNTRY"`). A country/"foreign" Manager is not
a pricing owner. This check is duplicated (intentionally, to keep it
obvious and auditable) in:

- `product.controller.js` → `isPricingOwnerRole()` / `canSetPricing()`
- `directPricing.controller.js` → `isPricingOwnerRole()`
- Admin UI: `ProductForm.jsx` (`canEditPricing`), `RoleBasedButton`'s
  `hqOverrideRoles` prop, `directPricingUtils.canEditDirectPricing()` in
  `admin/src/utils/api.js`

**Exception:** if a product is a partner/supplier product
(`partnerStock.enabled === true`), pricing is supplier-driven and *any*
role may set it — that's the one case pricing ownership doesn't apply.

### 7.2 Two ways to set a price, kept in sync

- **General product form** (`ProductForm.jsx` → product edit modal) — a
  pricing owner can edit BTB/BTC/2-week/5-week prices right there.
- **Direct Pricing** (`DirectPricingManagement.jsx` /
  `AccountingPricingManagement.jsx`) — a side collection
  (`DirectPricing` model) that overrides a product's BTC/delivery prices
  without touching the Product record directly, with its own approval/
  history trail.

When an active Direct Pricing record exists for a product, its non-zero
values are always what customers and the rest of the admin see (see
`utils/mergeDirectPricing.js` — Direct Pricing wins over the Product
record whenever it has a value > 0). **A pricing owner editing the product
form is not restricted to "view only" here** — their edit is written to
the Product record *and* synced into the active DirectPricing record in
the same request (`product.controller.js`'s DIRECT PRICING SYNC block), so
the two never drift apart and the next read doesn't silently revert the
edit. A non-pricing-owner's submitted price values are dropped and the
existing DirectPricing-managed values are restored instead, so they can
never accidentally zero out an Accountant-set price.

---

## 8. Content translation (AI-assisted)

Non-English storefront copy (French, Italian — per-country via
`COUNTRY_CONFIG.language.supported`) is machine-translated from the
English "master" record using OpenAI (`server/services/ai/openaiTranslationClient.js`,
Responses API with structured JSON output), not a rules-based/third-party
MT service. `server/utils/translationService.js` is the business-logic
layer on top of it.

**How it's triggered:**
- **Automatically** on create/update, for every entity type listed in
  `TRANSLATABLE_FIELDS` — product, category, subCategory, blog post, blog
  category, blog tag, banner, slider, FOMO message, notification, coupon,
  country content, home content blocks, and the shared catalog dictionaries
  (tag/attribute/color). This call is `await`ed by the controller (not
  fire-and-forget) so a real failure surfaces instead of being silently
  swallowed.
- **Manually**, via the "Auto" button in each item's inline Translations
  panel (`InlineTranslateFields.jsx`) — same pipeline, same endpoint
  (`POST /translations/trigger`), useful for re-running after an edit or
  recovering from a transient failure.
- **SitePage** content (About Us, FAQ, policies, etc.) uses a separate
  function, `translateSitePage()`, because page content is a free-form
  admin-authored dictionary rather than a fixed field list — it recursively
  walks `content`/`seo` and translates every string leaf except a
  deliberately-excluded set of config-only keys (icons, slugs, numeric
  stats, etc. — see `PAGE_NON_TRANSLATABLE_KEYS`).
- **Bulk backfill**: `node scripts/bulkTranslateContent.js` runs every
  Product and BlogPost through the same pipeline in one pass — for content
  that existed before auto-translate-on-save was wired up/fixed, or after
  a large import.

**Never machine-translated:** brand names (`brand` has no entry in
`TRANSLATABLE_FIELDS` on purpose) — they're proper nouns and translating
them would corrupt them, not localize them.

**Manual-edit protection:** if a human has hand-edited a language's
translation for an entity (`autoTranslated: false` on the `Translation`
document, set automatically when an admin edits via the panel), the
auto-translate pass never overwrites that field again — it only fills in
still-missing/still-auto fields. This is what makes the bulk script and
repeated "Auto" clicks safe to re-run.

**Data model:** one `Translation` document per (entityType, entityId,
language), a flexible `fields` map (works for every entity type without
per-type schema changes) — see `models/translation.model.js`.

---

## 9. Core backend modules

Non-exhaustive map of `server/controllers` by domain:

- **Catalog** — products, categories, sub-categories, brands, colors, tags,
  attributes, compatible systems, compare, ratings.
- **Commerce** — cart, checkout, orders (customer + admin-side/manual +
  website), guest orders, coupons, wishlist, invoices.
- **Pricing & finance** — pricing config, Direct Pricing, exchange rates,
  finance entries.
- **Procurement & inventory** — suppliers, purchase orders, stock, quality
  control, warehouse, expiration/expiry management.
- **Logistics** — shipping, logistics zones, tracking, shipment creation.
- **People** — admin users (staff), customers, RBAC (`roles.js`,
  `permissions.js`), activity log, password vault.
- **Content & marketing** — blog (posts/categories/tags), banners, sliders,
  home content blocks, site pages, SEO, FOMO widget, subscribers.
- **Support & requests** — support tickets, product requests, order
  requests + order-request auth, contact messages, CRM leads.
- **Platform** — country management/config, translations (AI-assisted —
  see §8), notifications, file/image upload, scraper tool + quota.

---

## 10. Cross-cutting rules worth knowing before touching code

- **`scope` vs `assignedCountry`**: `scope: "GLOBAL"` → sees/manages
  everything, `assignedCountry` is always `null`. `scope: "COUNTRY"` →
  scoped to exactly one `assignedCountry`. Never let a subRole in
  `HQ_ONLY_SUBROLES` end up with anything other than
  `{ scope: "GLOBAL", assignedCountry: null }` — see §6.
- **Domain-restricted login**: non-IT/DIRECTOR admins can only log in from
  their own market's admin domain (`app.i-coffee.<tld>`); IT/DIRECTOR can
  log in from any market's portal.
- **`price3weeksDelivery` naming**: despite the name, this is the "2 Weeks
  Delivery" price in every UI. Legacy naming, don't rename the field — see
  `PRODUCT_VISIBILITY_RULES.md`.
- **Partner/supplier stock**: an NG-specific arrangement today
  (`canSeePartnerStock` gates on `isGlobalAdmin || countryScope === "NG"`).
- **A product with no way for a customer to buy it** (no online stock, no
  partner stock, no matching-type delivery price) is force-set to `DRAFT`
  on save, regardless of what `publish` value was submitted.

---

## 11. Open items / near-term roadmap

- Phase 2.x departments (sub-groupings within a subRole) — not started.
- Consider migrating `AdminSidebar`/`CountryScopeBanner` off the
  login-cached `localStorage` user object and onto the already-normalized
  `/me/capabilities` endpoint (`CapabilitiesContext`), so a stale cached
  scope can never cause a UI/data mismatch even before a re-login. Today,
  the backend self-heals immediately (§6.2) but the *cached* frontend user
  object only refreshes on next login.

---

## 12. Change log (high-signal only — not every commit)

- **Translation pipeline reliability fix** — auto-translate (OpenAI-backed)
  was silently failing platform-wide: `dotenv.config()` ran after ~70
  imports so env vars weren't loaded before the translation modules
  initialized; the "Auto" button and every auto-on-save call fired
  `translateEntity()` without awaiting it and always reported success
  regardless of outcome. Both fixed — `dotenv/config` is now the first
  import in `index.js`, and every translate call (manual trigger +
  auto-on-save, across product/category/blog post/blog category/blog
  tag/banner/slider/sitePage) is awaited with real per-language
  success/error reporting. Also fixed along the way: `banner`'s
  `TRANSLATABLE_FIELDS` referenced field names (`description`/
  `buttonText`) that don't exist on the schema (real fields are
  `subtitle`/`linkText`), so only banner titles were ever machine-
  translated; sliders and banners had no auto-translate-on-save wiring at
  all (`translateEntity` was imported but never called); the `/translations/
  trigger` endpoint never actually supported `entityType: "page"` despite
  SitePage having its own translation function. Brand names are now
  explicitly excluded from translation (`TRANSLATABLE_FIELDS` has no
  `brand` entry) — they're proper nouns. Added `scripts/bulkTranslateContent.js`
  (`npm run translate:bulk-content`) to backfill translations for existing
  products/blog posts created before these fixes. See §8.
- **Item #9** — Accountant/Warehouse/Editor confirmed as permanently
  HQ-only (no country/"foreign" accounts); centralized via
  `HQ_ONLY_SUBROLES` in `config/roles.js`; self-healing added at login,
  user-update, and request-scoping layers. HQ Manager granted pricing
  rights (product form + Direct Pricing creation), scoped to `scope ===
  "GLOBAL"` only. Direct Pricing no longer locks the product-form price
  fields for pricing owners — edits sync both ways instead of one
  overwriting the other.
