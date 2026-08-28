# PRD ADDENDUM 2 — Payment gateway matrix & manual order system

**Date:** 2026-08-28
**Merge into:** `PRD.md` — new §9c and §9d; change-log entry at the end.

---

## 9c. Payment gateway availability

### 9c.1 The matrix

| Country | Paystack | Stripe | Bank transfer | Future local gateway |
|---|---|---|---|---|
| Nigeria (NG) | ✅ | ✅ | ✅ | — |
| Togo (TG) | ❌ | ✅ | per config | planned |
| Benin (BJ) | ❌ | ✅ | per config | planned |
| Italy (IT) | ❌ | ✅ | per config | planned |

Read this as: **Paystack is Nigeria-only. Stripe serves every market,
Nigeria included** — Stripe is how a Nigerian customer pays in a foreign
currency, so NG deliberately has both.

### 9c.2 Declared *and* enforced

`COUNTRY_CONFIG` has always declared `payments: { paystack, stripe }` per
country, and `isPaymentProviderEnabled()` has always existed to read it — but
it **had zero call sites**. The rule was documentation, not behaviour: a
crafted request could open a Paystack session against the Togo storefront.
Only an incidental `currency !== "NGN"` check stood in the way, which is a
currency guard, not a country guard.

Both `paystackPaymentController` and `stripePaymentController` now call it
before doing anything else and return a clear 400 naming the country.

Stripe is guarded too even though it is enabled everywhere today. That is
deliberate: when a country-local gateway ships and Stripe is switched off for
that market, flipping `stripe: false` in config must be genuinely sufficient.
A guard added only where it currently fails would leave a live endpoint behind.

### 9c.3 Adding the local gateway later

The extension points are already in place:

1. Add the provider key to `payments` in `config/countries/index.js`.
2. `isPaymentProviderEnabled(code, "yourGateway")` needs no change.
3. Follow the Stripe pattern for country stamping — snapshot `countryCode`
   into gateway metadata at **initiation** and read it back at confirmation
   (§9a.1). Do not resolve country in the webhook; provider callbacks carry no
   storefront host.
4. Record failures via `PaymentFailureModel.record({ provider: "YOURGATEWAY" })`
   and add the key to that model's `provider` enum.
5. Emails need nothing new — `paymentStatusEmail` is gateway-agnostic.

---

## 9d. Manual (offline) order system

### 9d.1 BTC only

As of 2026-08-28 manual orders are **business-to-customer only**. BTB pricing
and BTB stock paths are retired.

- `orderType` is forced to `"BTC"`. A request sending `"BTB"` gets a **400
  with an explanatory message**, not a silent coercion — a stale admin build
  must not quietly write BTC-priced orders that the agent believes are BTB.
- `btbPrice` remains on the product schema for historical orders and
  reporting. **Nothing may price a new order from it.**
- Customers are created as BTC.

### 9d.2 Who can create manual orders

| subRole | Can create | Country reach |
|---|---|---|
| `IT`, `DIRECTOR` | ✅ | **All countries.** Pick the order's country explicitly |
| `MANAGER` | ✅ | Own country only |
| `SALES` | ✅ | Own country only, and only for customers they manage or website customers |
| everyone else | ❌ | — |

**Bug this fixes:** the guard read
`if (user.role !== "ADMIN" || user.subRole !== "SALES") return 403`, so **IT,
DIRECTOR and MANAGER were locked out of manual order creation entirely** — and
the `["IT","MANAGER","DIRECTOR"]` customer-ownership exemption 40 lines below
was unreachable dead code, because those roles could never reach it.

### 9d.3 Country of record

`orderCountryCode` is resolved once, up front:

- **IT/DIRECTOR** — from `body.countryCode`, validated against
  `ALL_COUNTRY_CODES`, falling back to the detected country.
- **SALES/MANAGER** — pinned to `request.countryScope`. Anything they send in
  the body is **ignored, not merged**.

**Bug this fixes:** country was previously decided as
`request.countryScope || request.countryCode || "NG"`. IT/DIRECTOR are GLOBAL,
so `countryScope` is null for them and it fell through to the detected
country — which on the admin panel is always the admin host, i.e. NG. **A
director could not raise a Togo manual order at all**; every order they created
was stamped Nigeria.

Consequences of the country now being correct:

- **Currency** follows it (`getCountryByCode(...).currency.code`). It was
  hardcoded `"NGN"`, so every non-NG manual order was denominated wrongly on
  the order record, the invoice, and the customer email.
- **Customer must match.** An order cannot be raised for a customer in another
  country — that record would be inconsistently visible to both countries'
  staff and would email the customer branded for the wrong market.
- **Products must match.** A product carrying another country's `countryCode`
  is rejected. Legacy products with no `countryCode` pass, matching
  `countryScopedPlugin`'s own legacy fallback.

