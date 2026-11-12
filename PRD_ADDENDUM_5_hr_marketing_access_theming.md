# PRD Addendum 5 — Seasonal-campaign access & theming, Email Marketing, HR module

**Status:** implemented. No change to the shared package (`@yehgs/icvng-core` stays 0.10.0).
This file is identical in `server/`, `admin/` and `client/`; the mobile app records its part in
`mobile/MANIFEST.md` and `mobile/BACKLOG.md`.
Related: Addendum 4 (seasonal campaigns), `config/permissions.js`, `config/roles.js`, `utils/featureScope.js`.

---

## 1. Country scope (applies to everything below)

`utils/featureScope.js` is the single rule: **IT and DIRECTOR are global**; a COUNTRY-scoped admin sees only their
`assignedCountry`; any other admin (including an unscoped Manager/Accountant/Editor/Sales/HR) is **Nigeria (HQ) only**.
Reads or writes outside the caller's territory return **404** (the record "does not exist" for them); a tampered
`countryCode` on create returns **403**. Countries: NG, TG, BJ, IT. Languages: en, fr, it.

ACCOUNTANT and EDITOR are no longer `hqOnly`: they are **opt-in country-assignable** (Create-user and Foreign-admin
screens now show the Country Admin toggle for them). A global (HQ) Accountant/Editor is therefore Nigeria-only for
campaign/discount features, exactly like any unscoped admin. WAREHOUSE, IT and DIRECTOR remain HQ-only.

## 2. Seasonal campaigns — access fixes

| Item | Change |
|---|---|
| Manager could not see the menu | The sidebar item now sits at the **top level, always visible**, gated by the `campaigns.view` permission (capability-aware) instead of a sub-role list inside the collapsed "content" group. A `PermissionRoute` guard on the route shows an explicit "Access denied" page rather than a blank screen. |
| Manager CRUD | Manager holds `campaigns.view/manage/publish`, country-scoped (full lifecycle in own country, 404 elsewhere). |
| Accountant | New permission **`campaigns.discounts`**: add/edit/pause/remove **discount rules only** (Discounts tab) for campaigns in their own country. The editor opens in `discountsOnly` mode (other tabs read-only, notice shown); the server enforces it independently of the UI. |
| Editor / Sales | Unchanged semantics (Editor: draft content/rules; Sales: view only) but now country-scoped through the same rule. |

Tests: `tests/campaign_roles_int.mjs` (8 groups: manager lifecycle, accountant discounts-only incl. forbidden edits,
editor/sales limits, cross-country 404/403, IT global).

**Honest note:** the Manager sidebar symptom could not be reproduced from code alone. The most likely causes were the
collapsed menu group (item absent from the initial `openMenus` state) and sub-role-only gating; both are removed by
the top-level, permission-driven item. If it still reproduces, check that the user's `subRole` is `MANAGER` and that
`/api/capabilities` returns `campaigns.view` for them.

## 3. Campaign theme reaches the whole storefront and app

Previously only the campaign landing page used the palette. Now:

**Web (`client`)**
- `tailwind.config.js` brand colours (`primary-200/100`, `secondary-200/100`, `background-100`, `accent-100`) read
  `rgb(var(--brand-… , <original RGB>) / <alpha-value>)`. With no campaign the fallbacks equal the old hex values, so
  nothing changes (verified in the built CSS; opacity modifiers like `bg-primary-200/50` still work).
- `src/utils/campaignTheme.js` derives the six tokens from the 9 validated campaign colours **with contrast
  guarantees**: headings/text ≥ 7:1 on white and on the page background, buttons ≥ 3:1 against white text, CTA accent
  ≥ 4.5:1. Dark palettes (Black Friday) colour accents, headings, buttons, announcement bar and hero bands, while the page
  body uses a light tint of the palette — product, cart and checkout surfaces are white in ~100 components and must stay
  readable. (Tested with Black Friday, Christmas and a deliberately hostile palette.)
