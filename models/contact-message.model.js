/**
 * models/contact-message.model.js
 *
 * Item #1 — persists ContactForm submissions (contact + partner forms) so
 * they're visible in the admin panel, not just emailed and forgotten.
 *
 * countryScopedPlugin makes this country-isolated automatically:
 *   - Stamped explicitly with countryCode = req.countryCode at creation
 *     time (public submit route has no admin countryScope context).
 *   - Auto-filtered on every admin read/write once a COUNTRY-scoped admin's
 *     request context is set (via the countryScope middleware) — so a
 *     Togo-scoped admin's list query is transparently narrowed to
 *     { countryCode: "TG", ...} even if the controller forgets to filter.
 *   - GLOBAL admins (IT, DIRECTOR) are never filtered — they see every
 *     country's messages.
 */

import mongoose from "mongoose";
import countryScopedPlugin from "../core/countryScopedPlugin.js";

const contactMessageSchema = new mongoose.Schema(
  {
    formType: { type: String, enum: ["contact", "partner"], required: true, index: true },

    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    company: { type: String, default: "" },
    subject: { type: String, default: "" },
    message: { type: String, required: true },
    howDidYouHear: { type: String, default: "" },
    preferredContact: { type: String, enum: ["email", "phone", "whatsapp"], default: "email" },

    // Partner-form-only fields
    businessType: { type: String, default: "" },
    productCategories: { type: String, default: "" },

    // Triage — lets admins mark progress without leaving the panel.
    status: {
      type: String,
      enum: ["NEW", "IN_PROGRESS", "RESOLVED", "ARCHIVED"],
      default: "NEW",
      index: true,
    },

    // The language the visitor was using when they submitted (en/fr/it) —
    // useful context for whichever admin replies.
    submittedLanguage: { type: String, default: "en" },
  },
  { timestamps: true }
);

contactMessageSchema.plugin(countryScopedPlugin);

contactMessageSchema.index({ countryCode: 1, status: 1, createdAt: -1 });

const ContactMessageModel = mongoose.model("ContactMessage", contactMessageSchema);

export default ContactMessageModel;
