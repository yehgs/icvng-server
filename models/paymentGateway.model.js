// models/paymentGateway.model.js
//
// Country-scoped "indigenous payment gateway" settings — the CinetPay
// equivalent of models/bankTransferSettings.model.js, generalized to a
// `provider` field so a second local gateway (a different country's
// mobile-money aggregator, say) is a new enum value here, not a new
// collection.
//
// One document per {countryCode, provider}. Managed by:
//   - IT/DIRECTOR (payments.view/payments.manageCountry via WILDCARD) — any
//     country.
//   - A country-scoped MANAGER holding payments.manageCountry — ONLY their
//     own assignedCountry (enforced in controllers/paymentGateway.controller.js
//     via middleware/countryScope.js's assertCountryAccess + buildCountryFilter,
//     the same tool bankTransferSettings deliberately does NOT use for
//     MANAGER — that route stays HQ-only; this one is intentionally the
//     first to let a country-scoped role write its own row).
//
// If a country has no active row here, checkout for that country falls back
// to Stripe by default — see config/paymentRouter.js#getPaymentConfig,
// which is what actually decides checkout's availableProviders/defaultProvider.
//
// Credentials are encrypted at rest (utils/encryption.js) — these are live
// merchant secrets, not the kind of thing to leave as plain Mongo strings.
// Use the schema's own getDecryptedCredentials() method to read them back;
// never read `credentials.apiKey`/`credentials.siteId` directly outside
// this model.

import mongoose from "mongoose";
import { ALL_COUNTRY_CODES } from "../config/countries/index.js";
import { encryptSecret, decryptSecret } from "../utils/encryption.js";

export const PAYMENT_GATEWAY_PROVIDERS = ["cinetpay"];

const paymentGatewaySchema = new mongoose.Schema(
  {
    countryCode: {
      type: String,
      required: true,
      enum: ALL_COUNTRY_CODES,
      uppercase: true,
    },
    provider: {
      type: String,
      required: true,
      enum: PAYMENT_GATEWAY_PROVIDERS,
    },

    // Toggle without deleting — same pattern as bankTransferSettings.isActive.
    isActive: {
      type: Boolean,
      default: true,
    },

    // When active, this provider is preselected at checkout for this
    // country (e.g. CinetPay for TG/BJ, matching Paystack's existing
    // default-in-Nigeria behavior). Exactly one provider per country
    // should carry isDefault: true among the country's non-Stripe options;
    // Stripe itself is never stored here — it's config-level, always
    // available as the fallback (config/countries/index.js payments.stripe).
    isDefault: {
      type: Boolean,
      default: true,
    },

    // ── Encrypted credentials ────────────────────────────────────────────
    // Stored ciphertext only — encryptCredentials() below is the one place
    // that turns plaintext into what's saved here; the admin controller
    // calls it explicitly before every write. See the "no pre-save hook"
    // comment further down for why this isn't done via a schema hook.
    credentials: {
      apiKey: { type: String, default: "" }, // CinetPay "apikey"
      siteId: { type: String, default: "" }, // CinetPay "site_id"
    },

    // CinetPay supports a sandbox/test mode distinct from PRODUCTION —
    // surfaced so a country manager can verify the integration against
    // CinetPay's test credentials before flipping isActive on for real
    // shoppers.
    mode: {
      type: String,
      enum: ["PRODUCTION", "TEST"],
      default: "PRODUCTION",
    },

    updatedBy: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

paymentGatewaySchema.index({ countryCode: 1, provider: 1 }, { unique: true });

// ── Deliberately NO pre-save auto-encrypt hook ──────────────────────────
// A "does this already look encrypted?" regex guard is exactly the kind of
// heuristic that silently stores a real secret as plain text the one time
// a plaintext CinetPay apikey happens to match the pattern. The single
// write path (controllers/paymentGateway.controller.js, via
// findOneAndUpdate — which does not run document 'save' middleware anyway)
// calls encryptSecret()/encryptCredentials() below explicitly instead, so
// there is exactly one place that decides "this is plaintext, encrypt it"
// and it is never guessing.

/** Encrypt a plaintext { apiKey, siteId } pair for storage. */
export function encryptCredentials({ apiKey, siteId }) {
  return {
    apiKey: apiKey ? encryptSecret(apiKey) : "",
    siteId: siteId ? encryptSecret(siteId) : "",
  };
}

/**
 * Returns { apiKey, siteId } decrypted — the only sanctioned way to read
 * usable credentials back out of a document.
 */
paymentGatewaySchema.methods.getDecryptedCredentials = function () {
  return {
    apiKey: decryptSecret(this.credentials?.apiKey || ""),
    siteId: decryptSecret(this.credentials?.siteId || ""),
  };
};

/**
 * Convenience static used by the checkout-time payment resolver
 * (config/paymentRouter.js) — one query, decrypted, or null if the
 * country has no active row for this provider.
 */
paymentGatewaySchema.statics.getActiveForCountry = async function (countryCode, provider) {
  const doc = await this.findOne({
    countryCode: (countryCode || "").toUpperCase(),
    provider,
    isActive: true,
  });
  if (!doc) return null;
  return { doc, credentials: doc.getDecryptedCredentials() };
};

const PaymentGatewayModel = mongoose.model("PaymentGateway", paymentGatewaySchema);

export default PaymentGatewayModel;
