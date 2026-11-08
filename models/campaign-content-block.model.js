// server/models/campaign-content-block.model.js
//
// Ordered, editable storefront content for a campaign: hero banner, promo
// strip, featured products/categories, gift collection, countdown. Kept in its
// own collection (not embedded in Campaign) so the existing translation
// pipeline — which translates flat fields of one entity — can translate each
// block's copy (entityType "campaignBlock": heading, subtitle, ctaLabel).
//
// Text is sanitised and URLs are validated in utils/campaignValidation.js
// before they ever reach this model: only safe internal routes ("/…") or
// HTTPS URLs are accepted for ctaUrl / images.

import mongoose from "mongoose";
import countryScopedPlugin from "../core/countryScopedPlugin.js";

export const BLOCK_TYPES = [
  "HERO",
  "PROMO_STRIP",
  "FEATURED_PRODUCTS",
  "FEATURED_CATEGORIES",
  "GIFT_COLLECTION",
  "COUNTDOWN",
];

const campaignContentBlockSchema = new mongoose.Schema(
  {
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true, index: true },
    type: { type: String, enum: BLOCK_TYPES, required: true },
    order: { type: Number, default: 0 },
    isVisible: { type: Boolean, default: true },

    heading: { type: String, default: "", trim: true, maxlength: 140 },
    subtitle: { type: String, default: "", trim: true, maxlength: 300 },
    ctaLabel: { type: String, default: "", trim: true, maxlength: 40 },
    ctaUrl: { type: String, default: "", trim: true, maxlength: 500 },

    image: { type: String, default: "" },
    mobileImage: { type: String, default: "" },
    // Reserve space so the banner never causes layout shift.
    imageWidth: { type: Number, default: 0, min: 0 },
    imageHeight: { type: Number, default: 0, min: 0 },

    productIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
    categoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "category" }],

    // Optional own window inside the campaign window; null = inherit.
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

campaignContentBlockSchema.index({ countryCode: 1, campaignId: 1, order: 1 });
campaignContentBlockSchema.plugin(countryScopedPlugin);

const CampaignContentBlockModel =
  mongoose.models.CampaignContentBlock ||
  mongoose.model("CampaignContentBlock", campaignContentBlockSchema);
export default CampaignContentBlockModel;
