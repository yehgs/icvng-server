# Product Visibility, Pricing & Stock Rules — Reference

This document is the single source of truth for how i-Coffee decides whether
a product can be published, what makes it purchasable, who is allowed to set
its price/stock, and what a customer sees when it isn't purchasable. Keep
this updated whenever the rule changes — the same logic is implemented in
three places and they must stay in sync (see "Where this is implemented"
below).

---

## 1. Terminology

| Term (customer-facing) | Term (admin/server field)      | Meaning |
|---|---|---|
| "2 Weeks Delivery"     | `price3weeksDelivery`          | Special-order price, ships in ~2 weeks. The **field name says "3weeks" — this is legacy naming and does NOT mean 3 weeks.** Everywhere in the admin and server code, "3-week price" and "2-week price" refer to the exact same field, `price3weeksDelivery`. Don't rename the field; just remember the label mismatch. |
| "5 Weeks Delivery"     | `price5weeksDelivery`          | Special-order price for Machine-type products, ships in ~5 weeks. |
| "Regular Price"        | `btcPrice`                     | Standard price, fulfilled from in-house/partner stock (1–3 business days). |
| —                      | `btbPrice`                     | Business-to-business price. Not used in the customer visibility rule at all. |
| Online stock            | `warehouseStock.onlineStock` or `partnerStock.quantity` | Units actually available to ship immediately. Never shown to customers as an exact number — see §5. |
| "Not available for sale" / discontinued | `productAvailability: false` | An explicit admin decision that this product is no longer sold, independent of pricing/stock. |

---

## 2. Product TYPE (or Category) decides which delivery price counts

Every product has a `productType` field: `COFFEE`, `MACHINE`, `ACCESSORIES`,
`COFFEE_BEANS`, `TEA`, `DRINKS`.

A product is **"five-week type"** if *either*:
- `productType === "MACHINE"`, **or**
- its **Category** slug is `capsule-machine` or `coffee-maker`

Both signals are checked (server, admin, and client all check both — not
just one) because `productType` data isn't fully reliable on its own: a
real example that shipped this way was a Tassimo coffee machine filed under
category "Coffee Maker" but left with `productType: "COFFEE"`. Trusting
`productType` alone let that product pass the server's check while the
client (which checked category too) correctly refused to show it — a
contradiction that left the product fetchable (reachable via header search,
shop search, and its own product page) even though it was never actually
purchasable.

- **Five-week type** → only `price5weeksDelivery` counts as a valid
  delivery price. A `price3weeksDelivery` value set on one of these is
  **silently ignored by the storefront** — this is the exact bug that
  caused a fully-priced product to show "Pricing Unavailable"/a waitlist
  screen on the client while looking fine in the admin.
- **Anything else** → only `price3weeksDelivery` ("2 Weeks Delivery" in the
  UI) counts.

---

## 3. Purchasability rule — the canonical formula

A product is **purchasable** if, and only if, at least one of:

```
(a) hasMatchingDeliveryPrice:
      isFiveWeekType (see §2)  →  price5weeksDelivery > 0
      otherwise                 →  price3weeksDelivery > 0

(b) hasRegularPriceWithStock:
      btcPrice > 0
      AND
      ( warehouseStock.onlineStock > 0
        OR
        (partnerStock.enabled === true AND partnerStock.quantity > 0) )
```

`isPurchasable = (a) OR (b)`

Notes:
- Toggling `partnerStock.enabled` to `true` with **zero quantity does not
  count** as stock. A partnership must have an actual reported quantity.
- Stock priority (when more than one stock source could apply) mirrors the
  product schema's own `effectiveOnlineStock` virtual: **partnerStock wins
  if enabled → then warehouseStock if enabled → then the legacy top-level
  `stock` field** as a last-resort fallback for products never migrated to
  the newer stock system.
- `productAvailability` is a **separate, independent** switch — see §4.

---

## 4. `publish` status vs `productAvailability` — draft-forcing

On every product **create** and **update**:

- If the product is **not purchasable** (fails §3 entirely), the server
  **forces `publish = "DRAFT"`**, overriding whatever status was submitted.
  This can't be bypassed by the admin UI — it's enforced server-side. The
  admin's product form shows a live warning banner when this is about to
  happen, before you even save.
- `productAvailability` (the "Product Available for Sale" checkbox) does
  **not** affect this draft-forcing. It's a separate flag an admin sets
  explicitly when a product is discontinued/out of production.

### Where a product is fetchable, depending on both flags

| `publish`   | purchasable? | `productAvailability` | Shows in listings (home/shop/search/carousel)? | Shows on its own product page? |
|---|---|---|---|---|
| PUBLISHED   | yes | true  | ✅ Yes | ✅ Yes, normal purchase UI |
| PUBLISHED   | yes | false | ❌ No (discontinued items never appear in listings) | ✅ Yes, but shows "Temporarily Unavailable / join the waitlist" instead of purchase options |
| DRAFT       | no  | (either) | ❌ No | ❌ No — 404, not found |

This is implemented with two different Mongo filters:
- **`CLIENT_VISIBILITY_FILTER`** (strict) — every listing endpoint. Requires
  `publish: PUBLISHED`, `productAvailability !== false`, AND purchasable.
