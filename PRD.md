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
| `EDITOR` | Yes | Content & catalog — products, blog, banners, sliders, translations, Direct Pricing (view/limited). Same "always HQ" rule. Holds `suppliers.view` (not `suppliers.manage`) so they can pick or quick-create a **PARTNER**-type supplier when enabling Partner Stock on a product — see §10. |
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

Non-English storefront copy is machine-translated from the English
"master" record using OpenAI (`server/services/ai/openaiTranslationClient.js`,
Responses API with structured JSON output), not a rules-based/third-party
MT service. `server/utils/translationService.js` is the business-logic
layer on top of it. There are two genuinely separate translation systems —
don't conflate them:

- **Database content** (products, blog posts, categories, etc.) → the
  `Translation` collection, read at request time. Covered in this section.
- **Hardcoded UI copy** (nav labels, buttons, empty states — everything
  NOT stored in the database) → static per-language `.js` files bundled at
  build time in `admin/src/i18n/locales/` and `client/src/i18n/locales/`.
  See §8a.

**Supported languages:** `ALL_SUPPORTED_LANGUAGES`
(`config/countries/index.js`) is the union of two sources — every
language any individual country supports (`COUNTRY_CONFIG[...].language.supported`,
e.g. fr/it) **plus** `GLOBAL_EXTRA_LANGUAGES`, a manually maintained list
of site-wide languages not tied to any single country's storefront
default (currently es, pt, nl, ar, hi, zh — added for reach/accessibility,
not because any current market defaults to them). A shopper on any
country's domain can pick any supported language from the switcher and see
AI-translated product/blog copy in it, regardless of whether it's that
country's default. Arabic additionally flips `<html dir="rtl">` via
`RTL_LANGUAGES` (same file) — see `CountryContext.jsx`/`AdminCountryContext.jsx`.

**Entity types covered** (`TRANSLATABLE_FIELDS` in `translationService.js`,
now exported so tooling can discover them dynamically instead of
hardcoding a list): product, category, subCategory, blog, blogCategory,
blogTag, banner, slider, fomo, notification, coupon, country,
homeContentBlock, tag, attribute, color. **Never translated:** brand
names (`brand` has no entry — they're proper nouns; translating one would
corrupt it, not localize it).

**How it's triggered:**
- **Automatically** on create/update, for every entity type above. This
  call is `await`ed by the controller (not fire-and-forget) so a real
  failure surfaces instead of being silently swallowed.
- **Manually**, via the "Auto" button in each item's inline Translations
  panel (`InlineTranslateFields.jsx`) — same pipeline, same endpoint
  (`POST /translations/trigger`). Content fields whose source is real HTML
  from a WYSIWYG editor (currently just blog `content`) get a lightweight
  Tiptap rich-text editor here instead of a plain textarea showing raw
  markup — see the component's `richTextFields` prop.
- **SitePage** content (About Us, FAQ, policies, etc.) uses a separate
  function, `translateSitePage()`, because page content is a free-form
  admin-authored dictionary rather than a fixed field list — it recursively
  walks `content`/`seo` and translates every string leaf except a
  deliberately-excluded set of config-only keys (icons, slugs, numeric
  stats, etc. — see `PAGE_NON_TRANSLATABLE_KEYS`).
- **Bulk backfill**: `node scripts/bulkTranslateContent.js` — fully
  dynamic (not hardcoded to product/blog), covering every entity type
  above via an `ENTITY_REGISTRY` map. `--entities=` (alias `--only=`) and
  `--languages=` restrict the run; both default to everything. **Resumable
  by default** (`skipExisting`): a field that already has a translated
  value is left alone on a re-run, so an interrupted run (dropped DB
  connection, bad key discovered partway through, Ctrl+C) just needs the
  exact same command run again rather than re-translating — and
  re-billing OpenAI for — everything from scratch. Pass `--force` for a
  genuine full re-translate. The document-fetch step and each entity's
  translation call are wrapped in retry-with-backoff, and one entity
  type's total failure no longer aborts the rest of the run.

**Manual-edit protection:** if a human has hand-edited a language's
translation for an entity (`autoTranslated: false` on the `Translation`
document, set automatically when an admin edits via the panel), the
auto-translate pass never overwrites that field again — it only fills in
still-missing/still-auto fields.

