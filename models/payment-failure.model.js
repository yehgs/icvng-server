/**
 * models/payment-failure.model.js
 *
 * WHY THIS EXISTS
 * ───────────────
 * On 2026-08-28 a live Nigerian customer paid NGN 51,182.45 through Paystack
 * (ref PSK-1787910602350-6a9144dbaa567b1ecde5a3ea). Paystack recorded the
 * charge as successful. No order was ever created, in any country, and
 * nothing anywhere recorded that fact — the money existed at the gateway and
 * nowhere else. Root cause was a ReferenceError inside
 * createOrderFromPaystackTransaction, which the webhook handler caught and
 * merely console.error()'d before returning 200 to Paystack.
 *
 * A console line on a serverless host is not an audit trail. This collection
 * is: every time a payment is confirmed at the gateway but order creation
 * fails, we persist the reference, the metadata, and the error, so the money
 * is always reconcilable against something durable.
 *
 * It is COUNTRY-SCOPED so each country's finance/IT staff sees only their own
 * orphaned payments, while IT/DIRECTOR see all of them.
 *
 * Operational contract:
 *   - `resolved: false` rows are an alert condition. Surface them on the admin
 *     dashboard and treat a non-zero count as a P1.
 *   - scripts/recoverOrphanPaystackOrders.js replays these into real orders.
 */

import mongoose from "mongoose";
import countryScopedPlugin from "../core/countryScopedPlugin.js";

const paymentFailureSchema = new mongoose.Schema(
  {
    // Gateway reference — the single durable link back to the money.
    reference: { type: String, required: true, index: true },

    provider: {
      type: String,
      enum: ["PAYSTACK", "STRIPE", "BANK_TRANSFER"],
      required: true,
      index: true,
    },

    // Which stage failed. Useful for triage: a VERIFY failure means we never
    // even confirmed the charge; ORDER_CREATION means the money is real.
    stage: {
      type: String,
      enum: ["VERIFY", "ORDER_CREATION", "EMAIL", "UNKNOWN"],
      default: "ORDER_CREATION",
      index: true,
    },

    // Everything needed to replay the order creation later.
    userId: { type: mongoose.Schema.ObjectId, ref: "User", default: null, index: true },
    customerEmail: { type: String, trim: true, lowercase: true },
    amount: { type: Number, default: 0 },
    currency: { type: String, default: "NGN" },

    // Raw gateway metadata (cart snapshot, addressId, shippingMethodId...).
    // Stored as Mixed so a metadata shape change never blocks the record —
    // the whole point is that this write must never itself fail.
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

    errorMessage: { type: String },
    errorStack: { type: String },

    // Set once an order has been created for this reference.
    resolved: { type: Boolean, default: false, index: true },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: mongoose.Schema.ObjectId, ref: "User", default: null },
    resolvedOrderGroupId: { type: String, default: null },
    resolutionNote: { type: String },

    // How many times we have seen this same reference fail (webhook retries).
    attempts: { type: Number, default: 1 },
    lastAttemptAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// One row per gateway reference; repeated failures bump `attempts` instead of
// creating duplicates (Paystack retries a webhook several times).
paymentFailureSchema.index({ reference: 1, provider: 1 }, { unique: true });
paymentFailureSchema.index({ resolved: 1, createdAt: -1 });

paymentFailureSchema.plugin(countryScopedPlugin);

/**
 * Record (or bump) a failure. Deliberately swallows its own errors: this is a
 * safety net, and a safety net that can throw would take down the very
 * handler it exists to protect.
 */
paymentFailureSchema.statics.record = async function record({
  reference,
  provider = "PAYSTACK",
  stage = "ORDER_CREATION",
  countryCode,
  userId,
  customerEmail,
  amount,
  currency,
  metadata,
  error,
}) {
  try {
    return await this.findOneAndUpdate(
      { reference, provider },
      {
        $setOnInsert: {
          reference,
          provider,
          countryCode: countryCode || "NG",
          userId: userId || null,
          customerEmail,
          amount,
          currency,
          metadata: metadata || {},
        },
        $set: {
          stage,
          errorMessage: error?.message || String(error || "unknown"),
          errorStack: error?.stack,
          lastAttemptAt: new Date(),
        },
        $inc: { attempts: 1 },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (e) {
    console.error("[PaymentFailure] could not persist failure record:", e.message);
    return null;
  }
};

/** Mark a reference resolved once an order group exists for it. */
paymentFailureSchema.statics.resolve = async function resolve(
  reference,
  { orderGroupId, userId, note } = {},
) {
  try {
    return await this.findOneAndUpdate(
      { reference, resolved: false },
      {
        $set: {
          resolved: true,
          resolvedAt: new Date(),
          resolvedBy: userId || null,
          resolvedOrderGroupId: orderGroupId || null,
          resolutionNote: note || "Order created successfully",
        },
      },
      { new: true },
    );
  } catch (e) {
    console.error("[PaymentFailure] could not resolve record:", e.message);
    return null;
  }
};

const PaymentFailureModel = mongoose.model("PaymentFailure", paymentFailureSchema);
export default PaymentFailureModel;
