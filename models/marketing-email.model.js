// server/models/marketing-email.model.js
//
// One bulk e-mail campaign to a country's customers. (Named "MarketingEmail" so
// it can never be confused with the seasonal `Campaign` model.)
// Country is fixed at creation and enforced by utils/featureScope.js.
import mongoose from "mongoose";
import { countryField } from "../config/countrySchema.js";

export const MARKETING_STATUSES = ["DRAFT", "SENDING", "SENT", "FAILED", "CANCELLED"];
export const AUDIENCE_SOURCES = ["USERS", "CUSTOMERS", "SUBSCRIBERS"];

const historySchema = new mongoose.Schema(
  { at: Date, by: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, byName: String, action: String, note: String },
  { _id: false },
);

const marketingEmailSchema = new mongoose.Schema(
  {
    ...countryField,
    name: { type: String, required: true, trim: true, maxlength: 120 },
    subject: { type: String, required: true, trim: true, maxlength: 150 },
    preheader: { type: String, trim: true, maxlength: 150, default: "" },
    language: { type: String, enum: ["en", "fr", "it"], default: "en" }, // footer / button wording
    template: {
      headline: { type: String, trim: true, maxlength: 150, default: "" },
      body: { type: String, maxlength: 8000, default: "" }, // markdown-lite, rendered + escaped server-side
      ctaLabel: { type: String, trim: true, maxlength: 60, default: "" },
      ctaUrl: { type: String, trim: true, maxlength: 500, default: "" },
      heroImage: { type: String, trim: true, maxlength: 500, default: "" },
      accentColor: { type: String, default: "#8B4513" },
      footerNote: { type: String, trim: true, maxlength: 300, default: "" },
      productIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "product" }],
    },
    audience: {
      sources: { type: [String], enum: AUDIENCE_SOURCES, default: AUDIENCE_SOURCES },
      customerTypes: { type: [String], enum: ["BTC", "BTB"], default: [] }, // [] = all
      verifiedOnly: { type: Boolean, default: true },
    },
    status: { type: String, enum: MARKETING_STATUSES, default: "DRAFT", index: true },
    stats: {
      total: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
      pending: { type: Number, default: 0 },
    },
    sendStartedAt: { type: Date, default: null },
    sendCompletedAt: { type: Date, default: null },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true },
);
marketingEmailSchema.index({ countryCode: 1, createdAt: -1 });

export default mongoose.models.MarketingEmail || mongoose.model("MarketingEmail", marketingEmailSchema);
