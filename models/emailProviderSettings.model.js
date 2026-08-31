/**
 * models/emailProviderSettings.model.js
 *
 * System-wide email provider configuration, managed exclusively by HQ
 * IT/DIRECTOR (route guard: requirePermission(["settings.manage"]), which
 * only those two subRoles hold via the WILDCARD permission in
 * config/roles.js). Mirrors the bankTransferSettings pattern.
 *
 * ── SINGLETON, NOT PER-COUNTRY ───────────────────────────────────────────
 * Unlike bankTransferSettings (one doc per country), this is ONE document
 * for the whole system. The PROVIDER is a system-level decision — you don't
 * want Nigeria on Resend while Italy is on Gmail SMTP, because then a
 * deliverability problem has two different shapes and debugging doubles.
 *
 * What IS per-country is the SENDER IDENTITY: from-address, from-name and
 * (optionally) a country-specific API key. Those live in `countries[]`
 * below, so a Togo email still comes from a Togo address whichever provider
 * is carrying it.
 *
 * ── WHY RESEND IS THE DEFAULT ────────────────────────────────────────────
 * The previous implementation hardcoded `service: "gmail"` with an app
 * password. That caps out around 500 recipients/day, has no delivery
 * telemetry, and silently drops mail once a country's mailbox is rate
 * limited — which for a multi-country storefront is a live outage you
 * cannot see. Resend gives per-domain sending, webhooks and a delivery log.
 * SMTP is retained as an escape hatch, not as the default.
 *
 * SAFETY: `getActiveProviderConfig()` falls back to SMTP if Resend is
 * selected but unconfigured, and the send layer falls back again if the
 * chosen provider throws. An email must never be lost to a misconfiguration
 * — order confirmations are the thing that reassures a customer their money
 * did something.
 */

import mongoose from "mongoose";
import { ALL_COUNTRY_CODES } from "../config/countries/index.js";

export const EMAIL_PROVIDERS = ["RESEND", "SMTP"];

const countrySenderSchema = new mongoose.Schema(
  {
    countryCode: {
      type: String,
      required: true,
      enum: ALL_COUNTRY_CODES,
      uppercase: true,
      trim: true,
    },
    // e.g. "orders@i-coffee.ng". Must be on a domain verified in Resend,
    // otherwise Resend rejects the send outright.
    fromEmail: { type: String, trim: true, lowercase: true },
    fromName: { type: String, trim: true },
    // Optional per-country reply-to, so customer replies reach the right
    // country's inbox even when sending is centralised.
    replyTo: { type: String, trim: true, lowercase: true },
    // Optional per-country Resend key. Most setups use one account-wide key
    // (stored in env as RESEND_API_KEY); this exists for the case where a
    // market is billed or administered separately.
    resendApiKey: { type: String, trim: true, select: false },
    isActive: { type: Boolean, default: true },
  },
  { _id: false },
);

const emailProviderSettingsSchema = new mongoose.Schema(
  {
    // Enforces the singleton. Always "GLOBAL".
    key: {
      type: String,
      default: "GLOBAL",
      unique: true,
      immutable: true,
    },

    activeProvider: {
      type: String,
      enum: EMAIL_PROVIDERS,
      default: "RESEND",
      required: true,
    },

    resend: {
      // Stored in DB only if IT/DIRECTOR paste one in the UI; otherwise the
      // send layer reads process.env.RESEND_API_KEY. `select: false` keeps
      // it out of every ordinary query — it is only ever read by the send
      // layer's explicit +resend.apiKey projection, and NEVER returned to
      // the admin UI (the controller returns a masked hint instead).
      apiKey: { type: String, trim: true, select: false },
      // Default sender used when a country has no override.
      defaultFromEmail: { type: String, trim: true, lowercase: true },
      defaultFromName: { type: String, trim: true, default: "I-Coffee" },
    },

    smtp: {
      // Retained escape hatch. Credentials continue to come from env
      // (EMAIL_USER / EMAIL_APP_PASSWORD and the _<CC> variants) so this
      // change does not move existing secrets into the database.
      service: { type: String, trim: true, default: "gmail" },
      host: { type: String, trim: true },
      port: { type: Number },
      secure: { type: Boolean, default: true },
    },

    // Per-country sender identity, provider-independent.
    countries: { type: [countrySenderSchema], default: [] },

    // Operational switch. When false, NOTHING is sent and every send is
    // logged instead — useful when restoring a database dump into staging,
    // where replaying real order emails to real customers would be
    // genuinely harmful.
    sendingEnabled: { type: Boolean, default: true },

    // Last successful send per provider, for the settings UI health strip.
    lastVerifiedAt: { type: Date, default: null },
    lastVerifiedProvider: { type: String, default: null },
    lastError: { type: String, default: null },
    lastErrorAt: { type: Date, default: null },

    updatedBy: { type: mongoose.Schema.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

/**
 * Fetch (or lazily create) the singleton. Never returns null, so no caller
 * needs a null branch — a missing document means "defaults", not "broken".
 */
emailProviderSettingsSchema.statics.getSettings = async function getSettings({
  withSecrets = false,
} = {}) {
  const q = this.findOne({ key: "GLOBAL" });
  if (withSecrets) q.select("+resend.apiKey +countries.resendApiKey");
  let doc = await q;
  if (!doc) {
    doc = await this.create({ key: "GLOBAL" });
    if (withSecrets) {
      doc = await this.findOne({ key: "GLOBAL" }).select(
        "+resend.apiKey +countries.resendApiKey",
      );
    }
  }
  return doc;
};

/**
 * Resolve the sender identity for a country, walking:
 *   country override → provider default → env → hardcoded fallback.
 */
emailProviderSettingsSchema.methods.senderFor = function senderFor(
  countryCode,
  country,
  provider = "SMTP",
) {
  const entry = (this.countries || []).find(
    (c) => c.countryCode === countryCode && c.isActive !== false,
  );

  // ── PROVIDER-AWARE FALLBACK ───────────────────────────────────────────
  // These two providers need fundamentally different fallbacks, and using
  // one chain for both is what produced the "gmail.com domain is not
  // verified" 403.
  //
  // SMTP authenticates AS a mailbox, so EMAIL_USER is the correct sender —
  // it is the account doing the sending.
  //
  // RESEND authenticates with an API key and sends AS a domain it has
  // verified. EMAIL_USER is a Gmail login, and gmail.com can never be
  // verified because we do not own it. Falling back to it guarantees a 403.
  // So for Resend the last resort is the COUNTRY'S OWN DOMAIN — which is
  // exactly the set of domains verified in Resend — rather than a mailbox
  // login that has nothing to do with sending identity.
  const domainFallback = country?.domain ? `orders@${country.domain}` : "";

  const fromEmail =
    entry?.fromEmail ||
    this.resend?.defaultFromEmail ||
    (provider === "RESEND"
      ? domainFallback
      : process.env[`EMAIL_USER_${countryCode}`] ||
        process.env.EMAIL_USER ||
        domainFallback) ||
    "";

  const fromName =
    entry?.fromName ||
    process.env[`EMAIL_FROM_NAME_${countryCode}`] ||
    (country?.name ? `I-Coffee ${country.name}` : this.resend?.defaultFromName) ||
    "I-Coffee";

  return {
    fromEmail,
    fromName,
    replyTo: entry?.replyTo || undefined,
    countryApiKey: entry?.resendApiKey || undefined,
  };
};

const EmailProviderSettingsModel = mongoose.model(
  "EmailProviderSettings",
  emailProviderSettingsSchema,
);

export default EmailProviderSettingsModel;
