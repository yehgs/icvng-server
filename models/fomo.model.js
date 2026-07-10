// server/models/fomo.model.js
import mongoose from "mongoose";
import countryScopedPlugin from "../core/countryScopedPlugin.js";

const dummyUserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    avatar: { type: String, default: "" }, // URL or initials fallback
    state: { type: String, default: "Lagos" }, // Nigerian state
    isActive: { type: Boolean, default: true },

    // ── Purchase details (shown in the FOMO toast) ─────────────────────────
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    productName: { type: String, default: "" }, // denormalized for fast display
    productImage: { type: String, default: "" },
    price: { type: Number, default: 0 }, // unit price at time of "purchase"
    quantity: { type: Number, default: 1 },
    purchasedAt: { type: Date, default: Date.now }, // used to compute "x time ago"
  },
  { _id: true },
);

const fomoSettingsSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },

    // Animation
    animationType: {
      type: String,
      enum: ["fade", "slide", "bounce"],
      default: "fade",
    },
    position: {
      type: String,
      enum: ["bottom-left", "bottom-right", "top-left", "top-right"],
      default: "bottom-left",
    },
    displayDurationMs: { type: Number, default: 5000, min: 1000 }, // how long it stays visible
    pauseBetweenMs: { type: Number, default: 8000, min: 1000 }, // gap between toasts
    fadeInMs: { type: Number, default: 600, min: 100 },
    fadeOutMs: { type: Number, default: 600, min: 100 },

    // Data
    useDummyUsers: { type: Boolean, default: false }, // mix dummy users with real data
    maxRealPurchases: { type: Number, default: 20 }, // recent orders to pull from DB

    // Translatable: the popup label shown above the purchase notification
    // e.g. "Just purchased" / "Vient d'acheter" / "Ha appena acquistato"
    // Left blank on purpose: an empty value lets the storefront show the
    // translated "Just purchased" label per visitor language (t('fomo.justPurchased'))
    // instead of a literal English default being stamped onto every new
    // country's settings doc and permanently overriding it.
    notificationMessage: { type: String, default: "" },

    dummyUsers: [dummyUserSchema],

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);


// PHASE 3: country dimension + isolation hooks
fomoSettingsSchema.plugin(countryScopedPlugin);

const FomoModel = mongoose.model("FomoSettings", fomoSettingsSchema);
export default FomoModel;
