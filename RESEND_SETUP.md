# Resend setup — step by step

## 1. Resend account & domain verification

1. Create an account at resend.com.
2. **Domains → Add Domain.** Add each sending domain you'll use:
   `i-coffee.ng`, `i-coffee.it`, and the Togo/Benin domains.
3. Resend gives you DNS records per domain — an MX (for bounce handling),
   plus SPF and DKIM TXT records. Add them at your DNS host and wait for
   Resend to show **Verified**.

   This is the step people skip. Resend rejects any send whose from-address
   is on an unverified domain, and the error is a bare 403 — the email
   service adds "(is the sending domain verified in Resend?)" to that
   message specifically because it isn't obvious.

4. **API Keys → Create.** One key with "Sending access" is enough for all
   countries; the per-country key field exists only for the case where a
   market is billed or administered separately.

## 2. Server

Add to `.env`:

```
RESEND_API_KEY=re_xxxxxxxxxxxx
```

Nothing else. There is no npm install — the service calls Resend's HTTP API
with `fetch`, so the dependency surface stays at zero.

You can also paste the key into the admin UI instead, which stores it in the
database and takes precedence over the env var. Env is better for production
(it never touches a database backup); the UI field is there so an IT admin
can rotate a key without a redeploy.

## 3. Configure in the admin panel

**Settings → Email Provider** (visible to IT and Director only).

1. **Active provider** — Resend is already selected by default.
2. **Default from address** — e.g. `orders@i-coffee.ng`. Used for any country
   with no override.
3. **Sender identity per country** — set a from-address, name and optional
   reply-to per market:

   | Country | From | Name | Reply-to |
   |---|---|---|---|
   | Nigeria | orders@i-coffee.ng | I-Coffee Nigeria | customercare@i-coffee.ng |
   | Togo | commandes@… | I-Coffee Togo | … |
   | Benin | commandes@… | I-Coffee Bénin | … |
   | Italy | ordini@i-coffee.it | I-Coffee Italia | … |

   Each address must be on a verified domain.

4. **Send a test** — pick a country, pick **Test via RESEND**. This bypasses
   the automatic fallback on purpose: a test that quietly succeeded over SMTP
   would tell you nothing about Resend.

5. Save.

## 4. Verify it's really live

Place a test-mode Paystack order and confirm the confirmation email arrives
from the Nigerian address. Then, as a Director, move a **Togo** order to
SHIPPED and confirm the customer email is French, Togo-branded, XOF, and from
the Togo sender. That single check exercises provider, country scoping,
language and currency at once.

The health strip at the top of the settings page shows the last successful
send and the last error, so you don't have to read logs to know whether mail
is flowing.

## 5. Rollback

If Resend misbehaves, switch **Active provider → SMTP** and save. It takes
effect immediately (the settings cache is invalidated on save, not left to
expire). Existing `EMAIL_USER` / `EMAIL_APP_PASSWORD` env vars are untouched
by any of this, so SMTP still works exactly as before.

You shouldn't normally need this: if the active provider is unconfigured or
throws, the send layer already falls back to the other provider automatically
and records the error. Losing an order email to a misconfiguration is worse
than sending it from a slightly wrong address.

## 6. The kill switch

**Email sending enabled** turns off *all* outgoing mail and logs it instead.
Use it whenever you restore a production database dump into staging —
otherwise staging will happily replay real order emails to real customers.
