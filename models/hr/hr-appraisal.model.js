// server/models/hr/hr-appraisal.model.js — performance review.
import mongoose from "mongoose";
import { countryField } from "../../config/countrySchema.js";

export const APPRAISAL_STATUSES = ["DRAFT", "SUBMITTED", "ACKNOWLEDGED"];
export const APPRAISAL_ACTIONS = ["NONE", "INCREMENT", "PROMOTION", "BONUS", "TRAINING", "PIP", "CONFIRMATION"];

const appraisalSchema = new mongoose.Schema(
  {
    ...countryField,
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: "HrStaff", required: true, index: true },
    period: { type: String, required: true, trim: true, maxlength: 30 }, // e.g. 2026-H2, 2026-Q4
    cycle: { type: String, enum: ["PROBATION", "QUARTERLY", "HALF_YEARLY", "ANNUAL"], default: "ANNUAL" },
    reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewerName: { type: String, default: "" },
    goals: { type: [{ _id: false, title: { type: String, trim: true, maxlength: 150 }, weight: { type: Number, min: 0, max: 100, default: 0 }, score: { type: Number, min: 0, max: 5, default: 0 }, comment: { type: String, maxlength: 300, default: "" } }], default: [] },
    competencies: { type: [{ _id: false, name: { type: String, trim: true, maxlength: 80 }, rating: { type: Number, min: 0, max: 5, default: 0 } }], default: [] },
    overallRating: { type: Number, min: 0, max: 5, default: 0 }, // computed server-side
    strengths: { type: String, maxlength: 1500, default: "" },
    improvements: { type: String, maxlength: 1500, default: "" },
    comments: { type: String, maxlength: 1500, default: "" },
    recommendedAction: { type: String, enum: APPRAISAL_ACTIONS, default: "NONE" },
    status: { type: String, enum: APPRAISAL_STATUSES, default: "DRAFT", index: true },
    submittedAt: { type: Date, default: null },
    acknowledgedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
appraisalSchema.index({ staffId: 1, period: 1 }, { unique: true });
export default mongoose.models.HrAppraisal || mongoose.model("HrAppraisal", appraisalSchema);
