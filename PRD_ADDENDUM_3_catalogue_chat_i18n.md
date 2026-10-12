# PRD Addendum 3 — Product catalogue PDF, AI chat system, storefront i18n audit, menu overflow cue, Tawk.to removal

**Status:** Living. Sections are numbered §9e–§9h to avoid colliding with §9a/§9b
(Addendum 1, order country scoping) and §9c/§9d (Addendum 2, payments / manual orders).
Repos touched: `icvng-server`, `icvng-admin`, `icvng-client`, `icvng-mobile`.

---

## 9e. Admin product catalogue (printable / downloadable PDF)

### Purpose
Sales-facing PDF catalogue generated server-side from live product data, printable
and downloadable from the admin.

### Access
| Who | Access |
|---|---|
| SALES, SALES_MANAGER, MANAGER (HQ) | Yes (`catalogue.download`) |
| IT, DIRECTOR | Yes (wildcard) |
| Country-scoped (foreign) **MANAGER** | Yes — locked to own country |
| Foreign SALES / any other role (ACCOUNTANT, …) | 403 (`middleware/catalogueAccess.js`) |

### Country, language, currency
- HQ admins pick country + language on the page. Foreign managers are **locked** to
  their `assignedCountry`: that country's default language and currency are forced
  server-side (Togo → French + CFA/XOF) regardless of what the request says.
- Prices are stored in NGN and converted with `ExchangeRateModel.getRate("NGN", code)`
  (MANUAL rate beats API rate). No rate → `422 NO_EXCHANGE_RATE` (never a wrong price).
- Product text is localized through the `Translation` collection (`localizeList`);
  brand names are never translated. Visibility honours `visibleInCountries`; drafts excluded.
- `btbPrice` is HQ-only and is stripped for foreign admins (field not offered, not printed).
- pdfkit/Helvetica (WinAnsi) has no ₦ glyph → NGN prints as `NGN 12,000`. Only Latin-script
  languages render; other languages fall back to English labels (`resolveCatalogueLanguage`).
  Label sets: en/fr/it full; es/pt/nl partial (fall back to en per key).

### Filters and field toggles
Brand, category, sub-category, product type, roast, tags, price range, stock status,
search, group-by (category/brand/none), sort. Field toggles (`FIELD_DEFS`): image, name,
SKU, brand, category, type, price, description, stock, etc. **All on by default, including images.**

### Endpoints (`/api/admin/catalogue`, `route/catalogue.route.js`)
- `GET /options` — filter options + printable countries/languages for the caller.
- `POST /preview` — count + sample, no PDF.
- `POST /pdf` — returns `application/pdf`; logs `CATALOGUE_PDF` in the activity log.

### Limits
2000 products without images, 600 with images → `413`. Images are prefetched
(concurrency 8, JPEG/PNG verified); a failed image degrades to a placeholder.

### Files
Server: `services/catalogue/{catalogueService,cataloguePdf,catalogueStrings}.js`,
`controllers/catalogue.controller.js`, `middleware/catalogueAccess.js`, `route/catalogue.route.js`.
Admin: `pages/catalogue/ProductCatalogue.jsx` (route `/dashboard/catalogue`, sidebar `nav.catalogue`).

---

## 9f. AI chat system (storefront web + mobile app)

### Summary
Embedded chat widget for the client storefront and the mobile app. An OpenAI assistant
answers first (grounded in live products, prices in the visitor's currency, stock),
collects contact details, and escalates to a human desk. Admins manage everything in
`/dashboard/chat`. **Replaces Tawk.to** (see §9h).

### Lifecycle
`ai` → `waiting_agent` → `agent` → `resolved` / `closed`.
- AI replies in the conversation's language (`language`, derived from the storefront country).
- Structured AI output (OpenAI Responses API, strict JSON schema): `reply`,
  `action` ∈ `none | escalate | ask_contact | resolved`, `escalate_to`
  (SALES/MANAGER/IT/DIRECTOR), `reason`, `summary`, `captured_name/email/whatsapp`.
- When `requireContactForEscalation` is on, the AI asks for contact once before escalating.
- Visitor can press "Talk to a person" at any time (no AI judgement needed).
- AI failure → "unavailable" system message and **auto-escalation to SALES** (never a dead end).
- While an agent is engaged the AI is **not called**. Agents can hand back to the AI.
- Agents can take over, reply, add **internal notes** (never shown to the visitor), transfer
  to another desk, set priority/tags, edit visitor info, resolve/close. Visitors can rate.
- The visitor sees the responding admin's **name, role label and image** (snapshot stored on
  the conversation).