- `CampaignShell` publishes `--campaign-*` and `--brand-*` on `<html>` (and tints `meta[name=theme-color]`), removing
  them all when the campaign ends/pauses. Because every page uses the brand tokens, the theme now covers home, shop,
  product, cart, checkout, orders and account. The checkout pay button opts in via `.cta-primary`.

**Mobile (`mobile`)**
- `src/theme/useBrand.js` + `src/utils/campaignTheme.js` (same derivation). `recolor()` re-maps literal colours inside a
  screen's StyleSheet. Themed: Home, Shop, Product detail, Cart, Checkout, Order success, bottom-tab tint, and the
  shared `Button` (`primary` and `blue` variants). The `green` variant stays the Add-to-Cart colour by the DESIGN.md rule.

Not themed (by design): semantic colours (stock/delivery/error/success), product images, and the seasonal effect stays
off on checkout.

## 4. Email Marketing (new)

**Who:** `marketing.view/manage/send` — IT and DIRECTOR (global), Manager, Sales and Editor (country-scoped).

**Audience:** every customer in the campaign's country, de-duplicated by email across Users, Customers and newsletter
Subscribers; optional filters (sources, B2C/B2B, verified emails only). Anyone on the **suppression list** (unsubscribed or
hard-bounced) is excluded and counted. Capped by `MARKETING_MAX_RECIPIENTS`.

**Template:** one common e-commerce template (header image, headline, message, up to 6 featured-product cards, CTA
button, footer, unsubscribe) rendered in en/fr/it; admin text is escaped, images and links must be https/internal.

**Sending:** claim-based and resumable. The admin page drives `POST /api/marketing/admin/:id/process-batch` in a loop
(Cloud Run throttles CPU after a response, so there is no hidden background worker; `MARKETING_BACKGROUND_SEND` exists for
an always-on host). Send via Resend over HTTP with SMTP fallback. Tunables: `MARKETING_BATCH_SIZE`,
`MARKETING_SEND_CONCURRENCY`, `MARKETING_SEND_DELAY_MS`.

**Compliance:** every email carries a signed (HMAC, `MARKETING_UNSUBSCRIBE_SECRET`) one-click unsubscribe link (GET + POST
`/api/marketing/unsubscribe`, `List-Unsubscribe` headers); forged or other-country links are refused.

**Endpoints** (`/api/marketing/admin/…`): `meta`, `list`, `audience/count`, `preview`, `create`, `:id` (GET/PUT/DELETE),
`:id/preview`, `:id/recipients`, `:id/duplicate`, `:id/test` (marked `[TEST]`, not counted), `:id/send`,
`:id/process-batch`, `:id/cancel`. Sent campaigns are locked.
Models: `marketing-email`, `marketing-recipient`, `marketing-suppression`. Tests: `tests/marketing_int.mjs` (7 groups).

## 5. HR module (new)

**Access:** `hr.view/manage/payroll` — **IT, DIRECTOR and HR only**, HR country-scoped. Staff records are fetched and
searched only by these roles. Admin menu: *HR* (full module) and *My Attendance* (any admin that has an HR record).

**Models** (`models/hr/`): staff, office, attendance, leave, appraisal, payroll, holiday, settings, counter.
Employee ids are `ICV-<CC>-0001` from an atomic counter.

**Staff record:** photo, date of birth, gender, marital status, nationality, contact, address, emergency contact, **health
status** (+ blood group, genotype, notes), employment (title, department, type, **work mode**, status, dates, office),
salary (base, allowances, recurring deductions), **bank details**, tax/pension ids, leave entitlement. Soft-delete =
`TERMINATED`. Linked to an admin user optionally.
- **Encrypted at rest (AES-256-GCM, `PAYMENT_SECRETS_KEY`):** bank account number, tax id, health notes. They are never in
  list/detail responses; only `GET /api/hr/staff/:id/sensitive` (hr.manage) decrypts, and every view is audit-logged
  (`HR_SENSITIVE_VIEW`). In forms they are write-only: blank = keep stored value.
