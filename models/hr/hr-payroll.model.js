// server/models/hr/hr-payroll.model.js
//
// A payroll run for one country + month. Each line is a SNAPSHOT (name, employee id, bank
// details, amounts) taken when the run is created/recalculated, so editing a staff record
// later never rewrites a paid or approved run. Money is stored in MINOR units (integers).
import mongoose from "mongoose";
import { countryField } from "../../config/countrySchema.js";

export const PAYROLL_STATUSES = ["DRAFT", "APPROVED", "PAID"];
const lineItem = { _id: false, name: String, amount: Number };

const lineSchema = new mongoose.Schema(
  {
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: "HrStaff", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    employeeId: String,
    fullName: String,
    email: String, // where the payslip is e-mailed (work e-mail)
    jobTitle: String,
    department: String,
    bank: { bankName: String, accountName: String, accountNumber: String, branch: String, sortCode: String, taxId: String, pensionId: String },
    baseSalary: Number,
    allowances: [lineItem],
    bonus: { type: Number, default: 0 },
    overtime: { type: Number, default: 0 },
    unpaidLeaveDays: { type: Number, default: 0 },
    unpaidLeaveDeduction: { type: Number, default: 0 },
    deductions: [lineItem],
    otherDeductions: { type: Number, default: 0 },
    gross: Number,
    totalDeductions: Number,
    net: Number,
    note: { type: String, default: "" },
    payslipSentAt: { type: Date, default: null },
  },
  { _id: false },
);

const payrollSchema = new mongoose.Schema(
  {
    ...countryField,
    period: { type: String, required: true }, // YYYY-MM
    currency: { type: String, required: true },
    decimals: { type: Number, default: 2 },
    status: { type: String, enum: PAYROLL_STATUSES, default: "DRAFT", index: true },
    lines: { type: [lineSchema], default: [] },
    totals: { gross: { type: Number, default: 0 }, deductions: { type: Number, default: 0 }, net: { type: Number, default: 0 }, headcount: { type: Number, default: 0 } },
    workingDays: { type: Number, default: 22 },
    // Signature + identity captured at approval, so the document always shows who signed
    signedBy: { name: String, title: String, signatureUrl: String, signedAt: Date, userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" } },
    // Which logo / signature HR chose for this run's documents (ids from HrSettings.logos / .signatures); logoUrl is frozen at approval.
    branding: { logoId: { type: String, default: "" }, signatureId: { type: String, default: "" }, logoUrl: { type: String, default: "" } },
    approvedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    summarySentAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    history: { type: [{ _id: false, at: Date, byName: String, action: String, note: String }], default: [] },
  },
  { timestamps: true },
);
payrollSchema.index({ countryCode: 1, period: 1 }, { unique: true });
export default mongoose.models.HrPayroll || mongoose.model("HrPayroll", payrollSchema);