- **`PRODUCT_DETAIL_FILTER`** (lenient) — the single-product-page fetch
  only. Requires `publish: PUBLISHED` AND (purchasable OR
  `productAvailability === false`).

**A customer should never see a confusing "why can't I buy this" screen for
a product that's simply missing its pricing/stock setup** — that case 404s
instead. The only customer-facing "can't buy this" screen is for explicitly
discontinued products, and it is framed as "no longer available" /
"discontinued", **never** as "out of stock" — see §6 for why.

---

## 5. Who can set what

| Field | Default permission | Exception |
|---|---|---|
| `btbPrice`, `btcPrice`, `price3weeksDelivery`, `price5weeksDelivery`, `discount` | ACCOUNTANT, IT, DIRECTOR only | If `partnerStock.enabled === true`, **any role** may set these — pricing on a partner/supplier product is supplier-driven, not an internal accounting decision. |
| Warehouse online stock quantity (`warehouseStock.onlineStock`, via Warehouse Management → Stock Edit) | WAREHOUSE, IT, DIRECTOR only | No exception — always warehouse-only outside of the partner-stock path. |
| Partner stock quantity (`partnerStock.quantity`, in the product form) | Any role | Always open — this is the supplier-reported number, not an internal one. |

A non-authorized role's submitted values for a locked field are **silently
dropped** (existing value preserved on update, or defaulted to 0 on create)
— never a hard error, so the rest of the form submission still succeeds.

---

## 6. Customer-facing language — "no longer available", never "out of stock"

Per how this business actually operates: **the business does not run out of
stock in a way that should read as an error state to a customer.** When
in-house/partner online stock hits zero, the storefront simply falls back to
offering the appropriate delivery-price option (2-week or 5-week, per §2) —
this is normal, expected behavior, not a problem, and it is presented to the
customer as an ordinary purchase option, with no "we're out of stock,
falling back to X" framing at all.

The only state that gets special "you can't buy this" messaging is a
product an admin has explicitly marked **discontinued**
(`productAvailability: false`) — meaning it's no longer in production. That
screen says the product is **"Temporarily Unavailable"** / **"no longer
available"**, and offers a waitlist signup ("Notify Me When Available"),
which feeds the existing product-request/waitlist system so the team knows
who to contact if it comes back.

**Exact stock quantities are never shown to customers** — not on the
product page, not on product cards, not anywhere on the client. Numbers
like "12 units available" are internal/admin-only information (visible in
the admin Product Management table's ONLINE column). Customers only ever
see a boolean "In Stock" indicator, or nothing at all if stock is the reason
a price option isn't offered.

---

## 7. Where this is implemented

The rule in §3 is implemented independently in three places and **must be
kept in sync**:

1. **Server** — `icvng-server/controllers/product.controller.js`
   - `buildPurchasableOr()` / `HAS_ONLINE_STOCK_OR` (Mongo query fragments,
     async — category membership requires a cached DB lookup)
   - `isProductPurchasable()` (plain-JS mirror, used for draft-forcing;
     takes a resolved category slug as its second argument)
   - `buildClientVisibilityFilter()` / `buildProductDetailFilter()`
   - **Every** product-fetching endpoint must call these — do not
     hand-roll a visibility `$or` inline. Two separate endpoints
     (`searchProductController`, the header-search dropdown; and
     `searchProduct`, the shop page's search/filter endpoint) were found
     with their own stale, category-blind copies of the old rule that
     never got updated when the canonical rule changed — that's exactly
     how a product could still appear in search after being fixed
     everywhere else. If you add a new product-listing endpoint, import
     and call the shared builders — never inline the `$or` again.
2. **Admin** — `icvng-admin/src/config/deliveryCategories.js` (exports
   `isFiveWeekDeliveryCategory(productType, categorySlug)` and
   `FIVE_WEEK_DELIVERY_SLUGS`) + `icvng-admin/src/components/product/ProductForm.jsx`
   (live warning banner — imports the same helper, don't reimplement it inline)
3. **Client** — `icvng-client/src/config/deliveryCategories.js` (same
   shape/export as admin's) + call sites in `ProductDisplayPage.jsx`,
   `CardProduct.jsx`, `Search.jsx`

Pricing/stock permissions (§5) are implemented in:
- `icvng-server/controllers/product.controller.js` (`canSetPricing`, `PRICING_FIELDS`)
- `icvng-server/controllers/warehouse.controller.js` (`updateStock` and friends)
- `icvng-admin/src/components/product/ProductForm.jsx` (`canEditPricing`, field `readOnly`/lock styling)

---

## 8. Admin-side extras

- **Product Management → filters**: "All Partner Stock" filter added
  alongside the existing visibility/status/price filters, so you can find
  every partner-managed product at a glance.
- **Direct Pricing** (Accountant tool): validation now correctly treats an
  empty 2-week or 5-week field as "not set" rather than an invalid number —
  previously, leaving one blank while filling the other triggered a false
  "Must be a valid number" error and blocked saving. You only need to fill
  in whichever delivery price applies to the product's type (§2); you do
  not need to fill in both.
