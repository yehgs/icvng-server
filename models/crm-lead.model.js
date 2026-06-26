//server
// models/crm-lead.model.js  (updated — deleteRequest workflow)
import mongoose from "mongoose";

export const CRM_STAGES = [
  "New",
  "Contacted",
  "Qualified",
  "Proposal Sent",
  "Negotiation",
  "Won",
  "Lost",
  "On Hold",
];

export const LEAD_SOURCES = [
  "Google Search",
  "Google Maps",
  "Facebook",
  "LinkedIn",
  "Instagram",
  "Twitter / X",
  "Website Scrape",
  "Manual Entry",
  "Referral",
  "Cold Outreach",
  "Trade Show",
  "Other",
];

export const LEAD_INDUSTRIES = [
  "Technology",
  "Food & Beverage",
  "Hospitality",
  "Retail",
  "Healthcare",
  "Finance",
  "Education",
  "Logistics",
  "Manufacturing",
  "Real Estate",
  "Agriculture",
  "Media & Entertainment",
  "NGO / Non-profit",
  "Government",
  "Other",
];

const activitySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        "note",
        "call",
        "email",
        "meeting",
        "stage_change",
        "task",
        "system",
      ],
      default: "note",
    },
    content: { type: String, required: true },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    performedByName: String,
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

// Delete request sub-schema — raised by non-IT/Director users
const deleteRequestSchema = new mongoose.Schema(
  {
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    requestedByName: String,
    requestedBySubRole: String,
    reason: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedByName: { type: String, default: null },
    reviewNote: { type: String, default: "" },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const crmLeadSchema = new mongoose.Schema(
  {
    // ── Identity ───────────────────────────────────────────────────────────
    companyName: { type: String, default: "" },
    contactName: { type: String, default: "" },
    jobTitle: { type: String, default: "" },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
    website: { type: String, default: "" },
    address: { type: String, default: "" },
    city: { type: String, default: "" },
    country: { type: String, default: "Nigeria" },
    industry: { type: String, default: "Other" },
    companySize: { type: String, default: "" },

    // ── Social ────────────────────────────────────────────────────────────
    linkedinUrl: { type: String, default: "" },
    facebookUrl: { type: String, default: "" },
    instagramUrl: { type: String, default: "" },
    twitterUrl: { type: String, default: "" },

    // ── CRM Pipeline ──────────────────────────────────────────────────────
    stage: { type: String, enum: CRM_STAGES, default: "New" },
    source: { type: String, enum: LEAD_SOURCES, default: "Manual Entry" },
    dealValue: { type: Number, default: 0 },
    currency: { type: String, default: "NGN" },
    probability: { type: Number, min: 0, max: 100, default: 0 },
    expectedCloseDate: { type: Date, default: null },

    // ── Assignment ────────────────────────────────────────────────────────
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    assignedToName: { type: String, default: "" },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    createdByName: { type: String, default: "" },

    // ── Scrape metadata ───────────────────────────────────────────────────
    scrapeJobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ScrapeJob",
      default: null,
    },
    scrapeSource: { type: String, default: "" },
    rawScrapedData: { type: mongoose.Schema.Types.Mixed, default: {} },

    // ── Notes / Activities ─────────────────────────────────────────────────
    activities: [activitySchema],
    tags: [{ type: String }],
    notes: { type: String, default: "" },

    // ── Lifecycle ─────────────────────────────────────────────────────────
    isArchived: { type: Boolean, default: false },
    isConverted: { type: Boolean, default: false },
    lastContactedAt: { type: Date, default: null },
    nextFollowUpDate: { type: Date, default: null },

    // ── Delete request workflow ────────────────────────────────────────────
    // Non-IT/Director users raise a request; IT/Director approves/rejects
    pendingDeleteRequest: { type: deleteRequestSchema, default: null },
  },
  { timestamps: true },
);

crmLeadSchema.index({ stage: 1, createdBy: 1 });
crmLeadSchema.index({ email: 1 });
crmLeadSchema.index({
  companyName: "text",
  contactName: "text",
  email: "text",
});

const CrmLeadModel = mongoose.model("CrmLead", crmLeadSchema);
export default CrmLeadModel;