### 9d.4 Storefront parity — stock & purchasability

Manual orders now apply the **same canonical §3 rule as the storefront**, via
shared helpers rather than local copies:

- server — `utils/manualOrderValidation.js`
- admin — `src/config/manualOrderRules.js`

`PRODUCT_VISIBILITY_RULES.md` §7 warns explicitly against inlining this rule.
The manual order path had done it twice, and both copies had drifted:

1. **Server** read stock as
   `warehouseStock.enabled ? warehouseStock.offlineStock : stock`, ignoring
   `partnerStock` entirely. Partner-supplied stock read as **zero**, so agents
   were blocked from selling stock the storefront was actively selling.
2. **Admin `ProductSearchModal`** accepted "has dropship prices" generically,
   ignoring the five-week-type distinction. A MACHINE priced only on
   `price3weeksDelivery` — which the storefront correctly refuses — looked
   addable, so an agent could take an order the site would not have accepted.

Two further corrections fall out of using the shared rule:

- **Stock pool.** Validation and decrement now both use **online** stock
  (`partnerStock → warehouseStock.onlineStock → legacy stock`). The old code
  validated *and* decremented `offlineStock` — self-consistent, but measuring
  a different pool from the storefront, so a manual sale never reduced what
  the website could sell.
- **Special orders don't consume stock.** 2-week/5-week lines are
  supplier-sourced. They are exempt from the stock check and **no longer
  decrement local stock**, which previously drained inventory that was never
  reserved.

### 9d.5 Customers

- **Creation.** `countryCode` was `request.countryScope || 'NG'` — so
  IT/DIRECTOR, being GLOBAL, stamped **every** customer they created as
  Nigeria. A director could not create a Togo or Italian customer. Global
  admins now name the country explicitly (validated); country-scoped roles stay
  pinned.
- **Listing.** Country-scoped roles see only their own country. IT/DIRECTOR are
  unrestricted but may narrow with `?countryCode=XX`, which is what backs the
  country selector when they pick a customer for a manual order.

### 9d.6 Sales agent attribution

Manual orders now carry a `salesAgent` **snapshot** alongside `createdBy`:

```js
salesAgent: { userId, name, email, subRole, countryCode, recordedAt }
```

`createdBy` is a live ref — populate it and you get whatever that user looks
like *today*. For commission, attribution and audit we need who made the sale
**at the time**: an agent who later changes subRole, moves country, or leaves
must not rewrite history.

---

## §12 Change log — new entry

- **Payment gateway matrix enforced; manual order system made BTC-only and
  properly country-scoped.**
  - `isPaymentProviderEnabled()` existed with **zero call sites** — Paystack's
    Nigeria-only rule was declared in config but never enforced. Now checked in
    both payment controllers (§9c).
  - Manual order role guard admitted **only SALES**, locking IT, DIRECTOR and
    MANAGER out of order creation and rendering the ownership exemption below
    it dead code.
  - Manual order country resolution fell through to the admin host for GLOBAL
    roles, so **every order a director created was stamped Nigeria** and
    denominated NGN regardless of market.
  - Manual order stock validation ignored `partnerStock` and read the offline
    pool, disagreeing with the storefront in both directions; the admin's
    product search carried a second, differently-drifted copy of the rule. Both
    now call shared helpers (§9d.4).
  - Special-order (2/5-week) lines no longer decrement local stock.
  - BTB retired from manual ordering; `orderType: "BTB"` now 400s explicitly.
  - `salesAgent` snapshot added to the Order model (§9d.6).
  - Customer creation stamped every IT/DIRECTOR-created customer as NG;
    customer listing gained `?countryCode=` for global roles.
  - `manualOrders.*` locale namespace added (admin en/fr/it) and the remaining
    hardcoded strings on `OfflineOrderManagement.jsx` and
    `ProductSearchModal.jsx` routed through `t()`.

## §11 Open items — add

- **`CreateOrderModal.jsx` (1,152 lines) still carries BTB branches** and has
  no country selector or inline BTC customer creation. The server rejects BTB
  and enforces country, so the system is *safe*, but the modal still offers a
  BTB toggle that will now 400. **This is the highest-priority follow-up.**
- `OrderDetailsModal.jsx`, `OrderTable.jsx`, `OrderFilters.jsx`,
  `invoiceTemplate.js` and `pricecCalculation.js` all still reference
  `btbPrice`/BTB. Harmless for reads of historical orders; needs a sweep.
- Invoice generation and manual customer notification are not yet exposed to
  IT/DIRECTOR as cross-country actions in the UI (the server permits them).
- Customer-facing country selector for IT/DIRECTOR when choosing a customer is
  specified and server-supported, but not yet built into the modal.
