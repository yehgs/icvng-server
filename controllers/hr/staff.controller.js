// server/controllers/hr/staff.controller.js — staff directory, search, create/update, audited sensitive reveal.
import HrStaff, { WORK_MODES, EMPLOYMENT_TYPES, EMPLOYMENT_STATUSES, GENDERS } from "../../models/hr/hr-staff.model.js";
import { LEAVE_TYPES } from "../../models/hr/hr-leave.model.js";
import { COUNTRY_CONFIG } from "../../config/countries/index.js";
import { userHasPermission } from "../../middleware/requirePermission.js";
import HrOffice from "../../models/hr/hr-office.model.js";
import User from "../../models/user.model.js";
import { featureCountryFilter, resolveCreateCountry, canAccessCountry } from "../../utils/featureScope.js";
import { validateStaffInput, secretsToUpdate, flatten, createStaffRecord, serializeStaff, revealSensitive } from "../../services/hr/staff.js";
import { escRegex } from "../../services/hr/common.js";
import { ok, fail, isId, scopeOr403, countryWhere, audit, paging, loadStaff, duplicate } from "./shared.js";
import { logActivity } from "../../utils/activityLogger.js";

export async function listStaff(req, res) {
  const c = countryWhere(req, res); if (!c) return;
  const { page, limit, skip } = paging(req);
  const where = { ...c.where };
  const { q, status, workMode, department, officeId } = req.query;
  if (status) where["employment.status"] = String(status);
  if (workMode) where["employment.workMode"] = String(workMode);
  if (department) where["employment.department"] = String(department);
  if (officeId && isId(officeId)) where["employment.officeId"] = officeId;
  if (q) {
    const rx = new RegExp(escRegex(String(q).slice(0, 60)), "i");
    where.$or = [{ fullName: rx }, { employeeId: rx }, { "employment.jobTitle": rx }, { "employment.department": rx }, { phone: rx }, { personalEmail: rx }];
  }
  const [rows, total] = await Promise.all([
    HrStaff.find(where).sort({ fullName: 1 }).skip(skip).limit(limit).select("-bank.accountNumberEnc -bank.taxIdEnc -health.notesEnc"),
    HrStaff.countDocuments(where),
  ]);
  return ok(res, rows.map((r) => serializeStaff(r)), { pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}

export async function getStaff(req, res) {
  const f = await loadStaff(req, res, req.params.id); if (!f) return;
  return ok(res, serializeStaff(f.doc));
}

/** Audited: decrypts bank account number, tax id and health notes for ONE staff member. */
export async function getStaffSensitive(req, res) {
  const f = await loadStaff(req, res, req.params.id); if (!f) return;
  await logActivity({ userId: req.user._id, action: "HR_SENSITIVE_VIEW", description: `Viewed sensitive HR details of ${f.doc.fullName} (${f.doc.employeeId})`, resourceType: "Staff", resourceId: f.doc._id, resourceName: f.doc.fullName, req });
  return ok(res, revealSensitive(f.doc));
}

async function checkRefs(countryCode, data, ownId = null) {
  const e = data.employment || {};
  if (e.officeId && !(await HrOffice.exists({ _id: e.officeId, countryCode }))) return "Office not found in this country";
  if (e.managerId) {
    if (ownId && String(e.managerId) === String(ownId)) return "A person cannot be their own manager";
    if (!(await HrStaff.exists({ _id: e.managerId, countryCode }))) return "Manager not found in this country";
  }
  return null;
}

export async function createStaff(req, res) {
  const scope = scopeOr403(req, res); if (!scope) return;
  const target = resolveCreateCountry(scope, req.body.countryCode);
  if (target.error) return fail(res, target.error.status, target.error.message);
  let userId = null, fallbackName = "", fallbackPhoto = "";
  if (req.body.userId) {
    if (!isId(req.body.userId)) return fail(res, 400, "userId is invalid");
    const u = await User.findOne({ _id: req.body.userId, role: "ADMIN" }).select("name scope assignedCountry subRole avatar");
    if (!u) return fail(res, 404, "Admin user not found");
    const uc = u.scope === "COUNTRY" && u.assignedCountry ? u.assignedCountry : target.countryCode;
    if (uc !== target.countryCode && !["IT", "DIRECTOR"].includes(u.subRole)) return fail(res, 400, `This user belongs to ${uc}; create the HR record in that country`);
    if (await HrStaff.exists({ userId: u._id })) return fail(res, 409, "This user already has an HR record");
    userId = u._id; fallbackName = u.name;
    // The account already has a picture: reuse it unless HR supplied another (https only, like any HR photo).
    if (/^https:\/\//i.test(u.avatar || "")) fallbackPhoto = u.avatar;
  }
  const profile = { ...req.body, ...(fallbackPhoto && !req.body.photoUrl ? { photoUrl: fallbackPhoto } : {}) };
  const v = validateStaffInput({ ...profile, fullName: String(req.body.fullName || "").trim() || fallbackName });
  if (v.errors.length) return fail(res, 400, v.errors[0], { errors: v.errors });
  const refErr = await checkRefs(target.countryCode, v.data);
  if (refErr) return fail(res, 400, refErr);
  try {
    const { doc, errors } = await createStaffRecord({ countryCode: target.countryCode, userId, profile, actorId: req.user._id, fallbackName });
    if (errors) return fail(res, 400, errors[0], { errors });
    await audit(req, "HR_STAFF_CREATE", `Added staff ${doc.fullName} (${doc.employeeId}) in ${doc.countryCode}`, doc);
    return ok(res, serializeStaff(doc));
  } catch (e) {
    if (duplicate(e)) return fail(res, 409, "This user already has an HR record");
    throw e;
  }
}

export async function updateStaff(req, res) {
  const f = await loadStaff(req, res, req.params.id); if (!f) return;
  if (req.body.countryCode && req.body.countryCode !== f.doc.countryCode) return fail(res, 403, "A staff member's country cannot be changed");
  const v = validateStaffInput(req.body, { partial: true });
  if (v.errors.length) return fail(res, 400, v.errors[0], { errors: v.errors });
  const refErr = await checkRefs(f.doc.countryCode, v.data, f.doc._id);
  if (refErr) return fail(res, 400, refErr);
  const before = serializeStaff(f.doc);
  const set = { ...flatten(v.data), ...secretsToUpdate(v.secrets), updatedBy: req.user._id };
  const arrays = ["salary.allowances", "salary.deductions", "employment.hybridOfficeDays", "documents"]; // whole-array replacement
  for (const k of arrays) if (set[k] !== undefined) f.doc.set(k, set[k]), delete set[k];
  for (const [k, val] of Object.entries(set)) f.doc.set(k, val);
  await f.doc.save();
  await logActivity({ userId: req.user._id, action: "HR_STAFF_UPDATE", description: `Updated staff ${f.doc.fullName} (${f.doc.employeeId})`, resourceType: "Staff", resourceId: f.doc._id, resourceName: f.doc.fullName, before: { employment: before.employment, salary: before.salary }, after: { employment: f.doc.employment, salary: f.doc.salary }, req });
  return ok(res, serializeStaff(f.doc));
}

/** Staff are never hard-deleted (payroll history references them): this marks them TERMINATED. */
export async function terminateStaff(req, res) {
  const f = await loadStaff(req, res, req.params.id); if (!f) return;
  f.doc.set("employment.status", "TERMINATED");
  if (!f.doc.employment.endDate) f.doc.set("employment.endDate", new Date());
  f.doc.updatedBy = req.user._id;
  await f.doc.save();
  await audit(req, "HR_STAFF_DELETE", `Terminated staff ${f.doc.fullName} (${f.doc.employeeId})`, f.doc);
  return ok(res, serializeStaff(f.doc));
}

/** Admin users in the caller's territory that have no HR record yet (for "link existing user"). */
export async function staffCandidates(req, res) {
  const c = countryWhere(req, res); if (!c) return;
  const linked = await HrStaff.distinct("userId", { userId: { $ne: null } });
  const where = { role: "ADMIN", _id: { $nin: linked } };
  if (!c.scope.isGlobal) {
    where.$or = c.scope.countryCode === "NG"
      ? [{ scope: "COUNTRY", assignedCountry: "NG" }, { scope: { $ne: "COUNTRY" } }, { assignedCountry: null }]
      : [{ scope: "COUNTRY", assignedCountry: c.scope.countryCode }];
  }
  const users = await User.find(where).select("name email subRole scope assignedCountry avatar mobile").sort({ name: 1 }).limit(200).lean();
  return ok(res, users);
}

export const staffMeta = (req, res) => {
  const scope = scopeOr403(req, res); if (!scope) return;
  const countries = Object.values(COUNTRY_CONFIG)
    .filter((c) => scope.isGlobal || c.code === scope.countryCode)
    .map((c) => ({ code: c.code, name: c.name, flag: c.flagEmoji, currency: c.currency?.code, decimals: c.currency?.decimals ?? 2, timezone: c.timezone }));
  return ok(res, {
    scope: { isGlobal: scope.isGlobal, countryCode: scope.countryCode }, countries,
    permissions: { manage: userHasPermission(req.user, "hr.manage"), payroll: userHasPermission(req.user, "hr.payroll") },
    enums: { workModes: WORK_MODES, employmentTypes: EMPLOYMENT_TYPES, statuses: EMPLOYMENT_STATUSES, genders: GENDERS, leaveTypes: LEAVE_TYPES },
  });
};
void canAccessCountry; void featureCountryFilter;
