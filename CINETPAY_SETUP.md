# CinetPay payment gateway — setup & architecture

Dynamic, per-country indigenous payment gateways. CinetPay is the first one,
live for Togo and Benin. A country's own gateway (when configured and
active) is the default at checkout; Stripe remains available in every
country for shoppers paying in a foreign currency, and is the automatic
fallback for any country with no indigenous gateway configured — same role
Paystack already plays for Nigeria.

**Where a country's CinetPay credentials come from, in priority order:**

1. **Admin panel** (`models/paymentGateway.model.js`, encrypted) — set by
   that country's own MANAGER, or by IT/DIRECTOR. Always wins if present,
   even active, even if env vars below are also set — this is what lets a
   country manager self-serve and override a pre-provisioned env default
   without needing a redeploy.
2. **Env vars** (`CINETPAY_API_KEY_<CC>` / `CINETPAY_SITE_ID_<CC>`) — a
   pre-provisioning fallback, e.g. for getting a country live before
   anyone's touched the admin UI.
3. **Neither set** → CinetPay is simply unavailable for that country.
   Checkout falls back to Stripe with no error, no warning banner — exactly
   as if this feature didn't exist for that country yet.

## 1. How it fits together

```
Country manager (or IT/DIRECTOR) enters apikey + site_id
        │   Admin → Settings → Payment Gateway
        ▼
PaymentGateway collection (one doc per {countryCode, provider})
  — apiKey / siteId stored ENCRYPTED (utils/encryption.js)
        │
        ▼
config/paymentRouter.js#getPaymentConfig(countryCode)
  — merges this with the static Stripe/Paystack config
  — decides availableProviders[] and defaultProvider
        │
        ▼
GET /api/country/config  →  country.payment.{availableProviders,defaultProvider}
        │
        ▼
Checkout (web CheckoutPage.jsx / mobile CheckoutScreen.js)
  — renders whichever providers are available
  — preselects defaultProvider
        │
        ▼
POST /api/order/cinetpay-payment  →  CinetPay hosted checkout page
        │
        ▼
Shopper pays on CinetPay's page
        │
        ├─→ notify_url (server-to-server, NOT signed) ─┐
        └─→ return_url (browser redirect)              │
                                                          ▼
                              Both call CinetPay's "Check Payment Status"
                              API before creating anything — the webhook
                              body is never trusted directly.
                                        │
                                        ▼
                          createOrderFromGatewayTransaction()
                          (same function Paystack uses, generalized)
```

Nothing about checkout, the order model, or the webhook/verify pattern is
CinetPay-specific at its core — it's the same shape Paystack already uses.
Adding a second indigenous gateway later (a different country's mobile-money
aggregator, say) means: a new `provider` adapter file
(`config/<provider>.js`, modeled on `config/cinetpay.js`), a new value in
`PAYMENT_GATEWAY_PROVIDERS` (`models/paymentGateway.model.js`), and a new
init/webhook/verify controller trio in `order.controller.js` — no changes
to checkout UI, the admin settings page, or RBAC.

## 2. One-time server setup

Add to `.env` (see `.env.example` for the full annotated block):

```
PAYMENT_SECRETS_KEY=<32 random bytes, hex or base64>
```

Generate it with:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

This is what encrypts every country's CinetPay apikey/siteId at rest in
Mongo. **Treat it like any other production credential** — a secrets
manager, not a `.env` committed to git. Losing or rotating it makes every
previously-saved row undecryptable; there's no recovery path other than
re-entering the credentials.

`SERVER_BASE_URL` (already in use for other things) must also be set
correctly per environment — it's what CinetPay's `notify_url` is built
from. Nothing else to install; like Paystack, this calls CinetPay's HTTP
API directly with `fetch`, zero new npm dependencies.

Optionally, to get a country live before anyone's configured it in the
admin panel, set per-country env vars instead (or as well — admin always
wins if both exist):

