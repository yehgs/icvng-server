// models/paymentIntent.model.js
//
// Paystack's checkout API echoes back an arbitrary `metadata` object at
// verify/webhook time (see order.controller.js's paystackPaymentController/
// createOrderFromGatewayTransaction) — that's what lets this app build the
// order from data snapshotted at INITIATION time rather than trusting
// whatever the live cart looks like minutes later.
//
// CinetPay's "Check Payment Status" response only round-trips a single
// string `metadata` field (see CinetPay's checkout docs), not the rich
// object (userId, addressId, shipping, gift card, cart snapshot) this app
// needs. Rather than cram JSON into that one string field and hope it never
// exceeds whatever undocumented length limit CinetPay enforces, this model
// stores that same metadata shape server-side, keyed by OUR OWN
// transaction_id — created at cinetpayPaymentController time, read back by
// cinetpayWebhookController/verifyCinetpayController exactly the way
// Paystack's metadata argument is read today.
//
// Deliberately generic (not CinetPay-only) so a future indigenous gateway
// with the same "no rich metadata round-trip" limitation reuses this
// instead of inventing another one-off table.

import mongoose from "mongoose";

const paymentIntentSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    provider: { type: String, required: true }, // "CINETPAY"
    countryCode: { type: String, required: true },
    currencyCode: { type: String, required: true },

    // Same shape as the `metadata` object Paystack's checkout API is given
    // and echoes back — see paystackPaymentController's paymentData.metadata
    // and createOrderFromGatewayTransaction's use of it.
    metadata: { type: mongoose.Schema.Types.Mixed, required: true },

    status: {
      type: String,
      enum: ["PENDING", "CONFIRMED", "FAILED"],
      default: "PENDING",
      index: true,
    },
  },
  { timestamps: true },
);

// Auto-expire abandoned intents (never confirmed) after 7 days — this is a
// short-lived handoff record, not an audit trail (PaymentFailureModel is
// the audit trail for anything that goes wrong after a real charge).
paymentIntentSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });

const PaymentIntentModel = mongoose.model("PaymentIntent", paymentIntentSchema);

export default PaymentIntentModel;
