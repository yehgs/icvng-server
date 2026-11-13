// server/controllers/hr/documents.controller.js — printable blank staff form (download / e-mail) and the
// password-confirmed "export staff details" PDF. Country scope comes from utils/featureScope.js.
import bcryptjs from "bcryptjs";
import User from "../../models/user.model.js";
import HrSettings from "../../models/hr/hr-settings.model.js";
import { fetchImage, buildBlankStaffFormPdf, buildStaffDetailsPdf } from "../../services/hr/pdf.js";
import { resolveBranding } from "../../services/hr/branding.js";
import { sendStaffFormMail } from "../../services/hr/mail.js";
import { revealSensitive, serializeStaff } from "../../services/hr/staff.js";
import { logActivity } from "../../utils/activityLogger.js";
import { ok, fail, scopeOr403, loadStaff } from "./shared.js";

const COUNTRY_NAMES = { NG: "Nigeria", TG: "Togo", BJ: "Benin", IT: "Italy" };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ── password re-entry throttle: 5 wrong passwords → locked 15 minutes (per admin account, in memory) ──
export const MAX_FAILS = 5, LOCK_MS = 15 * 60 * 1000;
const fails = new Map();
export const _resetThrottle = () => fails.clear();
const lockedFor = (id) => { const f = fails.get(String(id)); return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0; };
function recordFail(id) {
  const k = String(id), f = fails.get(k) || { n: 0, until: 0 };
  if (f.until && f.until <= Date.now()) { f.n = 0; f.until = 0; }
  f.n += 1;
  if (f.n >= MAX_FAILS) f.until = Date.now() + LOCK_MS;
  fails.set(k, f);
}

/** The country whose settings/branding apply: own country, or ?countryCode= / body.countryCode for IT and Director. */
function targetCountry(req, res, scope, requested) {
  const code = scope.isGlobal ? String(requested || "").toUpperCase() : scope.countryCode;
  if (!code) { fail(res, 400, "countryCode is required"); return null; }
  if (!scope.isGlobal && requested && String(requested).toUpperCase() !== scope.countryCode) { fail(res, 403, `Access denied: you can only manage ${scope.countryCode} data`); return null; }
  return code;
}
async function brandingFor(res, code, ids) {
  const settings = (await HrSettings.findOne({ countryCode: code }).lean()) || { countryCode: code };
  const b = resolveBranding(settings, ids);
  if (b.error) { fail(res, 400, b.error); return null; }
  return { settings, ...b };
}
const log = (req, action, description, extra = {}) => logActivity({ userId: req.user._id, action, description, resourceType: "Staff", req, ...extra });

/** GET /forms/staff-form?logoId=&countryCode= → blank PDF (attachment). */
export async function downloadBlankForm(req, res) {
  const scope = scopeOr403(req, res); if (!scope) return;
  const code = targetCountry(req, res, scope, req.query.countryCode); if (!code) return;
  const b = await brandingFor(res, code, { logoId: req.query.logoId }); if (!b) return;
  const logo = b.logo?.url ? await fetchImage(b.logo.url) : null;
  const pdf = await buildBlankStaffFormPdf({ settings: b.settings, logo, countryName: COUNTRY_NAMES[code] || code });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="staff-information-form-${code}.pdf"`);
  res.setHeader("Cache-Control", "no-store");
  return res.send(pdf);
}

/** POST /forms/staff-form/send {to, logoId, countryCode} → e-mails the blank form as a PDF attachment. */
export async function emailBlankForm(req, res) {
  const scope = scopeOr403(req, res); if (!scope) return;
  const code = targetCountry(req, res, scope, req.body.countryCode); if (!code) return;
  const to = String(req.body.to || "").trim().toLowerCase();
  if (!EMAIL.test(to) || to.length > 160) return fail(res, 400, "Enter a valid e-mail address");
  const b = await brandingFor(res, code, { logoId: req.body.logoId }); if (!b) return;
  const logo = b.logo?.url ? await fetchImage(b.logo.url) : null;
  const pdf = await buildBlankStaffFormPdf({ settings: b.settings, logo, countryName: COUNTRY_NAMES[code] || code });
  let out;
  try { out = await sendStaffFormMail({ countryCode: code, to, company: b.settings.companyName, pdf }); }
  catch (e) { return fail(res, 502, "The e-mail could not be sent: " + String(e.message || e).slice(0, 120)); }
  if (out?.suppressed) return fail(res, 409, "E-mail sending is disabled for this country");
  await log(req, "HR_FORM_EMAIL", `E-mailed the blank staff form (${code}) to ${to}`);
  return ok(res, { sent: true, to });
}

/**
 * POST /staff/:id/export {password, logoId, signatureId, includeSensitive}
 * The caller must re-enter THEIR OWN password. Wrong password → 403 (counted); too many → 429.
 */
export async function exportStaffDetails(req, res) {
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const wait = lockedFor(req.user._id);
  if (wait) { res.setHeader("Retry-After", String(wait)); return fail(res, 429, `Too many wrong passwords. Try again in ${Math.ceil(wait / 60)} minute(s).`, { retryAfter: wait }); }
  const f = await loadStaff(req, res, req.params.id); if (!f) return;
  if (!password) return fail(res, 400, "Password is required to export staff details");
  const me = await User.findById(req.user._id).select("+password");
  if (!me?.password) return fail(res, 400, "This account has no password set (social sign-in). Set a password first to export staff details.");
  if (!(await bcryptjs.compare(password, me.password))) {
    recordFail(req.user._id);
    await log(req, "HR_EXPORT_DENIED", `Wrong password while exporting staff details of ${f.doc.fullName} (${f.doc.employeeId})`, { resourceId: f.doc._id, resourceName: f.doc.fullName });
    const left = lockedFor(req.user._id);
    return fail(res, left ? 429 : 403, left ? "Too many wrong passwords. Locked for 15 minutes." : "Incorrect password", left ? { retryAfter: left } : {});
  }
  fails.delete(String(req.user._id));

  const includeSensitive = req.body.includeSensitive === true;
  const b = await brandingFor(res, f.doc.countryCode, { logoId: req.body.logoId, signatureId: req.body.signatureId }); if (!b) return;
  const [logo, signature, photo] = await Promise.all([b.logo?.url ? fetchImage(b.logo.url) : null, b.signature?.url ? fetchImage(b.signature.url) : null, f.doc.photoUrl ? fetchImage(f.doc.photoUrl) : null]);
  const pdf = await buildStaffDetailsPdf({
    staff: serializeStaff(f.doc), sensitive: includeSensitive ? revealSensitive(f.doc) : null, settings: b.settings, logo, photo, signature,
    signer: b.signature ? { name: b.signature.signerName, title: b.signature.signerTitle } : null,
    exportedBy: req.user.name || req.user.email || "HR", countryName: COUNTRY_NAMES[f.doc.countryCode] || f.doc.countryCode,
  });
  await log(req, "HR_STAFF_EXPORT", `Exported staff details PDF of ${f.doc.fullName} (${f.doc.employeeId})${includeSensitive ? " including sensitive data" : ""}`, { resourceId: f.doc._id, resourceName: f.doc.fullName });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="staff-${f.doc.employeeId}.pdf"`);
  res.setHeader("Cache-Control", "no-store");
  return res.send(pdf);
}