**Failure handling:** `translateBatchAIDetailed()` (openaiTranslationClient.js)
tracks per-item success separately from the returned strings — a field
that fails after retries is left out of what gets persisted entirely
(not silently written as untranslated English stamped like a real
translation). `translateEntity()`/`translateSitePage()` report
`"ok"`/`"partial"`/`"error"` per language accordingly, and the trigger
endpoint/admin UI reflect the real outcome instead of an unconditional
"Translation complete." Diagnostic logging (`[openaiTranslationClient]`/
`[translationService]` prefixed) includes status code, error type, and
enough context to diagnose a bad API key, quota/billing issue, wrong
model name, or oversized input without reproducing it live.

**Data model:** one `Translation` document per (entityType, entityId,
language), a flexible `fields` map (works for every entity type without
per-type schema changes) — see `models/translation.model.js`.

**Startup ordering gotcha (fixed, but worth knowing):** any script that
doesn't import `config/connectDB.js` won't get `.env` loaded for free —
`connectDB.js` calling `dotenv.config()` was an accidental side-effect
dependency for scripts that only needed OpenAI, not MongoDB
(`scripts/translateUiLocales.js` hit exactly this — it looked like a bad
API key when the key was actually just never loaded). Every entry point
that needs `.env` — `index.js` and every standalone script — now imports
`dotenv/config` as its own first line rather than relying on another
module's side effect.

**"Input exceeds the context window" failures — root cause & fix:**
pasting or drag-dropping an image directly into the blog post rich-text
editor (`admin/src/pages/blog/BlogPosts.jsx`'s `RichEditor`) had no
handling, so Tiptap/ProseMirror's default paste behavior embedded it as a
base64 `data:image/...;base64,...` string directly inside the saved HTML
— a single screenshot easily inflates a post's `content` field from a
normal few-KB to several MB (base64 costs ~33% more text than the
original binary size). That's what two posts actually had (3,085,572 and
844,261 characters — a normal post is a few KB to maybe 20-30KB even with
several properly-uploaded image URLs), and it's wildly outside any LLM's
per-request context window. Fixed at the source: the editor now
intercepts paste/drop and uploads the image to Cloudinary the same way
the toolbar's "Insert Image" button already did, so the base64 embed can't
happen going forward (with a defensive strip for the rarer case of
pasting rich HTML — e.g. from a Word doc — that already contains an
embedded base64 image). `scripts/findOversizedContent.js` scans every
entity type for abnormally large translatable fields (not just blog
content) to find any pre-existing occurrences so they can be manually
repaired (re-insert the image via the now-fixed upload path).

---

## 8a. UI-copy translation (hardcoded locale files)

`admin/src/i18n/index.js` and `client/src/i18n/index.js` are a lightweight
zero-dependency i18n engine (deep-merge over an English base, localStorage
persistence) — same engine, separately instantiated per app. Locale files
live in `src/i18n/locales/{lang}.js`, one flat-ish nested object of
strings per language.

**Generator script:** `server/scripts/translateUiLocales.js` — a
different tool from `bulkTranslateContent.js` (translates static files in
the admin/client repos, not database content). Flattens `en.js`, batches
it through the same `translateBatchAIDetailed()` OpenAI pipeline, and
writes `{lang}.js`. Incremental by default (an existing non-empty value
for a key is left alone on re-run — hand-edited overrides survive);
`--force` fully regenerates. Expects `icvng-admin`/`icvng-client` as
sibling folders next to `icvng-server` by default — override with
`--admin-dir=`/`--client-dir=`. At last count: ~2,300 admin keys, ~750
client keys, across 6 newly-added languages per app — a first full run is
a genuinely large/slow/costly one-time job.

**Header language switcher:** `client/src/components/LanguageSelector.jsx`
(SVG-flag based, via `FlagIcon.jsx`) is the one actually rendered in
`HeaderTest.jsx` — `LanguageSwitcher.jsx` (emoji-flag based) exists but
isn't wired into the live header. It now derives its list from
`SUPPORTED_LANGUAGES`/`LANGUAGE_NAMES` (`i18n/index.js`) instead of a
separately hand-maintained copy of the same 9 codes (previously a third
independent copy of this list existed, alongside the admin's own — see
the `InlineTranslateFields.jsx` fix in §8). Not filtered to the current
country's configured languages, since these are site-wide UI/content
languages independent of any market's default (see the note on
`GLOBAL_EXTRA_LANGUAGES` above).

---

