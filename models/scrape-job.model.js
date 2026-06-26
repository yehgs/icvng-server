//server
// models/scrape-job.model.js  (updated — quotaUsed, leadType, B2C)
import mongoose from "mongoose";

export const SCRAPE_PLATFORMS = [
  "Google Search",
  "Google Maps",
  "Facebook",
  "LinkedIn",
  "Instagram",
  "Twitter / X",
  "Yellow Pages NG",
  "VConnect NG",
  "Jobberman",
  "Custom URL",
];

// B2C (individual people) vs B2B (companies/shops)
export const LEAD_TYPES = ["B2B", "B2C"];

const scrapeJobSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    platform: {
      type: String,
      enum: SCRAPE_PLATFORMS,
      default: "Google Search",
    },
    leadType: { type: String, enum: LEAD_TYPES, default: "B2B" },
    targetUrl: { type: String, default: "" },
    searchQuery: { type: String, default: "" },
    maxPages: { type: Number, default: 3 },
    maxResults: { type: Number, default: 50 },

    extractFields: {
      emails: { type: Boolean, default: true },
      phones: { type: Boolean, default: true },
      companyName: { type: Boolean, default: true },
      website: { type: Boolean, default: true },
      address: { type: Boolean, default: true },
      socialLinks: { type: Boolean, default: true },
      // B2C-specific
      fullName: { type: Boolean, default: false },
      jobTitle: { type: Boolean, default: false },
    },

    status: {
      type: String,
      enum: ["pending", "running", "completed", "failed", "cancelled"],
      default: "pending",
    },
    progress: { type: Number, default: 0 },
    totalFound: { type: Number, default: 0 },
    totalImported: { type: Number, default: 0 },
    errorMessage: { type: String, default: "" },

    // API calls consumed by this job (for quota tracking)
    apiCallsUsed: { type: Number, default: 0 },

    rawResults: [{ type: mongoose.Schema.Types.Mixed }],

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    createdByName: String,
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

scrapeJobSchema.index({ createdBy: 1, createdAt: -1 });

const ScrapeJobModel = mongoose.model("ScrapeJob", scrapeJobSchema);
export default ScrapeJobModel;
