# Manual orders — ONLINE vs OFFLINE

## Correction to the previous revision

The 2026-08-28 change retired BTB and forced every manual order to BTC. That
was a misreading of "cancel any BTB logic". BTB is not retired — it is the
**offline half** of a two-mode system. The BTC-only rejection has been removed.

## The two modes

|                | ONLINE | OFFLINE |
|---|---|---|
| Order type | BTC | BTB |
| Customer | User `role: USER / subRole: BTC`, mirrored into Customer; or Customer `BTC + ONLINE` | Customer `BTB + OFFLINE` |
| Price shown | `btcPrice`, or a special-order delivery price | `btbPrice` only |
| Stock pool | `partnerStock` → `warehouseStock.onlineStock` → `stock` | `warehouseStock.offlineStock` |
| Visibility rule | Canonical storefront §3 rule | BTB price + physical offline stock |
| Special-order (2/5 week) | Allowed, does not consume stock | **Not allowed** |
| Who can create | IT, Director, country Manager, SALES with `userMode: ONLINE` | IT, Director, country Manager, SALES with `userMode: OFFLINE` |

Offline has no special-order path deliberately: you cannot hand a walk-in
customer something that arrives from a supplier in five weeks and call it an
over-the-counter sale.

## Mode is derived, not submitted

For a SALES agent the mode comes from `user.userMode` on their account. The
server calls `resolveOrderMode(user, requestedMode)` and **ignores what the
client sent**. IT/DIRECTOR/MANAGER work in both modes and may choose.

This matters: if the client picked the mode and the server merely validated
it, the UI lock would be the only thing enforcing the rule — and a disabled
`<select>` is not a control. The admin lock exists so an agent *sees* what
they can create, not to enforce it.

`orderType` is derived from mode and never accepted from the client. A
request whose `orderType` disagrees with its own mode gets a 400 naming both,
rather than being silently corrected — a silent correction would hand the
agent an order that isn't what they thought they made.

### A SALES account with no sales mode

Rejected with a message telling them to ask IT or a Director. Not defaulted.
Defaulting would silently give an offline agent access to storefront stock,
or the reverse.

Note: `userMode` is already on the User model (`ONLINE`/`OFFLINE`, valid for
ADMIN/SALES and USER/BTC/BTB). The "Sales Mode" dropdown in User Management
writes to it. No migration needed.

## Storefront customers are now in the Customer module

There were two customer records that were never joined:

- **User** — storefront registrations (`role: USER`, `subRole: BTC`)
- **Customer** — the admin book (BTC/BTB × ONLINE/OFFLINE)

A website shopper existed only as a User, so they never appeared in Customer
Management and an ONLINE agent had nobody to select — even though that is
exactly the customer they serve. `Customer.isWebsiteCustomer` existed but had
no link behind it.

Added `Customer.userId` (unique, sparse) and
`services/customerSync.service.js`:

- new registrations mirror automatically at signup (non-fatal if it fails)
- existing users backfill via `node scripts/syncWebsiteCustomers.js`

The mirror is thin — identity and contact only. User stays the source of
truth for auth, password and cart; nothing writes back to it.

**Why mirror instead of unioning two collections at query time:** every list,
search, filter, count and pagination path would have to merge two differently
shaped sources, and each is a place to get country scoping wrong. One
queryable surface, one country field, one scoping plugin.

## Backfill

```bash
node scripts/syncWebsiteCustomers.js --dry-run
node scripts/syncWebsiteCustomers.js
node scripts/syncWebsiteCustomers.js --country=TG
```

Idempotent — safe to re-run.

## Payment methods

Paystack added to the manual-order dropdown, shown **only when the order's
country is NG**. Paystack is Nigeria-only in `COUNTRY_CONFIG`, and the
gateway guard rejects it elsewhere — offering it on a Togo order would let an
agent pick a method that then fails.

## Verification

1. **Online SALES agent** — mode selector disabled on Online, type shows BTC.
   Customer picker lists only BTC/ONLINE (including website registrations).
   Product search shows BTC prices and storefront-available products.
2. **Offline SALES agent** — locked to Offline/BTB. Picker lists only
   BTB/OFFLINE. Product search shows BTB prices and only products with
   physical offline stock; no 2/5-week options appear.
3. **Director** — can switch modes; type follows automatically.
4. **Cross-check** — an offline sale must reduce `warehouseStock.offlineStock`
   and leave online stock untouched. An online sale must do the reverse.
5. **Sales agent with no mode set** — gets the "ask IT or a Director" message
   rather than a default.