- **User Management:** *Create user* shows an optional "Add HR details with this account" section (same form) for admins
  holding `hr.manage`; the HR payload is validated **before** the account is created, and the HR record is created in the
  creator's country. If the HR step fails after the account exists, the response carries `staffError` and the UI says
  to finish it in the HR module.

**Attendance & work modes:** FULL_TIME (office only), HYBRID (office or remote), REMOTE (remote only).
`POST /api/hr/me/attendance/check-in` with `{type:"OFFICE", lat, lng, accuracy, officeId?}`:
the browser **prompts for location permission**, the server computes distance to the office geofence (haversine),
reverse-geocodes the address (Nominatim, best effort; `HR_REVERSE_GEOCODE=off` disables, `HR_GEOCODE_TIMEOUT_MS`),
flags `OUTSIDE_GEOFENCE` / `LOW_ACCURACY`, **refuses** out-of-range check-ins when the office has `enforceGeofence`, and
e-mails the office's **assigned notification addresses** (en/fr/it). One record per staff per local day; holidays and
approved leave block check-in; HR can add manual entries. HR creates offices with lat/lng, radius and notify emails, and a
"Use my current location" button (browser geolocation prompt) fills coordinates.

**Leave:** working days = Mon–Fri minus holidays; annual balance (`?year=`); approve/reject emails.
**Appraisals:** weighted goals + competencies → score; locked once submitted; staff acknowledge.

**Payroll:** one run per country and month; DRAFT → APPROVED (signed) → PAID.
- Money is integer minor units. `gross = base + allowances + bonus + overtime − unpaidLeaveDeduction`; percent deductions are
  of base or gross; `net = max(0, gross − deductions − otherDeductions)`. Per-line adjustments (bonus, overtime, other) in draft.
- **Preview & download** the register PDF (company **logo**, staff names, **bank details**, **signature** and signer),
  and a payslip PDF per staff. The JSON API masks account numbers; the register PDF carries full numbers for the bank
  run; the emailed payslip is masked.
- **Approve** requires the uploaded signature and signer name in payroll settings and bank details for every line (unless
  `allowMissingBank`). **Send** emails each payslip and a summary to the payroll notify addresses.
- Logo/signature are fetched over https only with an SSRF guard and a 2 MB limit. Images are set in HR → Settings.

**Tests:** `tests/hr_int.mjs` (17 groups: access, scope, encryption/audit, user-management creation, offices, geofence
check-in + email, leave, appraisals, payroll maths, approve/send/paid, dashboard).

## 6. Translation (fr / it)

Admin strings live in `admin/src/i18n/modules/{en,fr,it}.js`, merged by `i18n/index.js` (no edits to the large locale
files; other languages fall back to English). Covered: nav items, access-denied page, discounts-only notice, all
`marketing.*` and `hr.*` keys (staff form, attendance, leave, appraisals, payroll, settings, My Attendance). Server emails
(attendance notices, payslips, leave decisions, marketing template) are fr/it/en by the country's language. The storefront
and app added **no new strings** (theming only). A script check confirmed every key used by the new screens exists in
all three languages. es/pt/nl/ar/hi/zh for these modules are a follow-up.

## 7. Known limitations / follow-ups

- Reverse geocoding depends on Nominatim (public, rate-limited); failure just omits the address.
- PDF logo/signature embedding needs outbound https to the image host; it was not verifiable in the offline test sandbox
  (PDF text, layout and account masking are tested; the https-only/SSRF/size guard on image fetch is in code but its live fetch path was not exercised).
- Dark-palette campaigns keep a light page body on web/mobile (readability over drama); a full dark mode is a separate project.
- Mobile theming was syntax-checked and unit-tested for the derivation only; it has **not** been run on a device.
- Customer model has a latent sparse unique index on `userId`; marketing de-duplication does not rely on it.
- Marketing sending requires the admin tab to stay open (resumable if closed).
- Follow-ups: PDF payslip languages beyond what the email uses; attendance geolocation spoofing is flagged only by
  accuracy/geofence, not detected; HR docs upload (contracts) not included.
