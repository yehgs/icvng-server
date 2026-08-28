# PRD ADDENDUM — Order country-scoping, notifications & payment integrity

**Date:** 2026-08-28
**Applies to:** `icvng-server`, `icvng-admin`, `icvng-client`
**Merge into:** `PRD.md` — new §9a and §9b before §10, plus the §12 change-log
entry and the §11 roadmap edits at the end of this file.

---

## 9a. Order lifecycle — country scoping

### 9a.1 Country of record

Every order carries a `countryCode`, and it is decided **once, at checkout
initiation**, from the storefront the customer is actually on. It is never
re-derived later.

This matters because the two systems that *confirm* payment — the Paystack
webhook and the Stripe webhook — are called by the payment provider's servers,
not by the customer's browser. Neither carries the `X-Storefront-Host` header
that `countryDetect` relies on, and `req.headers.host` is our own API host. If
country were resolved at confirmation time, every gateway-confirmed order would
silently be stamped `NG` (the `DEFAULT_COUNTRY` fallback) regardless of which
market it came from.

So the country is snapshotted into gateway metadata at initiation and read back
at confirmation:

| Path | Stamped at | Read back at |
|---|---|---|
| Stripe | `stripePaymentController` → `session.metadata.countryCode` | `webhookStripe` |
| Paystack | `paystackPaymentController` → `metadata.countryCode` | `createOrderFromPaystackTransaction` |
| Bank transfer | `DirectBankTransferOrderController` (browser request, host known) | n/a — created inline |
| Admin/manual | `createAdminOrderController` (admin's own scope) | n/a |

Precedence inside `createOrderFromPaystackTransaction` is:
`metadata.countryCode` → `req.countryCode` → `"NG"`.
Metadata wins deliberately; the request context is the untrustworthy source
here, not the fallback.

### 9a.2 Who sees which orders

Order visibility is **stricter than the general `scope` model**. Elsewhere,
`HQ_ONLY_SUBROLES` default to GLOBAL scope. For orders, only two subRoles get
cross-country visibility:

| Audience | Sees |
|---|---|
| `IT`, `DIRECTOR` | **All orders, every country.** May narrow to one country with `?countryCode=XX` |
| COUNTRY-scoped admin (e.g. Togo Manager) | Only `countryCode === assignedCountry` |
| Every other HQ subRole (`MANAGER`, `SALES`, `ACCOUNTANT`, `LOGISTICS`, `WAREHOUSE`, …) | Nigeria (`NG`) only |
| `SALES` | As above, plus: manual orders they created, and all website orders |

Enforced in `getAllOrdersController` and mirrored in
`updateOrderStatusController`, which 403s any attempt to mutate an order
outside the caller's country. `countryScopedPlugin` on the Order model is the
backstop underneath both.

`?countryCode=XX` is validated against `ALL_COUNTRY_CODES` and is a **no-op for
non-global roles** — a stale value in a country admin's UI state can never
widen their visibility.

### 9a.3 Cross-country admin UI

For `IT`/`DIRECTOR` only, `WebsiteOrderManagement.jsx` renders
`OrderCountryFilter.jsx`:

- a country selector labelled with **country name + storefront domain**
  ("Nigeria — i-coffee.ng"), not a bare ISO code;
- clickable per-country count chips, driven by `countryBreakdown` on the list
  response — computed server-side over the **whole filtered result set**, not
  the current page, so the counts stay meaningful under pagination;
- a per-row country cell showing the **domain**, since that is what actually
  distinguishes `i-coffee.ng` from `i-coffee.it` at a glance.

The component self-hides for every other role, so no call site needs a
conditional.

### 9a.4 Tracking

`ShippingTrackingModel` carries `countryScopedPlugin`, so authenticated
logistics routes are scoped automatically and `IT`/`DIRECTOR` can narrow via
`?countryCode=XX`.

**The public lookup is the exception that needed explicit handling.**
`GET /api/shipping/track/:trackingNumber` has no auth, so the plugin's hooks
never fire — they only engage when the request context carries a
`countryScope`, which is null for anonymous traffic. Without an explicit
filter, a visitor on `i-coffee.it` could read a Nigerian shipment's status,
delivery address and carrier by knowing or guessing a tracking number.

`getTrackingByNumber` now compares `tracking.countryCode` against
`req.countryCode` (from the storefront's `X-Storefront-Host`) and returns a
**404 identical to the genuine not-found response** on mismatch — so the
endpoint cannot be used to probe which country a tracking number belongs to.

---

## 9b. Customer notifications — country & language scoped

### 9b.1 The rule

> A customer notification is branded, localized and denominated from the
> **order's** `countryCode` — never the acting admin's country, never
> `req.countryCode`, never the API host.

An `IT`/`DIRECTOR` in Lagos marking a Togo order as `SHIPPED` sends the
customer a **French, Togo-branded, XOF-denominated** email. This is enforced by
routing every send through `resolveEmailCountry(order.countryCode)` in
`utils/countryEmailTemplates.js`.

Language follows the country's default: `NG → en`, `TG → fr`, `BJ → fr`,
`IT → it`, with English fallback for any key missing from a language block.

### 9b.2 Trigger matrix

| Trigger | Origin | Template |
|---|---|---|
| Paystack charge confirmed | webhook **and** verify-on-redirect | `orderConfirmationEmail` + `paymentStatusEmail(PAID)` |
| Stripe session completed | webhook | `orderConfirmationEmail` + `paymentStatusEmail(PAID)` |
| Bank-transfer order placed | client request | `orderConfirmationEmail` + `paymentStatusEmail(PENDING_BANK_TRANSFER)` |
| `payment_status` changed by admin | `updateOrderStatusController` | `paymentStatusEmail(newStatus)` |
| `order_status` changed by admin | `updateOrderStatusController` | `orderStatusEmail(newStatus)` |
| Tracking status changed | `updateTracking` | `deliveryStatusEmail` |

Two guarantees:

- **Transition-only.** Admin-driven sends compare against the pre-update
  values, so re-saving the same status (common when editing notes) does not
  re-notify the customer.
- **Never fatal.** Every send is wrapped. A mail failure cannot roll back or
  500 a payment that has already been captured, or a status update that has
  already been persisted.

### 9b.3 Template inventory

`utils/countryEmailTemplates.js` — all localized, all country-branded:
`verificationEmail`, `passwordResetEmail`, `welcomeEmail`,
`orderConfirmationEmail`, `paymentStatusEmail` *(new)*, `orderStatusEmail`
*(new)*, `deliveryStatusEmail` *(new)*, `shippingNotificationEmail`
*(alias of `deliveryStatusEmail`, kept so the existing shipping controller
call site is unchanged)*. Subjects are localized via `subjectFor()`.

---

## §12 Change log — new entry (add at the top)

- **Website orders were never being created from Paystack payments at all —
  root-caused and fixed, plus the country-scoping and notification gaps it
  exposed.** A live NGN 51,182.45 charge on `i-coffee.ng`
  (`PSK-1787910602350-6a9144dbaa567b1ecde5a3ea`) was confirmed by Paystack but
  produced no order, in the customer's list or the admin's.

  *Root cause:* `order.controller.js` used `ProductModel` on the cart-snapshot
  path without importing it. Because `paystackPaymentController` stamps
  `cartItemsJSON` into metadata on **every** checkout, that path was always
  taken, so every Paystack order threw `ReferenceError: ProductModel is not
  defined` before a single Order document was written. The webhook caught it,
  logged it, and returned `200` — so Paystack marked the hook delivered and
  never retried; the verify endpoint caught it and returned `500`, which is the
  "Verification Error" screen the customer saw. **This was not a scoping bug —
  there was no document to scope.** Every NGN Paystack order since
  `cartItemsJSON` was introduced failed identically; reconcile Paystack's
  successful-transaction export against the `orders` collection.

  *Fixes shipped alongside:*
  - `models/payment-failure.model.js` — country-scoped audit collection. A
    gateway-confirmed payment that fails to produce an order is now persisted
    with its reference, metadata and error, instead of vanishing into a
    `console.error` on a serverless host. Upserts on reference so webhook
    retries bump `attempts` rather than duplicating. Open rows are a P1.
  - `scripts/recoverOrphanPaystackOrders.js` — replays orphaned successful
    charges into real orders. Idempotent, `--dry-run` first, `--no-email` for
    charges old enough that a sudden confirmation would confuse the customer.
  - Paystack metadata now carries `countryCode`/`currencyCode`, closing the
    same country-misattribution hole the Stripe path had already fixed (§9a.1).
  - Customer emails on payment/order status change — which **did not exist at
    all** before this (§9b). `updateOrderStatusController` wrote the status and
    returned.
  - `countryEmailTemplates.js` rewritten: per-language string table, order
    currency instead of hardcoded NGN, and two silent template bugs fixed —
    it read `order.paymentStatus`/`order.deliveryAddress`, but the model fields
    are `payment_status`/`delivery_address`, so the payment badge always said
    "Awaiting payment" and the address block never rendered on any order.
  - Public tracking lookup country-scoped (§9a.4); the stale comment in
    `shipping.route.js` claiming the tracking model lacked the plugin was
    corrected — it has carried it since `shipping-tracking.model.js:372`.
  - `PaystackCallbackPage.jsx` — was 100% hardcoded English with a literal `₦`
    and a hardcoded `customercare@i-coffee.ng`. Now fully `t()`-driven against
    a new `paystackCallback` namespace (so it is editable from
    `UiTranslationsManagement.jsx` like everything else), with country-aware
    currency formatting and a country-derived support address.

## §11 Open items — updates

**Remove** (now done):
- tracking country-scoping as a "not-yet-built phase" — shipped.

**Add:**
- Surface unresolved `PaymentFailure` rows on the admin dashboard with an
  alert badge; treat non-zero as P1. The collection exists and is written to,
  but nothing reads it in the UI yet.
- Add a synthetic checkout smoke test to CI that runs a Paystack test-mode
  charge end-to-end and asserts an Order document exists. The whole incident
  would have been caught in minutes by a test that asserted "order count
  increased by one".
- Audit the remaining ~110 client components/pages still missing
  `useTranslation` (see `NEW_UI_TRANSLATION_KEYS.js` header). `MyOrders.jsx`,
  `GuestCheckoutPage.jsx`, `BankTransferInstructionPage.jsx` and
  `PaymentCancelPage.tsx` are the highest-value next targets — all sit in the
  order/payment path a non-English customer walks through.
- `getOrderGroupController` compares `firstOrder.userId?.toString() !== userId`
  for ownership but does not check `countryCode`; harmless today since
  ownership is the tighter constraint, but worth aligning.