```
CINETPAY_API_KEY_TG=
CINETPAY_SITE_ID_TG=
CINETPAY_API_KEY_BJ=
CINETPAY_SITE_ID_BJ=
```

These don't need `PAYMENT_SECRETS_KEY` — they're read straight from the
environment at checkout time, never written to Mongo.

## 3. Get CinetPay credentials

1. Create a merchant account at cinetpay.com (one per country you're
   enabling — confirm with CinetPay whether Togo and Benin need separate
   accounts or one account covers both; either way, each gets its own
   `site_id` here).
2. **Integrations** in the CinetPay dashboard → copy the **apikey**.
3. Create a **service** to get a **site_id**.
4. CinetPay accounts have a **Test/Production mode toggle** tied to the
   same apikey/site_id (unlike Stripe/Paystack's separate test-key pairs) —
   there's no separate sandbox credential pair to enter here. Use CinetPay's
   own dashboard toggle to switch modes while testing, and set the `mode`
   field in the admin settings page to match (informational only — it does
   not itself change CinetPay's behavior, it's a reminder to whoever's
   looking at the settings page).

## 4. Configure in the admin panel

**Settings → Payment Gateway.**

- **IT / DIRECTOR** see every country and can configure any of them.
- **A country-scoped MANAGER** (Togo or Benin) sees only their own country's
  row and can add/edit it — nobody else's. This is enforced server-side
  (`route/paymentGateway.route.js`), not just hidden in the UI.

The same `payments.view`/`payments.manageCountry` permissions also govern
**Settings → Bank Transfer Settings** (that country's receiving bank
account for Direct Bank Transfer) — a country-scoped MANAGER manages both
their own country's CinetPay keys and their own country's bank details
from the same permission grant; IT/DIRECTOR manage every country's of
both. See `route/bankTransferSettings.route.js`.

Per country:

1. **Active** — offers CinetPay at checkout for this country. Leave off
   while testing; the country falls back to Stripe-only exactly as if
   nothing were configured.
2. **Preselect by default** — CinetPay is the radio button checked by
   default at checkout (Stripe stays selectable regardless).
3. **Mode** — Production or Test, informational (see §3.4).
4. **API Key** / **Site ID** — required the first time; leave blank on a
   later edit to keep the existing (encrypted) value unchanged. Never shown
   again once saved — the page only shows whether a value is set, not what
   it is.

Changes take effect within ~60 seconds (checkout's payment-config read is
cached briefly — see `config/paymentRouter.js` — to avoid a Mongo read on
every single page view; saving/deleting a row invalidates that country's
cache entry immediately, so in practice it's closer to instant).

## 5. What checkout actually does

- `country.payment.availableProviders` includes `"cinetpay"` only when that
  country has an **active** row.
- `defaultProvider` is CinetPay when active, else Paystack (Nigeria), else
  Stripe.
- Switching the currency selector away from the country's own currency
  hides CinetPay (and Bank Transfer, same rule) and leaves Stripe as the
  only option — CinetPay always settles in the country's native currency
  (XOF for Togo/Benin).
- CinetPay amounts in XOF are rounded up to the nearest multiple of 5
  (`roundForCinetPay` in `config/cinetpay.js`) — a CinetPay API requirement,
  not optional.

## 6. Testing before going live

1. Set the country's row to **Test** mode + CinetPay's dashboard sandbox
   toggle, leave **Active** on.
2. Complete a real checkout on that country's storefront — CinetPay's
   hosted page appears, shows the sandbox test payment methods.
3. Confirm the order appears in admin (Orders) with `payment_method:
   CinetPay` and `payment_status: PAID`.
4. Two independent paths create the order — verify both work at least once:
   - **Return path** (primary): browser redirects back to
     `/payment/cinetpay/callback`, which calls
     `GET /api/order/verify-cinetpay/:reference`.
   - **Webhook path** (backup, for a closed tab / dropped connection):
     CinetPay POSTs to
     `{SERVER_BASE_URL}/api/order/cinetpay-webhook/{countryCode}`. If your
     dev server isn't publicly reachable, use a tunnel (ngrok or similar)
     and a scratch `SERVER_BASE_URL` for this test only — CinetPay's docs
     suggest testing the notify URL directly with a tool like Postman
     first, since "notify_url not reachable" is the most common webhook
     failure.
5. Try a partial gift-card-plus-CinetPay order and a gift-card-covers-full
   order — both are wired the same way Paystack's gift card path already
   works.
6. Flip to **Production** mode + real CinetPay credentials only after all
   of the above passes.

## 7. Known gaps / deliberately out of scope

- **Gift card *purchases*** (buying a new gift card, as opposed to
  redeeming one at checkout) are still Paystack/Stripe only — CinetPay
  wasn't added to that separate flow (`giftCard.controller.js`).
- **Refunds** — there's no CinetPay refund flow; a refund still needs to be
  processed directly in the CinetPay dashboard, then reflected on the order
  manually in admin, exactly as the codebase already handles Paystack
  refunds today.
- **No per-country UI-copy isolation** — unrelated to CinetPay itself, but
  worth knowing if a country manager also edits UI Copy Translations: those
  rows are keyed by language, not country, so a Togo manager editing French
  copy affects Benin's storefront too (both default to French). A
  country-scoped admin IS now restricted to only their own country's
  primary language (see `uiTranslation.controller.js`'s
  `getAllowedLanguagesForRequest`) — that keeps them out of languages that
  aren't theirs at all (Italian, English), it just can't separate two
  countries that happen to share one.

- **`EDITOR` cannot be country-scoped** — a deliberate, pre-existing
  constraint (`config/roles.js`'s `HQ_ONLY_SUBROLES`, plus the admin's own
  user-creation form actively prevents assigning `EDITOR` a country) left
  untouched here. If a "foreign Editor" role is wanted for UI Copy
  Translations, that requires removing `EDITOR` from `HQ_ONLY_SUBROLES` in
  both `config/roles.js` and `CreateUserModal.jsx` — a bigger change than
  this feature, done separately and deliberately.

## 8. Files touched (reference for future changes)

**Server:** `models/paymentGateway.model.js`, `models/paymentIntent.model.js`,
`utils/encryption.js`, `config/cinetpay.js`, `config/paymentRouter.js`,
`controllers/paymentGateway.controller.js`, `route/paymentGateway.route.js`,
`controllers/order.controller.js` (cinetpayPaymentController /
cinetpayWebhookController / verifyCinetpayController +
generalized createOrderFromGatewayTransaction), `route/order.route.js`,
`config/permissions.js`, `config/roles.js`, `models/order.model.js`,
`models/payment-failure.model.js`,
`controllers/bankTransferSettings.controller.js`,
`route/bankTransferSettings.route.js` (opened to country-scoped MANAGER —
previously HQ-only), `controllers/uiTranslation.controller.js`,
`route/uiTranslation.route.js` (country-scoped language restriction +
the earlier hqOnly fix).

**Shared package** (`@yehgs/icvng-core`, bumped to 0.9.4):
`src/checkout/gatewayOrder.js`, `src/api/endpoints.js`.

**Client:** `context/CountryContext.jsx`, `pages/CheckoutPage.jsx`,
`pages/CinetpayCallbackPage.jsx`, `route/index.jsx`, `i18n/locales/*.js`.

**Mobile:** `screens/CheckoutScreen.js`, `i18n/locales/*.js`.

**Admin:** `pages/settings/PaymentGatewaySettings.jsx`,
`pages/settings/BankTransferSettings.jsx`,
`pages/settings/UiTranslationsManagement.jsx`, `utils/api.js`,
`components/layout/AdminSidebar.jsx`, `App.jsx`,
`pages/order/WebsiteOrderManagement.jsx`,
`components/order/OrderDetailsModal.jsx`,
`components/order/CreateOrderModal.jsx`.
