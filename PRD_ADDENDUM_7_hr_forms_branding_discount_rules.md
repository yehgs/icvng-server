# PRD Addendum 7 — HR forms, multiple logos/signatures, per-price discounts

Date: 2026-11-13 · Scope: server, admin (client/mobile unchanged except where noted)

## 1. Blank staff information form (HR)
- `GET /api/hr/forms/staff-form?logoId=&countryCode=` (permission `hr.view`) returns a printable A4 PDF: personal details with passport-photo box, emergency contact, employment (HR section), bank and statutory details, optional health information, documents checklist, declaration with signature and date, "HR office use" box.
- `POST /api/hr/forms/staff-form/send {to, logoId, countryCode}` (`hr.manage`) e-mails the same PDF (en/fr/it wording per country). Audited as `HR_FORM_EMAIL`.
- The chosen logo is embedded; no logo configured means the form is produced without one.

## 2. Staff details export (password re-entry)
- `POST /api/hr/staff/:id/export {password, logoId, signatureId, includeSensitive}` (`hr.manage`).
- The caller must re-enter **their own** password (bcrypt check on the server). Wrong password: 403 and an audit entry (`HR_EXPORT_DENIED`). Five wrong attempts lock that account for 15 minutes (429 with `Retry-After`; in-memory per server process). A correct password resets the counter. Accounts without a password get a 400.
- Default export masks the bank account and omits salary, tax ID and health notes. `includeSensitive: true` adds them and is recorded in the audit entry (`HR_STAFF_EXPORT`, "including sensitive data").
- Country scope: HR users only reach staff in their own country (404 otherwise); IT and Director are global. Response is `Cache-Control: no-store`.
- Limitation: the throttle is held in memory, so with several server instances each keeps its own counter.

## 3. Multiple logos and signatures
- HR settings now keep up to 10 logos and 10 signatures per country (name, image, default flag; signatures also carry signer name and title). Exactly one default each. The legacy single `logoUrl/signatureUrl/signerName/signerTitle` fields mirror the defaults, and a legacy single logo shows up as one default entry.
- Selectable on: payroll creation, a draft payroll (`PUT /payroll/:id/branding`), payroll approval (`signatureId`), the blank form and the staff export. An unknown id is a 400. After approval the payroll's logo and signature are frozen.
- Images must be https PNG/JPG, at most 2 MB, as before.

## 4. Discount rules: per-price discounts and input help
- A rule can now discount the **regular price**, the **3-week delivery price** and the **5-week delivery price** separately, each with its own type (percentage or fixed amount), value and optional cap (`applyToRegular`, `deliveryDiscounts.threeWeeks/fiveWeeks`). At least one price must be enabled.
- The pricing engine picks the discount spec per price option; no stacking (best single rule) is unchanged. Rules saved before this change keep working (`includeSpecialOrder` is honoured as "same discount on the delivery prices").
- The Add-rule form is now split into Basics, Prices and discounts, Who it applies to, and Timing, with a hint under every input (value, minimum quantity, maximum discount per unit, rule priority, dates) and a live worked example.
- Strings are in en, fr and it.

## Also fixed
- Activity-log enum gaps: `SOCIAL_*` actions and the `SocialPage` resource type were rejected silently; now recorded.

## Tests
`hr_docs_int` (18 groups), `campaign_pricing_unit` (38), `campaign_rule_validation_unit` (6); `hr_int`, campaign, marketing, social and SEO suites pass.
