// server/services/hr/staff.js — staff record rules shared by the HR controller and user management.
import mongoose from "mongoose";
import HrStaff, { GENDERS, WORK_MODES, EMPLOYMENT_TYPES, EMPLOYMENT_STATUSES, HEALTH_STATUSES } from "../../models/hr/hr-staff.model.js";
import HrCounter from "../../models/hr/hr-counter.model.js";
import { encryptSecret, decryptSecret } from "../../utils/encryption.js";
import { sanitizeText, isSafeLink } from "../../utils/campaignValidation.js";
import { isDateStr, toDate, dateToStr, maskAccount } from "./common.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const isId = (v) => mongoose.Types.ObjectId.isValid(v);
const httpsOnly = (u) => typeof u === "string" && /^https:\/\//i.test(u) && isSafeLink(u);

export async function nextEmployeeId(countryCode) {
  const c = await HrCounter.findOneAndUpdate({ _id: `emp-${countryCode}` }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return `ICV-${countryCode}-${String(c.seq).padStart(4, "0")}`;
}

/**
 * Validate + normalise a staff payload (create or partial update). Secrets (account number,
 * tax id, health notes) are returned separately so the caller can encrypt them.
 * @returns {{ errors:string[], data:object, secrets:object }}
 */
export function validateStaffInput(b = {}, { partial = false } = {}) {
  const errors = [];
  const data = {};
  const secrets = {};
  const has = (k) => b[k] !== undefined;
  const set = (path, value) => {
    const parts = path.split(".");
    let o = data;
    parts.slice(0, -1).forEach((p) => (o = o[p] = o[p] || {}));
    o[parts.at(-1)] = value;
  };
  const text = (path, v, max) => set(path, sanitizeText(v, max));
  const oneOf = (path, v, list, label) => (list.includes(v) ? set(path, v) : errors.push(`${label} is invalid`));
  const date = (path, v, label) => {
    if (v === "" || v === null) return set(path, null);
    isDateStr(v) ? set(path, toDate(v)) : errors.push(`${label} must be YYYY-MM-DD`);
  };

  if (!partial || has("fullName")) {
    const n = sanitizeText(b.fullName, 120);
    n ? (data.fullName = n) : errors.push("Full name is required");
  }
  if (has("gender")) oneOf("gender", b.gender, GENDERS, "Gender");
  if (has("dateOfBirth")) {
    date("dateOfBirth", b.dateOfBirth, "Date of birth");
    if (data.dateOfBirth && (data.dateOfBirth > new Date() || data.dateOfBirth < new Date("1900-01-01"))) errors.push("Date of birth is out of range");
  }
  if (has("maritalStatus")) oneOf("maritalStatus", b.maritalStatus, ["SINGLE", "MARRIED", "DIVORCED", "WIDOWED", "OTHER", ""], "Marital status");
  if (has("nationality")) text("nationality", b.nationality, 60);
  if (has("phone")) text("phone", b.phone, 30);
  if (has("personalEmail")) {
    const e = String(b.personalEmail || "").trim().toLowerCase();
    e && !EMAIL.test(e) ? errors.push("Personal e-mail is invalid") : set("personalEmail", e);
  }
  if (has("photoUrl")) (b.photoUrl === "" || httpsOnly(b.photoUrl)) ? set("photoUrl", b.photoUrl) : errors.push("Photo must be an https URL");

  for (const k of ["line1", "line2", "city", "state", "country", "postalCode"]) if (b.address?.[k] !== undefined) text(`address.${k}`, b.address[k], k.startsWith("line") ? 200 : 80);
  for (const k of ["name", "relationship", "phone"]) if (b.emergencyContact?.[k] !== undefined) text(`emergencyContact.${k}`, b.emergencyContact[k], 120);

  if (b.health) {
    if (b.health.status !== undefined) oneOf("health.status", b.health.status, HEALTH_STATUSES, "Health status");
    if (b.health.bloodGroup !== undefined) text("health.bloodGroup", b.health.bloodGroup, 5);
    if (b.health.genotype !== undefined) text("health.genotype", b.health.genotype, 5);
    if (b.health.notes !== undefined) secrets.healthNotes = sanitizeText(b.health.notes, 1000);
  }

  const e = b.employment || {};
  if (e.jobTitle !== undefined) text("employment.jobTitle", e.jobTitle, 100);
  if (e.department !== undefined) text("employment.department", e.department, 80);
  if (e.employmentType !== undefined) oneOf("employment.employmentType", e.employmentType, EMPLOYMENT_TYPES, "Employment type");
  if (e.workMode !== undefined) oneOf("employment.workMode", e.workMode, WORK_MODES, "Work mode");
  if (e.status !== undefined) oneOf("employment.status", e.status, EMPLOYMENT_STATUSES, "Employment status");
  for (const k of ["startDate", "probationEndDate", "contractEndDate", "endDate"]) if (e[k] !== undefined) date(`employment.${k}`, e[k], k);
  if (e.managerId !== undefined) (e.managerId === null || e.managerId === "") ? set("employment.managerId", null) : isId(e.managerId) ? set("employment.managerId", e.managerId) : errors.push("Manager is invalid");
  if (e.officeId !== undefined) (e.officeId === null || e.officeId === "") ? set("employment.officeId", null) : isId(e.officeId) ? set("employment.officeId", e.officeId) : errors.push("Office is invalid");
  if (e.hybridOfficeDays !== undefined) {
    Array.isArray(e.hybridOfficeDays) && e.hybridOfficeDays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      ? set("employment.hybridOfficeDays", [...new Set(e.hybridOfficeDays)])
      : errors.push("Hybrid office days must be weekdays 0–6");
  }

  const s = b.salary || {};
  const money = (v, label) => { const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 1e12) { errors.push(`${label} must be a positive number`); return 0; } return n; };
  if (s.currency !== undefined) /^[A-Za-z]{3}$/.test(s.currency || "") ? set("salary.currency", s.currency.toUpperCase()) : errors.push("Currency must be a 3-letter code");
  if (s.baseSalary !== undefined) set("salary.baseSalary", money(s.baseSalary, "Base salary"));
  if (s.allowances !== undefined) {
    if (!Array.isArray(s.allowances) || s.allowances.length > 20) errors.push("Allowances must be a list of up to 20");
    else set("salary.allowances", s.allowances.map((a) => ({ name: sanitizeText(a?.name, 60) || "Allowance", amount: money(a?.amount, "Allowance") })));
  }
  if (s.deductions !== undefined) {
    if (!Array.isArray(s.deductions) || s.deductions.length > 20) errors.push("Deductions must be a list of up to 20");
    else set("salary.deductions", s.deductions.map((d) => {
      const type = d?.type === "PERCENT" ? "PERCENT" : "FIXED";
      const value = money(d?.value, "Deduction");
      if (type === "PERCENT" && value > 100) errors.push("A percentage deduction cannot exceed 100");
      return { name: sanitizeText(d?.name, 60) || "Deduction", type, value, of: d?.of === "BASE" ? "BASE" : "GROSS" };
    }));
  }

  const bk = b.bank || {};
  for (const k of ["bankName", "accountName", "branch", "sortCode", "pensionId"]) if (bk[k] !== undefined) text(`bank.${k}`, bk[k], k === "accountName" ? 120 : 80);
  if (bk.accountNumber !== undefined) {
    const acct = String(bk.accountNumber).replace(/[\s-]/g, "");
    if (acct && !/^[A-Za-z0-9]{6,34}$/.test(acct)) errors.push("Account number must be 6–34 letters/digits");
    else secrets.accountNumber = acct;
  }
  if (bk.taxId !== undefined) secrets.taxId = sanitizeText(bk.taxId, 40);

  if (has("leaveEntitlementDays")) { const n = Number(b.leaveEntitlementDays); (n >= 0 && n <= 366) ? (data.leaveEntitlementDays = n) : errors.push("Leave entitlement must be 0–366"); }
  if (has("notes")) data.notes = sanitizeText(b.notes, 2000);
  if (has("documents")) {
    if (!Array.isArray(b.documents) || b.documents.length > 20 || b.documents.some((d) => !httpsOnly(d?.url))) errors.push("Documents need https URLs (max 20)");
    else data.documents = b.documents.map((d) => ({ name: sanitizeText(d.name, 100), url: d.url, type: sanitizeText(d.type, 40) }));
  }
  if (!partial && !data.employment?.workMode) set("employment.workMode", "FULL_TIME");
  return { errors, data, secrets };
}

