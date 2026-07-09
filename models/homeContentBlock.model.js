// server/models/homeContentBlock.model.js
import mongoose from "mongoose";
import countryScopedPlugin from "../core/countryScopedPlugin.js";

/**
 * A single content-managed model backing homepage/site sections that used
 * to be hardcoded JSX or scattered across the Country model: the header
 * preheader banner, footer contact details, the trust-badge strip (Free
 * Shipping / Coffee Subscription / Expert Support), and the customer
 * testimonials grid. More page sections will be added here over time as
 * the same pattern — country-scoped, translatable, admin-editable — so
 * this model and its admin page are deliberately named generically rather
 * than "home" specific.
 *
 * Each block belongs to exactly one country (countryScopedPlugin) — an
 * editor assigned to Togo adds Togo-flavoured testimonials/badges/contact
 * info, and the storefront falls back to HQ's (Nigeria's) blocks if a
 * market hasn't set up its own yet.
 *
 * Translatable fields go through the same Translation collection as
 * everything else (entityType: "homeContentBlock").
 */
const homeContentBlockSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["trustBadge", "testimonial", "header", "footer"],
      required: true,
    },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },

    // ── Trust badge fields ──────────────────────────────────────────────
    icon: { type: String, default: "truck" }, // lucide icon key: truck | package | help-circle | ...
    title: { type: String, default: "" },
    description: { type: String, default: "" },

    // ── Testimonial fields ──────────────────────────────────────────────
    customerName: { type: String, default: "" },
    customerLocation: { type: String, default: "" },
    customerInitials: { type: String, default: "" },
    rating: { type: Number, min: 1, max: 5, default: 5 },
    quote: { type: String, default: "" },
    badge: { type: String, default: "" }, // e.g. "Fast delivery", "Trusted & secure"

    // ── Header fields (type: "header") — one active block per country ───
    message: { type: String, default: "" }, // the preheader promo banner text

    // ── Footer fields (type: "footer") — one active block per country ───
    contactAddress: { type: String, default: "" },
    contactPhone: { type: String, default: "" },
    contactEmail: { type: String, default: "" },
    contactWhatsapp: { type: String, default: "" },
  },
  { timestamps: true },
);

homeContentBlockSchema.index({ type: 1, isActive: 1, order: 1 });

// Country dimension + isolation hooks
homeContentBlockSchema.plugin(countryScopedPlugin);

const HomeContentBlockModel = mongoose.model("HomeContentBlock", homeContentBlockSchema);
export default HomeContentBlockModel;
