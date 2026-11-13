// server/models/social-page.model.js
// A social-media page card shown in the storefront's "Coffee Stories" section (and the mobile app).
// countryCode is a real country (NG/TG/BJ/IT) or "ALL" — an entry IT/Director publish for every market.
import mongoose from "mongoose";

export const SOCIAL_PLATFORMS = ["FACEBOOK", "INSTAGRAM", "X", "TIKTOK", "YOUTUBE", "LINKEDIN", "WHATSAPP", "TELEGRAM", "OTHER"];

const socialPageSchema = new mongoose.Schema(
  {
    countryCode: { type: String, required: true, uppercase: true, trim: true, index: true },
    platform: { type: String, enum: SOCIAL_PLATFORMS, required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    handle: { type: String, trim: true, maxlength: 60, default: "" },
    url: { type: String, required: true, trim: true, maxlength: 500 },
    description: { type: String, trim: true, maxlength: 200, default: "" },
    imageUrl: { type: String, trim: true, maxlength: 500, default: "" },
    followersLabel: { type: String, trim: true, maxlength: 30, default: "" },
    // Facebook only: also render the official Page Plugin (live feed) inside the card.
    showFeed: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
socialPageSchema.index({ countryCode: 1, isActive: 1, sortOrder: 1 });

export default mongoose.models.SocialPage || mongoose.model("SocialPage", socialPageSchema);