### Data model
- `ChatConversation`: `countryCode`, `language`, `channel` (web/mobile), `visitor{userId, visitorId,
  name, email, whatsapp, pageUrl, userAgent}`, `tokenHash` (select:false), `status`, `aiEnabled`,
  `escalation{requested, by, targetRole, reason, requestedAt, overdueNotifiedAt}`, `contactAsked`,
  assigned* snapshot (name, role, roleLabel, image), `seq`, `unreadForAdmin`, `firstAgentReplyAt`,
  `visitorLastSeenAt`, `summary`, `tags`, `priority`, `rating`.
- `ChatMessage`: `seq`, `senderType` (visitor/ai/agent/system), `sender{userId,name,role,image}`,
  `text`, `kind`, `internal`.
- `ChatSettings` (singleton `"global"`): `enabled`, `aiEnabled`, `disabledCountries`, `model`,
  `extraInstructions`, `requireContactForEscalation`, `slaSeconds` (default 120),
  `alarmRepeatSeconds` (default 30), per-language `welcome`.
- `Notification.type` gained `'CHAT'`; `ActivityLog.action` gained `CATALOGUE_PDF`.

### Country / role scope (the rule)
| Admin | Sees |
|---|---|
| IT, DIRECTOR | All countries |
| COUNTRY-scoped admin (manager/sales abroad) | Only their `assignedCountry` |
| Other HQ (GLOBAL) roles | Only the HQ country (NG) |

Out-of-scope conversation ids return **404** (not 403). Implemented in `services/chat/chatScope.js`
(`chatScopeFilter`, `canAccessConversation`, `notificationAudiences`). Escalation desks:
SALES→[SALES, SALES_MANAGER], MANAGER, IT, DIRECTOR. Notification audiences: HQ conversation →
HQ_ONLY of the desk + IT + DIRECTOR; foreign conversation → COUNTRY audience of the desk +
HQ_ONLY [IT, DIRECTOR].

### Realtime model: short polling (deliberate)
Cloud Run runs several instances and there are no websockets, so everything is stateless
polling on a per-conversation `seq` cursor (`GET …/conversations/:id?after=<seq>`).
- Visitor widget: 2.5–4 s while open; 15 s in background once a human is involved.
- Presence = `visitorLastSeenAt` within 25 s ("user is on chat" badge).
- Admin console: alerts every 5 s, list every 8 s, open thread every 3 s.
- Future option: socket.io + Redis adapter.

### Alarm, SLA and notifications
- New chat → low-priority `CHAT` notification to the audience (first visitor message).
- Escalation → high-priority notification; console plays an **alarm** (Web Audio), flashes the
  tab title, fires a desktop Notification, shows a red OVERDUE banner.
- Overdue sweep is lazy on the alerts poll; a conversation is claimed atomically via
  `escalation.overdueNotifiedAt` so the SLA alert fires exactly once across instances.
  Alarm repeats every `alarmRepeatSeconds` until someone takes over.

### API
Public (`/api/chat`, rate-limited per route, `utils/rateLimit.js`; in-memory per instance):
`GET /config`, `POST /conversations` (optionalAuth; logged-in users resume), `GET /conversations/:id`,
`POST /conversations/:id/messages | lead | human | rate | close`.
Visitor auth = conversation id + secret token (sha256 stored) in header **`x-chat-token`**
(added to CORS allowed headers).
Admin (`/api/admin/chat`): read (`chat.view`) `GET /alerts, /stats, /conversations,
/conversations/export.csv (formula-injection safe), /conversations/:id, /settings`;
act (`chat.manage`) `POST /conversations/:id/messages|takeover|hand-back|transfer|close`,
`PATCH /conversations/:id`; `PUT /settings` needs `chat.settings` (IT/DIRECTOR only, hqOnly).