/** Encrypt secrets into the update object (dotted paths so unrelated sub-fields are preserved). */
export function secretsToUpdate(secrets = {}) {
  const u = {};
  if (secrets.accountNumber !== undefined) {
    u["bank.accountNumberEnc"] = encryptSecret(secrets.accountNumber);
    u["bank.accountLast4"] = secrets.accountNumber.slice(-4);
  }
  if (secrets.taxId !== undefined) u["bank.taxIdEnc"] = encryptSecret(secrets.taxId);
  if (secrets.healthNotes !== undefined) u["health.notesEnc"] = encryptSecret(secrets.healthNotes);
  return u;
}

/** Flatten nested `data` into dotted $set paths (keeps untouched siblings). */
export function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof mongoose.Types.ObjectId)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

/** Create a staff record (used by HR "add staff" and by User Management's optional staffProfile). */
export async function createStaffRecord({ countryCode, userId = null, profile, actorId, fallbackName = "" }) {
  const { errors, data, secrets } = validateStaffInput({ ...profile, fullName: String(profile?.fullName || "").trim() || fallbackName });
  if (errors.length) return { errors };
  const doc = new HrStaff({ ...data, countryCode, userId, employeeId: await nextEmployeeId(countryCode), createdBy: actorId, updatedBy: actorId });
  const enc = secretsToUpdate(secrets);
  for (const [k, v] of Object.entries(enc)) doc.set(k, v);
  await doc.save();
  return { doc };
}

/** Public shape: no ciphertext, account masked, health notes withheld. */
export function serializeStaff(doc, { forPayroll = false } = {}) {
  const o = doc.toObject ? doc.toObject() : { ...doc };
  const bank = o.bank || {};
  const health = o.health || {};
  const out = {
    ...o,
    bank: {
      bankName: bank.bankName, accountName: bank.accountName, branch: bank.branch, sortCode: bank.sortCode, pensionId: bank.pensionId,
      accountMasked: maskAccount(bank.accountLast4), hasAccountNumber: !!bank.accountNumberEnc, hasTaxId: !!bank.taxIdEnc,
    },
    health: { status: health.status, bloodGroup: health.bloodGroup, genotype: health.genotype, hasNotes: !!health.notesEnc },
  };
  if (forPayroll) delete out.health;
  return out;
}

/** Audited reveal of the encrypted fields. */
export function revealSensitive(doc) {
  const dec = (v) => { try { return decryptSecret(v); } catch { return ""; } };
  return { accountNumber: dec(doc.bank?.accountNumberEnc), taxId: dec(doc.bank?.taxIdEnc), healthNotes: dec(doc.health?.notesEnc) };
}
export { dateToStr };
