// server/models/hr/hr-settings.model.js — per-country payroll identity: logo, signatory, signature.
import mongoose from "mongoose";

const settingsSchema = new mongoose.Schema(
  {
    countryCode: { type: String, required: true, unique: true },
    companyName: { type: String, trim: true, maxlength: 120, default: "" },
    companyAddress: { type: String, trim: true, maxlength: 300, default: "" },
    logoUrl: { type: String, trim: true, maxlength: 500, default: "" },
    signatureUrl: { type: String, trim: true, maxlength: 500, default: "" },
    signerName: { type: String, trim: true, maxlength: 100, default: "" },
    signerTitle: { type: String, trim: true, maxlength: 100, default: "" },
    payslipFooter: { type: String, trim: true, maxlength: 300, default: "" },
    payrollNotifyEmails: { type: [String], default: [] }, // receive the payroll summary (e.g. finance/director)
    workingDaysPerMonth: { type: Number, min: 15, max: 31, default: 22 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
export default mongoose.models.HrSettings || mongoose.model("HrSettings", settingsSchema);