### Permissions
New modules CATALOGUE and CHAT in `config/permissions.js`: `catalogue.download`, `chat.view`,
`chat.manage`, `chat.settings`. `roles.js`: MANAGER, SALES_MANAGER, SALES get
`catalogue.download`, `chat.view`, `chat.manage`; IT/DIRECTOR via wildcard.

### Configuration
- Reuses `OPENAI_API_KEY`. New optional env **`OPENAI_CHAT_MODEL`** (default `gpt-5-mini`);
  the model can also be overridden in Chat settings.
- Kill switches: global `enabled`, `aiEnabled`, per-country `disabledCountries`.

### Clients
- Web: `client/src/components/ChatWidget.jsx` (mounted in `App.jsx`), localStorage key
  `icvng_chat_v1`, inline contact form, rating, end chat, agent avatar/name/role.
- Mobile: `mobile/src/components/ChatLauncher.js` (FAB + full-screen Modal), mounted from
  `RootNavigator.js` when logged in + onboarded; hidden on auth routes (`CHAT_HIDDEN_ROUTES`).
- Admin: `pages/chat/ChatConsole.jsx` (inbox tabs, thread, visitor panel with wa.me link, stats,
  CSV export, settings modal; deep link `?c=<id>`).
- i18n: `chat` namespace in client/mobile (26 keys) and admin (88 keys), en/fr/it.

### Known limits
In-memory rate limiter is per-instance; no attachments; no order-status lookup for logged-in
users yet; es/pt/nl/ar/hi/zh UI strings fall back to English until translated.

### Tests
`tests/chat_catalogue_int.mjs` — integration test (FerretDB/Mongo, OpenAI stubbed): catalogue
(foreign lock, FX, visibility, PDF, 403/422) and chat (AI, contact capture, routing, scoping,
alarms, presence, internal notes, transfer, overdue-once, CSV, stats, rating, AI failure,
disabled country, rate limit). Run: `TEST_MONGO_URI=mongodb://… node tests/chat_catalogue_int.mjs`.

---

## 9g. Storefront i18n audit and menu overflow cue

- **Overflow cue (web/desktop):** the storefront header menu shows an animated fade + chevron
  indicator when menu items exceed the available width, so users know the menu continues.
- **Hardcoded-text audit:** contact page and other client pages that used literal English were
  converted to `t("…")` keys in `client/src/i18n/locales/*`. Because the client overlays DB
  values (`uiTranslation`) on the bundled locale (§8c), every converted string is editable in
  the admin **Translate Site / UI Translations** page.
- **Required after deploy** (otherwise new keys exist only in the bundle, fr/it fall back to
  files, others to English):
  1. `node scripts/translateUiLocales.js` (fills es/pt/nl/ar/hi/zh from en);
  2. `node scripts/seedUiTranslations.js --app=client` and `--app=admin` (idempotent,
     manual-edit-protected).

---

## 9h. Tawk.to removal

Third-party Tawk.to chat has been removed everywhere: `TawkWidget.jsx`, the `useTawkZIndex`
hook in `DisplayCartItem.jsx`, Tawk CSS in `App.css`, `index.html` comments, the `tawk` field of
the `Country` model, `countryConfig.controller.js` / `countryService.js` handling, and the
Tawk section of admin `CountryManagement.jsx`. Existing `tawk` values in country documents
are ignored (harmless; can be `$unset`). Support chat is now §9f.

---

## Change log (this addendum)
- Added admin catalogue PDF (§9e).
- Added AI chat system with web + mobile widgets and admin console (§9f).
- Storefront hardcoded-text audit + menu overflow cue (§9g).
- Removed Tawk.to (§9h).