**Manual translation UI didn't match what the pipeline actually supports
(fixed):** despite the backend already supporting all 9 languages via
`ALL_SUPPORTED_LANGUAGES` above, `InlineTranslateFields.jsx` — the shared
component every product/category/subCategory/brand/tag/attribute/color/
banner/slider/fomo/coupon translation panel is built on — along with
`BlogPosts.jsx` and `SitePagesManagement.jsx`, each had their own
hardcoded `ALL_NON_EN = [fr, it]` array instead of reading the real
language list. So every "Translations" panel in the admin only ever
offered French/Italian as manual targets, even though es/pt/nl/ar/hi/zh
translations could already exist in the `Translation` collection (created
automatically on save, or via a bulk-translate run) — an admin just had
no UI to see or hand-edit them. All three now derive their language list
from `SUPPORTED_LANGUAGES`/`LANGUAGE_NAMES` in `admin/src/i18n/index.js`
(§8a) instead of a separate hardcoded copy.

---

## 8b. Language lib (DB-backed language metadata + CRUD)

Before this, "which languages does the platform support" only existed as
hardcoded arrays duplicated across several files (`admin/src/i18n/index.js`,
`client/src/i18n/index.js`, `client/src/components/LanguageSelector.jsx`,
plus the three admin translation-panel files fixed above) — all agreeing
on the same 9 codes (en, fr, it, es, pt, nl, ar, hi, zh) by discipline, not
by a single source of truth, and changing the set meant editing source in
several places and redeploying.

`models/language.model.js` is a new collection giving that list a
database-backed metadata layer: `code`, `name` (English), `nativeName`,
`flagEmoji`, `isRTL`, `isActive`, `sortOrder`. It does **not** replace
`ALL_SUPPORTED_LANGUAGES` as the source of truth for which codes the
`Translation` model's `language` field will accept — that's still a
static export because Mongoose enums resolve at schema-compile time, so
it can't read a collection synchronously at boot. The Language collection
is the editable *metadata* layer on top: display name, native name, flag,
RTL, and an active/inactive toggle (deactivating hides a language from
switchers without touching any of its existing `Translation` documents).

- **API:** `GET /api/languages/active` (public — client/admin switchers),
  `GET /api/languages` (admin, all languages including inactive), `POST /
  PUT /:languageId / DELETE /:languageId` (admin CRUD) — see
  `controllers/language.controller.js` / `route/language.route.js`.
  Gated on `translations.view`/`translations.manage` (same permissions
  that already govern the rest of the content-translation system —
  EDITOR/MANAGER/IT/DIRECTOR all hold at least one), `hqOnly: true`.
  `code` is create-only, never editable after (every `Translation`
  document and the AI pipeline key off it). English (`en`) can't be
  deactivated or deleted — it's the master content language every
  translatable field is authored in by default.
- **Admin UI:** `admin/src/pages/settings/LanguageManagement.jsx`
  (`/admin/languages`, nav under Settings — IT/DIRECTOR/EDITOR, matching
  the "always HQ" subRoles; MANAGER can reach it directly if HQ-scoped,
  but isn't shown the nav link since a country-scoped Manager would just
  hit the `hqOnly` guard).
