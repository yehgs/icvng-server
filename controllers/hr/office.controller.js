// server/controllers/hr/office.controller.js — offices (geofences), public holidays, payroll identity settings.
import HrOffice from "../../models/hr/hr-office.model.js";
import HrHoliday from "../../models/hr/hr-holiday.model.js";
import { listLogos, listSignatures, normaliseBranding } from "../../services/hr/branding.js";
import HrSettings from "../../models/hr/hr-settings.model.js";
import HrStaff from "../../models/hr/hr-staff.model.js";
import { featureCountryFilter, resolveCreateCountry } from "../../utils/featureScope.js";
import { sanitizeText, isSafeLink } from "../../utils/campaignValidation.js";
import { validCoords } from "../../services/hr/geo.js";
import { isDateStr, countryTimezone } from "../../services/hr/common.js";
import { logActivity } from "../../utils/activityLogger.js";
import { ok, fail, isId, scopeOr403, countryWhere, duplicate } from "./shared.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const log = (req, action, description, doc, name) => logActivity({ userId: req.user._id, action, description, resourceType: "Staff", resourceId: doc?._id, resourceName: name || "", req });

function officeInput(b, partial) {
  const errors = [], d = {};
  if (!partial || b.name !== undefined) { const n = sanitizeText(b.name, 100); n ? (d.name = n) : errors.push("Office name is required"); }
  if (b.address !== undefined) d.address = sanitizeText(b.address, 300);
  if (!partial || b.lat !== undefined || b.lng !== undefined || b.location) {
    const lat = Number(b.lat ?? b.location?.lat), lng = Number(b.lng ?? b.location?.lng);
    validCoords(lat, lng) ? (d.location = { lat, lng }) : errors.push("A valid latitude and longitude are required");
  }
  if (b.radiusMeters !== undefined) { const r = Number(b.radiusMeters); (r >= 20 && r <= 5000) ? (d.radiusMeters = Math.round(r)) : errors.push("Radius must be 20–5000 metres"); }
  if (b.notifyEmails !== undefined) {
    const list = (Array.isArray(b.notifyEmails) ? b.notifyEmails : String(b.notifyEmails).split(/[,;\s]+/)).map((e) => String(e).trim().toLowerCase()).filter(Boolean);
    list.length > 10 || list.some((e) => !EMAIL.test(e)) ? errors.push("Notification e-mails must be valid (max 10)") : (d.notifyEmails = [...new Set(list)]);
  }
  if (b.enforceGeofence !== undefined) d.enforceGeofence = !!b.enforceGeofence;
  if (b.isActive !== undefined) d.isActive = !!b.isActive;
  return { errors, d };
}

export async function listOffices(req, res) {
  const c = countryWhere(req, res); if (!c) return;
  const rows = await HrOffice.find({ ...c.where }).sort({ countryCode: 1, name: 1 }).lean();
  return ok(res, rows);
}
export async function createOffice(req, res) {
  const scope = scopeOr403(req, res); if (!scope) return;
  const t = resolveCreateCountry(scope, req.body.countryCode);
  if (t.error) return fail(res, t.error.status, t.error.message);
  const { errors, d } = officeInput(req.body, false);
  if (errors.length) return fail(res, 400, errors[0], { errors });
  const doc = await HrOffice.create({ ...d, countryCode: t.countryCode, timezone: countryTimezone(t.countryCode), createdBy: req.user._id, updatedBy: req.user._id });
  await log(req, "HR_OFFICE_CHANGE", `Added office ${doc.name} (${doc.countryCode})`, doc, doc.name);
  return ok(res, doc);
}
export async function updateOffice(req, res) {
  const scope = scopeOr403(req, res); if (!scope) return;
  if (!isId(req.params.id)) return fail(res, 404, "Office not found");
  const doc = await HrOffice.findOne({ _id: req.params.id, ...featureCountryFilter(scope) });
  if (!doc) return fail(res, 404, "Office not found");
  if (req.body.countryCode && req.body.countryCode !== doc.countryCode) return fail(res, 403, "An office's country cannot be changed");
  const { errors, d } = officeInput(req.body, true);
  if (errors.length) return fail(res, 400, errors[0], { errors });
  Object.assign(doc, d, { updatedBy: req.user._id });
  await doc.save();
  await log(req, "HR_OFFICE_CHANGE", `Updated office ${doc.name}`, doc, doc.name);
  return ok(res, doc);
}
export async function deleteOffice(req, res) {
  const scope = scopeOr403(req, res); if (!scope) return;
  if (!isId(req.params.id)) return fail(res, 404, "Office not found");
  const doc = await HrOffice.findOne({ _id: req.params.id, ...featureCountryFilter(scope) });
  if (!doc) return fail(res, 404, "Office not found");
  const used = await HrStaff.countDocuments({ "employment.officeId": doc._id });
  if (used) { doc.isActive = false; await doc.save(); await log(req, "HR_OFFICE_CHANGE", `Deactivated office ${doc.name} (${used} staff assigned)`, doc, doc.name); return ok(res, { deactivated: true, assigned: used }); }
  await doc.deleteOne();
  await log(req, "HR_OFFICE_CHANGE", `Deleted office ${doc.name}`, doc, doc.name);
  return ok(res, { deleted: true });
}

