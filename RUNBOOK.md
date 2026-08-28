# Fix runbook — deploy order, verification, recovery

## The one-line summary

Paystack orders were never created. `order.controller.js` called
`ProductModel.find()` without importing `ProductModel`, on a code path taken by
**every** checkout. The error was caught and logged in both handlers, so the
charge succeeded at the gateway and nothing existed anywhere else.

---

## 1. Files changed

### Server (`icvng-server`)

| File | Change |
|---|---|
| `controllers/order.controller.js` | **The fix.** Missing `ProductModel` import; country from metadata; confirmation + payment emails on all three payment paths; failure recording |
| `controllers/admin-order.controller.js` | `?countryCode=` filter for IT/DIRECTOR; `countryBreakdown` in the response; payment/order status emails on transition |
| `controllers/shipping.controller.js` | Public `getTrackingByNumber` scoped to storefront country |
| `utils/countryEmailTemplates.js` | Rewritten — per-language strings, order currency, 3 new templates, 2 field-name bugs fixed |
| `models/payment-failure.model.js` | **New** — orphaned-payment audit trail |
| `scripts/recoverOrphanPaystackOrders.js` | **New** — replay orphaned charges |
| `route/shipping.route.js` | Corrected stale comment |

### Admin (`icvng-admin`)

| File | Change |
|---|---|
| `src/components/order/OrderCountryFilter.jsx` | **New** — country selector + breakdown chips, IT/DIRECTOR only |
| `src/pages/order/WebsiteOrderManagement.jsx` | Wires the filter in; country cell now shows domain |
| `src/i18n/locales/{en,fr,it}.js` | Merge `orders.countryFilter.*` + `orders.breakdown.*` from `NEW_UI_TRANSLATION_KEYS.js` |

### Client (`icvng-client`)

| File | Change |
|---|---|
| `src/pages/PaystackCallbackPage.jsx` | Fully translated, country-aware currency + support address |
| `src/i18n/locales/{en,fr,it}.js` | Merge the `paystackCallback` namespace from `NEW_UI_TRANSLATION_KEYS.js` |

---

## 2. Deploy order

Deploy the **server first**. The admin UI sends `?countryCode=` and reads
`countryBreakdown`; an older server ignores the param and returns `null`, which
the component handles — but the reverse (new server, old admin) is also fine.
There is no hard ordering constraint, but server-first gets orders flowing
again soonest.

```bash
# 1. Server
git add controllers/order.controller.js controllers/admin-order.controller.js \
        controllers/shipping.controller.js utils/countryEmailTemplates.js \
        models/payment-failure.model.js scripts/recoverOrphanPaystackOrders.js \
        route/shipping.route.js
# deploy

# 2. Merge the locale keys into both apps (see NEW_UI_TRANSLATION_KEYS.js),
#    then push them into the uiTranslation collection so they show up in
#    UiTranslationsManagement.jsx:
node scripts/seedUiTranslations.js --app=client
node scripts/seedUiTranslations.js --app=admin

#    Fill es/pt/nl/ar/hi/zh from en.js, then re-seed:
node scripts/translateUiLocales.js
node scripts/seedUiTranslations.js

# 3. Deploy admin + client
```

### Environment

No new variables. Per-country email senders remain optional and fall back to
the shared Nigeria credentials:

```
EMAIL_USER_TG / EMAIL_APP_PASSWORD_TG / EMAIL_FROM_NAME_TG
EMAIL_USER_IT / EMAIL_APP_PASSWORD_IT / EMAIL_FROM_NAME_IT
EMAIL_USER_BJ / EMAIL_APP_PASSWORD_BJ / EMAIL_FROM_NAME_BJ
```

Until these are set, a Togo customer gets French, Togo-branded content sent
**from the Nigerian mailbox**. Content is correct; the sender address is not.
Worth setting before you promote the other markets.

---

## 3. Recover the stranded money

Run this **after** the server deploy — the script replays through
`verifyPaystackController`, so it needs the fixed code.

```bash
# Always dry-run first.
node scripts/recoverOrphanPaystackOrders.js --dry-run --from=2026-07-01

# The reported incident, on its own:
node scripts/recoverOrphanPaystackOrders.js \
     --reference=PSK-1787910602350-6a9144dbaa567b1ecde5a3ea

# Everything in the window:
node scripts/recoverOrphanPaystackOrders.js --from=2026-07-01
```

**Judgement call on `--no-email`:** recovered orders send a confirmation. For a
charge from this morning that is exactly right. For one from three weeks ago,
an "Order Confirmed!" email arriving now will read as a duplicate charge and
generate support load. Use `--no-email` for anything older than a few days and
contact those customers directly.

Charges that still fail are usually pre-snapshot (no `cartItemsJSON` in
metadata) or reference a since-deleted product. Those land in the
`PaymentFailure` collection and need a manual order raised.

---

## 4. Verification

**The fix itself**
1. Test-mode Paystack checkout on `i-coffee.ng`.
2. Callback page shows success, not "Verification Error".
3. Order appears in the customer's order list **and** the admin list.
4. `paymentId` on the order equals the Paystack reference.
5. Confirmation + payment-received emails arrive, in English, in NGN.

**Country scoping**
6. As `DIRECTOR`: order list shows all countries; the country selector and
   breakdown chips render; selecting Togo narrows the list.
7. As a Togo-scoped `MANAGER`: only Togo orders; no selector; hitting
   `/api/admin-order/list?countryCode=NG` still returns only Togo.
8. As a Nigerian `MANAGER`: only NG orders.

**Notifications**
9. As `DIRECTOR`, set a **Togo** order to `SHIPPED`. Customer email must be
   **French, Togo-branded, XOF** — not English/NGN. This is the single most
   important assertion in the whole change.
10. Re-save the same status. **No second email.**

**Tracking**
11. Public track of an NG number from `i-coffee.ng` → found.
12. Same number from `i-coffee.it` → 404, identical to a genuine miss.

**Audit trail**
13. `db.paymentfailures.find({resolved:false})` — should be empty after
    recovery. Non-zero is a P1.

---

## 5. What I did not do

Called out so it isn't mistaken for finished work.

- **No dashboard surface for `PaymentFailure`.** The collection is written to
  but nothing reads it. Until that exists, the check in step 13 is manual.
- **~110 client components still lack `useTranslation`.** I converted the one
  in the broken path. `MyOrders.jsx`, `GuestCheckoutPage.jsx`,
  `BankTransferInstructionPage.jsx` and `PaymentCancelPage.tsx` are next — all
  sit in the order/payment journey a non-English customer walks.
- **Admin order detail modals** (`WebsiteOrderDetailsModal.jsx`, 1,903 lines)
  still hardcode `"Nigeria"` as an address fallback in three places.
- **No automated test.** A CI check asserting "test charge → order count +1"
  would have caught this in minutes and is the highest-value follow-up.
- **`OfflineOrderManagement.jsx`** has no country column at all; manual orders
  are scoped server-side but a director can't see which country they came from.