- **Seed script:** `node scripts/seedLanguages.js` inputs the same 9
  languages into the collection (idempotent — upserts by `code`, skips
  existing rows unless `--force`, which never touches `isActive` so it
  can't silently re-enable something an admin turned off).
- Adding a language here makes it *selectable*, but doesn't retroactively
  translate existing content — follow up with
  `node scripts/bulkTranslateContent.js --languages=<code>` (§8) to
  backfill product/category/subCategory/blog/etc. content into it.

---

## 8c. UI-copy CRUD (making the locale files DB-editable)

Even after §8a's `translateUiLocales.js` generates a locale file, the
*only* way to fix or tweak one of those ~2,300 admin / ~750 client strings
was still: edit the `.js` file in the repo → commit → redeploy. There was
no live-editing path — unlike database content (products, blog, etc.),
which has always had one via `InlineTranslateFields.jsx`.

`models/uiTranslation.model.js` is a new collection — one document per
`(app, key, language)`, e.g. `{ app: "admin", key: "common.save",
language: "fr", value: "Enregistrer" }`. `app` is `"admin"` or `"client"`
since each has its own independent key set. This does **not** replace the
static locale files — it's an override layer on top:

- **Live loading:** `admin/src/i18n/index.js` and `client/src/i18n/index.js`
  both keep an `EFFECTIVE` object that starts as a clone of the bundled
  static `MERGED` locales (always available synchronously — no flash of
  untranslated content, works even if the API is down) and gets
  `applyDbOverrides(lang, flatMap)`'d on top once
  `GET /api/ui-translations/merged?app=<app>&language=<lang>` resolves
  (`loadUiTranslationOverrides()`, called from `AdminCountryContext.jsx`
  on mount/every language switch, and from `CountryContext.jsx` on mount
  only — the client already does a full page reload on language switch,
  so there's no in-place case to handle there). `translate()` reads from
  `EFFECTIVE`, not `MERGED`, so a DB override actually takes effect.
  `subscribeI18nRevision()` is a tiny pub-sub so already-rendered strings
  re-translate once the async fetch resolves, instead of only affecting
  strings rendered after it (`t`'s `useCallback` deps include the bumped
  revision counter in both contexts).
- **API:** `GET /api/ui-translations/merged` (public — this is what the
  live apps call; UI chrome isn't sensitive), `GET /api/ui-translations`
  (admin, paginated/searchable browse+edit — keyed off the English rows as
  the canonical key list, joined with the requested language's value),
  `GET /api/ui-translations/namespaces` (admin, distinct top-level key
  prefixes for the section filter dropdown), `PUT /api/ui-translations`
  (admin, upsert one key's value for one non-English language — English
  itself isn't editable through this system; it's the base copy, edit
  `en.js` and re-run the seed script instead). Same
  `translations.view`/`translations.manage` gating as §8b.
- **Manual-edit protection:** a row gets `isEdited: true` once saved
  through the admin UI — same discipline as the content-translation
  pipeline (`translationService.js`) and `seedLanguages.js`. This matters
  for the seed script below, which skips edited rows by default.
- **Admin UI:** `admin/src/pages/settings/UiTranslationsManagement.jsx`
  (`/admin/ui-translations`) — pick app + language + optional
  section/search filter, edit values inline against the English reference
  column, paginated (25/page — the admin key set alone is in the
  thousands, an unpaginated table would be unusable). Same
  IT/DIRECTOR/EDITOR nav visibility reasoning as §8b.
- **Seed script:** `node scripts/seedUiTranslations.js` is what actually
  *inputs* the existing locale-file content into this collection —
  flattens every `{app}/src/i18n/locales/{lang}.js` (same
  `icvng-admin`/`icvng-client` sibling-folder convention as
  `translateUiLocales.js`, same `--admin-dir=`/`--client-dir=` override)
  into dot-path keys and upserts one row per key/language. Idempotent and
  incremental: skips a row already marked `isEdited` (protects hand edits
  from the admin CRUD) and skips a row whose value already matches the
  file (no-op writes). `--force-edited` overrides the edited-row
  protection (rare — mainly right after a locale file was deliberately
  rewritten wholesale and should now win over any prior hand edits).
  `--dry-run` reports counts without writing. Must be re-run any time
  `en.js` (or another locale file) gains new keys, or the new keys simply
  won't exist in the DB-editable table yet (the live apps still work
  fine in the meantime — they fall back to whatever's bundled in the
  static file, same as any key with no DB override).

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
  (`canSeePartnerStock` gates on `isGlobalAdmin || countryScope === "NG"` —
  this already covers EDITOR, since EDITOR is unconditionally
  `isGlobalAdmin` per `HQ_ONLY_SUBROLES`). Enabling it on a product
  requires picking or creating a supplier, which is a *separate* permission
  gate (`suppliers.view`/`suppliers.manage`, see below) — don't assume
  `canSeePartnerStock === true` alone means a role can finish the flow.
- **Supplier permissions are two-tier, and matter for partner-stock
  products specifically**: `suppliers.manage` (DIRECTOR/IT only — see
  `AdminSidebar` nav gating) unlocks the full Supplier Management module
  (procurement, bank/tax details, edit/delete any supplier) via `GET/PUT/
  DELETE /suppliers*` and `POST /suppliers` for a **FULL** supplier record.
  `suppliers.view` (EDITOR, WAREHOUSE, and — via scope, not subRole — an
  HQ Manager) only unlocks the lightweight `GET /suppliers/selection`
  endpoint (name/email/phone/**supplierType**, `ACTIVE` only — used by
  `ProductForm.jsx`'s Partner Stock supplier dropdown) plus a *narrowed*
  `POST /suppliers`: `createSupplierController` requires `suppliers.manage`
  for anything except a minimal `supplierType: "PARTNER"` record (name
  required, email/phone optional, no address/contactPerson/bankDetails/
  taxInfo/paymentTerms/non-default status) — submitting anything beyond
  that with only `suppliers.view` gets a 403, not a silent strip. Before
  this was added, `suppliers.view`-only roles (EDITOR included) had *no*
  usable path to select or create a partner supplier at all — the old
  `GET /suppliers` used by the form required `suppliers.manage`, so the
  Partner Stock section rendered (per `canSeePartnerStock` above) but the
  supplier field inside it always came up empty and uncreatable.
- **A product with no way for a customer to buy it** (no online stock, no
  partner stock, no matching-type delivery price) is force-set to `DRAFT`
  on save, regardless of what `publish` value was submitted — on both
  create and update. `ProductForm.jsx`'s client-side validation no longer
  hard-blocks submission when pricing is missing (it did previously,
  duplicating this server-side safeguard as a dead-end error instead of
  letting it do its job) — the amber "will be hidden from shop" banner is
  informational only now; submission always proceeds and the server
  decides the resulting `publish` status.
- **Subcategory dropdown caching**: `admin/src/utils/categoryService.js`
  caches the flat category and subcategory lists client-side for 5 minutes
  (shared across every consumer — `ProductForm.jsx`, filter dropdowns,
  etc.). `CategoryManagement.jsx` calls `clearCategoryCache()` after every
  category create/update/delete; `SubCategoryManagement.jsx` must do the
  same after every subcategory create/update/delete, or a subcategory
  created there won't appear in `ProductForm.jsx`'s subcategory dropdown
  for up to 5 minutes (this was previously missing — the most common way
  to hit it: create a subcategory, then immediately go create a product
  using it).

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

- **UI-copy locale files (i18n folder content, both apps) made
  DB-editable via a new admin CRUD** — previously the only way to change
  one of the ~2,300 admin / ~750 client hardcoded strings in
  `src/i18n/locales/*.js` was editing the file and redeploying, unlike
  database content which already had `InlineTranslateFields.jsx`. New
  `uiTranslation` collection (`models/uiTranslation.model.js`) stores one
  row per `(app, key, language)`; `admin/src/i18n/index.js` and
  `client/src/i18n/index.js` both now overlay DB values on top of the
  bundled static locale (`EFFECTIVE`/`applyDbOverrides`/
  `loadUiTranslationOverrides`/`subscribeI18nRevision`) instead of reading
  the static `MERGED` object directly, wired in via
  `AdminCountryContext.jsx`/`CountryContext.jsx`. New admin page
  `UiTranslationsManagement.jsx` (`/admin/ui-translations`) is the actual
  CRUD — paginated/searchable, edits go live without a deploy. New
  `scripts/seedUiTranslations.js` is what inputs the existing locale-file
  content into the collection in the first place (flattens every locale
  file into dot-path rows, incremental + manual-edit-protected, same
  conventions as `translateUiLocales.js`). See §8c.
- **Language lib made admin-manageable + translation UI expanded past
  fr/it** — two related fixes. (1) `InlineTranslateFields.jsx`,
  `BlogPosts.jsx`, and `SitePagesManagement.jsx` each hardcoded their
  manual-translation language picker to just `[fr, it]`, even though the
  backend (`ALL_SUPPORTED_LANGUAGES`) already supported all 9 — fixed to
  read `SUPPORTED_LANGUAGES`/`LANGUAGE_NAMES` from `admin/src/i18n/index.js`
  instead, immediately unlocking es/pt/nl/ar/hi/zh across product,
  category, subCategory, brand, tag, attribute, color, banner, slider,
  fomo, coupon, blog, and site-page translation panels in one shared fix.
  Also added the two missing language names (`hi`, `zh`) to
  `openaiTranslationClient.js`'s prompt-facing name map. (2) New
  `Language` collection + CRUD (`models/language.model.js`,
  `controllers/language.controller.js`, `route/language.route.js` at
  `/api/languages`, admin page `LanguageManagement.jsx` at
  `/admin/languages`) makes the language list itself admin-manageable
  instead of only existing as hardcoded arrays; `scripts/seedLanguages.js`
  seeds it with the same 9 languages. Also deduplicated
  `client/src/components/LanguageSelector.jsx`'s own separately-maintained
  copy of the same list to import from `i18n/index.js` instead. See §8/§8a/§8b.
- **HQ Editor couldn't complete partner/partnership product creation** —
  `canSeePartnerStock` already correctly showed the Partner Stock section
  to EDITOR, but `ProductForm.jsx` fetched suppliers via `GET /suppliers`
  (requires `suppliers.manage`) and quick-created a partner supplier via
  `POST /suppliers` (also `suppliers.manage`) — EDITOR held neither
  permission, so both calls 403'd and the required Supplier field could
  never be filled in, even though the section itself was visible. Fixed by:
  granting EDITOR `suppliers.view`; switching `ProductForm.jsx` to the
  lightweight `GET /suppliers/selection` endpoint (view-gated, and now
  includes `supplierType` in its projection so the PARTNER-only dropdown
  filter actually filters); and narrowing `POST /suppliers` to accept
  `suppliers.view`-only callers for a minimal `supplierType: "PARTNER"`
  record only (name required; email/phone optional; no
  address/bankDetails/taxInfo/paymentTerms/non-default status — those
  still 403 without `suppliers.manage`). Also benefits WAREHOUSE and an HQ
  Manager, who held the same `suppliers.view`-only gap. See §10.
- **Product creation no longer hard-blocks on missing pricing** —
  `ProductForm.jsx`'s client-side `validateForm()` treated "no BTC/2-week/
  5-week price set" as a blocking error, refusing to submit at all. The
  server already force-saves such a product as `DRAFT`
  (`isProductPurchasable`/`effectivePublish` in `product.controller.js`,
  unchanged) — the client-side check just duplicated that as a dead end
  instead of letting it work, blocking an Editor from saving progress on a
  product mid-setup (e.g. everything filled in except pricing, added later
  by Accounting). Removed the block; the amber "will be hidden from shop"
  warning still explains the consequence, submission now always proceeds.
- **Subcategories created via SubCategoryManagement.jsx weren't showing up
  in ProductForm.jsx** — `categoryService.js`'s 5-minute client cache was
  invalidated on category create/update/delete (`CategoryManagement.jsx`
  calls `clearCategoryCache()`) but not on the equivalent subcategory
  actions. Added the same `clearCategoryCache()` calls to
  `SubCategoryManagement.jsx`'s create/update/delete handlers. See §10.
- **Base64-image-paste bug found & fixed** — the OpenAI translation
  failures ("input exceeds the context window") on two blog posts traced
  to pasted/dropped images being embedded as base64 directly in the post's
  `content` HTML instead of uploaded to Cloudinary, ballooning it to
  millions of characters. Fixed the editor at the source (paste/drop now
  auto-uploads, matching the toolbar button's existing behavior) and added
  `scripts/findOversizedContent.js` to find any other affected records
  across every entity type. See §8.
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
- **Multi-language expansion + display-priority fix** — added
  `GLOBAL_EXTRA_LANGUAGES` (es/pt/nl/ar/hi/zh) as site-wide languages
  independent of any country's config, plus RTL support for Arabic and a
  header language switcher covering all of them (see §8/§8a for the full
  translation-system writeup). Also fixed a real bug across all three
  client price-display call sites (`CardProduct.jsx`,
  `ProductDisplayPage.jsx`, `Search.jsx`): every one of them showed *every*
  price option that had a value set — a product with both stock and a
  configured delivery price showed a "Standard delivery" box **and** a
  "Special order" box side by side. Now exactly one is ever shown, per the
  priority order formalized in `PRODUCT_VISIBILITY_RULES.md` §3a. Also
  made `scripts/bulkTranslateContent.js` fully dynamic (every entity type
  in `TRANSLATABLE_FIELDS`, not just product/blog) and resumable by
  default (`skipExisting` — a re-run only retries what's still missing,
  instead of re-translating and re-billing everything from scratch), and
  added `scripts/translateUiLocales.js` to machine-translate the hardcoded
  admin/client UI copy the same way.
- **Item #9** — Accountant/Warehouse/Editor confirmed as permanently
  HQ-only (no country/"foreign" accounts); centralized via
  `HQ_ONLY_SUBROLES` in `config/roles.js`; self-healing added at login,
  user-update, and request-scoping layers. HQ Manager granted pricing
  rights (product form + Direct Pricing creation), scoped to `scope ===
  "GLOBAL"` only. Direct Pricing no longer locks the product-form price
  fields for pricing owners — edits sync both ways instead of one
  overwriting the other.