// ── holidays ──
export async function listHolidays(req, res) {
  const c = countryWhere(req, res); if (!c) return;
  const where = { ...c.where };
  if (req.query.year && /^\d{4}$/.test(req.query.year)) where.date = { $gte: `${req.query.year}-01-01`, $lte: `${req.query.year}-12-31` };
  return ok(res, await HrHoliday.find(where).sort({ date: 1 }).lean());
}
export async function createHoliday(req, res) {
  const scope = scopeOr403(req, res); if (!scope) return;
  const t = resolveCreateCountry(scope, req.body.countryCode);
  if (t.error) return fail(res, t.error.status, t.error.message);
  const name = sanitizeText(req.body.name, 100);
  if (!name || !isDateStr(req.body.date)) return fail(res, 400, "Name and a YYYY-MM-DD date are required");
  try {
    const doc = await HrHoliday.create({ countryCode: t.countryCode, name, date: req.body.date, createdBy: req.user._id });
    await log(req, "HR_SETTINGS_CHANGE", `Added holiday ${name} ${req.body.date} (${t.countryCode})`, doc, name);
    return ok(res, doc);
  } catch (e) { if (duplicate(e)) return fail(res, 409, "A holiday already exists on that date"); throw e; }
}
export async function deleteHoliday(req, res) {
  const scope = scopeOr403(req, res); if (!scope) return;
  if (!isId(req.params.id)) return fail(res, 404, "Holiday not found");
  const doc = await HrHoliday.findOneAndDelete({ _id: req.params.id, ...featureCountryFilter(scope) });
  if (!doc) return fail(res, 404, "Holiday not found");
  await log(req, "HR_SETTINGS_CHANGE", `Removed holiday ${doc.name} ${doc.date}`, doc, doc.name);
  return ok(res, { deleted: true });
}

// ── payroll identity settings (logo, signatory, signature) ──
const httpsUrl = (u) => u === "" || (typeof u === "string" && /^https:\/\//i.test(u) && isSafeLink(u));
export async function getSettings(req, res) {
  const scope = scopeOr403(req, res); if (!scope) return;
  const code = scope.isGlobal ? String(req.query.countryCode || "").toUpperCase() : scope.countryCode;
  if (!code) return fail(res, 400, "countryCode is required");
  const doc = (await HrSettings.findOne({ countryCode: code }).lean()) || { countryCode: code, workingDaysPerMonth: 22, payrollNotifyEmails: [] };
  return ok(res, { ...doc, logos: listLogos(doc), signatures: listSignatures(doc) }); // legacy single logo/signature appear as one default entry
}
export async function saveSettings(req, res) {
  const scope = scopeOr403(req, res); if (!scope) return;
  const t = resolveCreateCountry(scope, req.body.countryCode || req.query.countryCode);
  if (t.error) return fail(res, t.error.status, t.error.message);
  const b = req.body, d = {}, errors = [];
  for (const [k, max] of [["companyName", 120], ["companyAddress", 300], ["signerName", 100], ["signerTitle", 100], ["payslipFooter", 300]]) if (b[k] !== undefined) d[k] = sanitizeText(b[k], max);
  for (const k of ["logoUrl", "signatureUrl"]) if (b[k] !== undefined) httpsUrl(b[k]) ? (d[k] = b[k]) : errors.push(`${k} must be an https URL`);
  if (b.logos !== undefined || b.signatures !== undefined) {
    const br = normaliseBranding(b);
    errors.push(...br.errors);
    delete br.errors;
    Object.assign(d, br);
  }
  if (b.workingDaysPerMonth !== undefined) { const n = Number(b.workingDaysPerMonth); (n >= 15 && n <= 31) ? (d.workingDaysPerMonth = n) : errors.push("Working days must be 15–31"); }
  if (b.payrollNotifyEmails !== undefined) {
    const list = (Array.isArray(b.payrollNotifyEmails) ? b.payrollNotifyEmails : String(b.payrollNotifyEmails).split(/[,;\s]+/)).map((e) => String(e).trim().toLowerCase()).filter(Boolean);
    list.length > 10 || list.some((e) => !EMAIL.test(e)) ? errors.push("Payroll e-mails must be valid (max 10)") : (d.payrollNotifyEmails = [...new Set(list)]);
  }
  if (errors.length) return fail(res, 400, errors[0], { errors });
  const doc = await HrSettings.findOneAndUpdate({ countryCode: t.countryCode }, { $set: { ...d, updatedBy: req.user._id } }, { new: true, upsert: true });
  await log(req, "HR_SETTINGS_CHANGE", `Updated HR/payroll settings (${t.countryCode})`, doc, t.countryCode);
  const o = doc.toObject();
  return ok(res, { ...o, logos: listLogos(o), signatures: listSignatures(o) });
}
