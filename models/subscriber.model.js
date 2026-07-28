/**
 * models/subscriber.model.js
 *
 * Item #1 — the footer newsletter form (Footer.jsx `handleSubmit`) currently
 * just shows a toast and throws the email away. This gives it somewhere
 * real to land, country-scoped the same way as ContactMessage: a Togo
 * admin sees only Togo subscribers, IT/DIRECTOR see everyone.
 */

import mongoose from "mongoose";
import countryScopedPlugin from "../core/countryScopedPlugin.js";

const subscriberSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true },
    source: { type: String, default: "footer" }, // where they signed up, for future forms
    isActive: { type: Boolean, default: true },  // false once they unsubscribe
    unsubscribedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

subscriberSchema.plugin(countryScopedPlugin);

// One active subscription per (email, country) — resubscribing after
// unsubscribing just flips isActive back on rather than creating a dupe.
subscriberSchema.index({ email: 1, countryCode: 1 }, { unique: true });

const SubscriberModel = mongoose.model("Subscriber", subscriberSchema);

export default SubscriberModel;
