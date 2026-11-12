// server/models/hr/hr-leave.model.js
import mongoose from "mongoose";
import { countryField } from "../../config/countrySchema.js";

export const LEAVE_TYPES = ["ANNUAL", "SICK", "MATERNITY", "PATERNITY", "COMPASSIONATE", "STUDY", "UNPAID"];
export const LEAVE_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"];

const leaveSchema = new mongoose.Schema(
  {
    ...countryField,
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: "HrStaff", required: true, index: true },
    type: { type: String, enum: LEAVE_TYPES, required: true },
    from: { type: String, required: true }, // YYYY-MM-DD inclusive
    to: { type: String, required: true },
    days: { type: Number, required: true, min: 0.5 }, // working days (Mon–Fri, minus holidays)
    reason: { type: String, maxlength: 500, default: "" },
    status: { type: String, enum: LEAVE_STATUSES, default: "PENDING", index: true },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, maxlength: 300, default: "" },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
leaveSchema.index({ countryCode: 1, status: 1, from: 1 });
export default mongoose.models.HrLeave || mongoose.model("HrLeave", leaveSchema);
