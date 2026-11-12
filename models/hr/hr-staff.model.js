// server/models/hr/hr-staff.model.js
//
// HR record for one staff member (an ADMIN user). Sensitive values — bank account
// number, tax id, health notes — are AES-256-GCM encrypted at rest (utils/encryption.js)
// and only decrypted by the audited /staff/:id/sensitive endpoint and by payroll output.
// Country is fixed at creation and enforced by utils/featureScope.js.
import mongoose from "mongoose";
import { countryField } from "../../config/countrySchema.js";

export const GENDERS = ["MALE", "FEMALE", "OTHER", "UNDISCLOSED"];
export const WORK_MODES = ["FULL_TIME", "HYBRID", "REMOTE"]; // FULL_TIME = on-site, full-time in the office
export const EMPLOYMENT_TYPES = ["PERMANENT", "CONTRACT", "PART_TIME", "INTERN"];
export const EMPLOYMENT_STATUSES = ["ACTIVE", "ON_LEAVE", "SUSPENDED", "TERMINATED"];
export const HEALTH_STATUSES = ["FIT", "CONDITION_NOTED", "UNDISCLOSED"];

const money = (extra = {}) => ({ type: Number, min: 0, default: 0, ...extra });

const staffSchema = new mongoose.Schema(
  {
    ...countryField,
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    employeeId: { type: String, required: true, unique: true, trim: true },

    // ── personal ──
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    gender: { type: String, enum: GENDERS, default: "UNDISCLOSED" },
    dateOfBirth: { type: Date, default: null },
    maritalStatus: { type: String, enum: ["SINGLE", "MARRIED", "DIVORCED", "WIDOWED", "OTHER", ""], default: "" },
    nationality: { type: String, trim: true, maxlength: 60, default: "" },
    phone: { type: String, trim: true, maxlength: 30, default: "" },
    personalEmail: { type: String, trim: true, lowercase: true, maxlength: 254, default: "" },
    photoUrl: { type: String, trim: true, maxlength: 500, default: "" },
    address: {
      line1: { type: String, trim: true, maxlength: 200, default: "" },
      line2: { type: String, trim: true, maxlength: 200, default: "" },
      city: { type: String, trim: true, maxlength: 80, default: "" },
      state: { type: String, trim: true, maxlength: 80, default: "" },
      country: { type: String, trim: true, maxlength: 80, default: "" },
      postalCode: { type: String, trim: true, maxlength: 20, default: "" },
    },
    emergencyContact: {
      name: { type: String, trim: true, maxlength: 120, default: "" },
      relationship: { type: String, trim: true, maxlength: 60, default: "" },
      phone: { type: String, trim: true, maxlength: 30, default: "" },
    },

    // ── health (sensitive) ──
    health: {
      status: { type: String, enum: HEALTH_STATUSES, default: "UNDISCLOSED" },
      bloodGroup: { type: String, trim: true, maxlength: 5, default: "" },
      genotype: { type: String, trim: true, maxlength: 5, default: "" },
      notesEnc: { type: String, default: "" }, // encrypted free text
    },

    // ── employment ──
    employment: {
      jobTitle: { type: String, trim: true, maxlength: 100, default: "" },
      department: { type: String, trim: true, maxlength: 80, default: "" },
      employmentType: { type: String, enum: EMPLOYMENT_TYPES, default: "PERMANENT" },
      workMode: { type: String, enum: WORK_MODES, default: "FULL_TIME" },
      status: { type: String, enum: EMPLOYMENT_STATUSES, default: "ACTIVE", index: true },
      startDate: { type: Date, default: null },
      probationEndDate: { type: Date, default: null },
      contractEndDate: { type: Date, default: null },
      endDate: { type: Date, default: null },
      managerId: { type: mongoose.Schema.Types.ObjectId, ref: "HrStaff", default: null },
      officeId: { type: mongoose.Schema.Types.ObjectId, ref: "HrOffice", default: null },
      // HYBRID: weekdays (0=Sun…6=Sat) expected in the office; informational for HR reports
      hybridOfficeDays: { type: [Number], default: [] },
    },

    // ── salary ──
    salary: {
      currency: { type: String, trim: true, uppercase: true, maxlength: 3, default: "NGN" },
      baseSalary: money(), // per pay period, major units
      payFrequency: { type: String, enum: ["MONTHLY"], default: "MONTHLY" },
      allowances: { type: [{ _id: false, name: { type: String, trim: true, maxlength: 60 }, amount: money() }], default: [] },
      // FIXED: value is an amount; PERCENT: value is % of `of` (BASE or GROSS)
      deductions: {
        type: [{ _id: false, name: { type: String, trim: true, maxlength: 60 }, type: { type: String, enum: ["FIXED", "PERCENT"], default: "FIXED" }, value: money(), of: { type: String, enum: ["BASE", "GROSS"], default: "GROSS" } }],
        default: [],
      },
    },

    // ── bank / statutory (account number + tax id encrypted) ──
    bank: {
      bankName: { type: String, trim: true, maxlength: 80, default: "" },
      accountName: { type: String, trim: true, maxlength: 120, default: "" },
      accountNumberEnc: { type: String, default: "" },
      accountLast4: { type: String, default: "" },
      branch: { type: String, trim: true, maxlength: 80, default: "" },
      sortCode: { type: String, trim: true, maxlength: 40, default: "" }, // sort code / IBAN / SWIFT — free text
      taxIdEnc: { type: String, default: "" },
      pensionId: { type: String, trim: true, maxlength: 40, default: "" },
    },

    leaveEntitlementDays: { type: Number, min: 0, max: 366, default: 20 },
    documents: { type: [{ _id: false, name: { type: String, trim: true, maxlength: 100 }, url: { type: String, trim: true, maxlength: 500 }, type: { type: String, trim: true, maxlength: 40 } }], default: [] },
    notes: { type: String, maxlength: 2000, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
// one HR record per admin account (partial: only when userId is present)
staffSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { userId: { $type: "objectId" } } });
staffSchema.index({ countryCode: 1, "employment.status": 1 });
staffSchema.index({ fullName: "text", employeeId: "text", "employment.department": "text", "employment.jobTitle": "text" });

export default mongoose.models.HrStaff || mongoose.model("HrStaff", staffSchema);
