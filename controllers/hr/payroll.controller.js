// server/controllers/hr/payroll.controller.js
//
// Payroll runs (country + month): build → adjust → preview/download PDF → approve (signs with the
// uploaded signature) → e-mail payslips + signed register → mark paid. Money is integer minor units.
import HrPayroll from "../../models/hr/hr-payroll.model.js";
import HrSettings from "../../models/hr/hr-settings.model.js";
import { featureCountryFilter, resolveCreateCountry } from "../../utils/featureScope.js";
import { buildRun, sumTotals } from "../../services/hr/payroll.js";
import { buildPayrollRegisterPdf, buildPayslipPdf, fetchImage } from "../../services/hr/pdf.js";
import { resolveBranding } from "../../services/hr/branding.js";
import { sendPayslipMail, sendPayrollSummaryMail } from "../../services/hr/mail.js";
import { isPeriod, localDate, toMinor, maskAccount, fmtMoney } from "../../services/hr/common.js";
import { sanitizeText } from "../../utils/campaignValidation.js";
import { logActivity } from "../../utils/activityLogger.js";
import { ok, fail, isId, scopeOr403, countryWhere, paging, duplicate } from "./shared.js";

const log = (req, action, description, run) => logActivity({ userId: req.user._id, action, description, resourceType: "Payroll", resourceId: run?._id, resourceName: run ? `${run.countryCode} ${run.period}` : "", req });
const hist = (run, req, action, note = "") => { run.history.push({ at: new Date(), byName: req.user.name || req.user.email, action, note }); if (run.history.length > 100) run.history.splice(0, run.history.length - 100); };

/** JSON never carries full account numbers or tax ids (the PDF register does — it is the payment instruction). */
export function serializeRun(run) {
  const o = run.toObject ? run.toObject() : run;
  return { ...o, lines: (o.lines || []).map((l) => ({ ...l, bank: { bankName: l.bank?.bankName, accountName: l.bank?.accountName, branch: l.bank?.branch, sortCode: l.bank?.sortCode, accountMasked: maskAccount((l.bank?.accountNumber || "").slice(-4)), hasAccountNumber: !!l.bank?.accountNumber } })) };
}
async function loadRun(req, res) {
  const scope = scopeOr403(req, res); if (!scope) return null;
  if (!isId(req.params.id)) { fail(res, 404, "Payroll run not found"); return null; }
  const run = await HrPayroll.findOne({ _id: req.params.id, ...featureCountryFilter(scope) });
  if (!run) { fail(res, 404, "Payroll run not found"); return null; }
  return run;
}
const applyBuilt = (run, built) => { run.currency = built.currency; run.decimals = built.decimals; run.workingDays = built.workingDays; run.lines = built.lines; run.totals = built.totals; };

export async function listPayrolls(req, res) {
  const c = countryWhere(req, res); if (!c) return;
  const { page, limit, skip } = paging(req, 12);
  const where = { ...c.where };
  if (req.query.status) where.status = String(req.query.status);
  const [rows, total] = await Promise.all([HrPayroll.find(where).sort({ period: -1 }).skip(skip).limit(limit).select("-lines").lean(), HrPayroll.countDocuments(where)]);
  return ok(res, rows, { pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}
export async function getPayroll(req, res) { const run = await loadRun(req, res); if (run) return ok(res, serializeRun(run)); }

export async function createPayroll(req, res) {
  const scope = scopeOr403(req, res); if (!scope) return;
  const t = resolveCreateCountry(scope, req.body.countryCode);
  if (t.error) return fail(res, t.error.status, t.error.message);
  const { period } = req.body;
  if (!isPeriod(period)) return fail(res, 400, "period must be YYYY-MM");
  if (period > localDate().slice(0, 7)) return fail(res, 400, "You cannot create payroll for a future month");
  if (await HrPayroll.exists({ countryCode: t.countryCode, period })) return fail(res, 409, `A payroll run for ${period} already exists in ${t.countryCode}`);
  const built = await buildRun(t.countryCode, period);
  if (!built.lines.length) return fail(res, 422, "No eligible staff with a salary for that month");
  const chosen = await chooseBranding(t.countryCode, req.body);
  if (chosen.error) return fail(res, 400, chosen.error);
  const run = new HrPayroll({ countryCode: t.countryCode, period, createdBy: req.user._id, branding: chosen.branding });
  applyBuilt(run, built); hist(run, req, "CREATED", `${built.lines.length} staff`);
  try { await run.save(); } catch (e) { if (duplicate(e)) return fail(res, 409, "A payroll run for that month already exists"); throw e; }
  await log(req, "HR_PAYROLL_CHANGE", `Created payroll ${t.countryCode} ${period} (${built.lines.length} staff)`, run);
  return ok(res, serializeRun(run));
}

/** Validate the logo/signature HR picked (ids from the country's HR settings). Empty id = "use the default". */
async function chooseBranding(countryCode, body = {}) {
  const settings = (await HrSettings.findOne({ countryCode }).lean()) || {};
  const logoId = body.logoId ? String(body.logoId) : "", signatureId = body.signatureId ? String(body.signatureId) : "";
  const r = resolveBranding(settings, { logoId, signatureId });
  if (r.error) return { error: r.error };
  return { branding: { logoId, signatureId, logoUrl: "" }, resolved: r, settings };
}

/** PUT /payroll/:id/branding { logoId?, signatureId? } — change the logo/signature of a DRAFT run. */
export async function setPayrollBranding(req, res) {
  const run = await loadRun(req, res); if (!run) return;
  if (run.status !== "DRAFT") return fail(res, 409, "The logo and signature are locked once the payroll is approved");
  const chosen = await chooseBranding(run.countryCode, req.body);
  if (chosen.error) return fail(res, 400, chosen.error);
  run.branding = chosen.branding; hist(run, req, "BRANDING", "logo/signature changed");
  await run.save();
  return ok(res, serializeRun(run));
}

export async function recalcPayroll(req, res) {
  const run = await loadRun(req, res); if (!run) return;
  if (run.status !== "DRAFT") return fail(res, 409, "Only draft payroll can be recalculated");
  const built = await buildRun(run.countryCode, run.period, run.lines.map((l) => l.toObject()));
  if (!built.lines.length) return fail(res, 422, "No eligible staff with a salary for that month");
  applyBuilt(run, built); hist(run, req, "RECALCULATED");
  await run.save();
  await log(req, "HR_PAYROLL_CHANGE", `Recalculated payroll ${run.countryCode} ${run.period}`, run);
  return ok(res, serializeRun(run));
}

/** PUT /payroll/:id/lines/:staffId { bonus, overtime, otherDeductions, note } (major units) */
export async function updatePayrollLine(req, res) {
  const run = await loadRun(req, res); if (!run) return;
  if (run.status !== "DRAFT") return fail(res, 409, "Only draft payroll can be edited");
  const line = run.lines.find((l) => String(l.staffId) === req.params.staffId);
  if (!line) return fail(res, 404, "Staff not on this payroll");
  for (const k of ["bonus", "overtime", "otherDeductions"]) {
    if (req.body[k] === undefined) continue;
    const n = Number(req.body[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e12) return fail(res, 400, `${k} must be a positive number`);
    line[k] = toMinor(n, run.decimals);
  }
  if (req.body.note !== undefined) line.note = sanitizeText(req.body.note, 200);
  const built = await buildRun(run.countryCode, run.period, run.lines.map((l) => l.toObject()));
  applyBuilt(run, built); hist(run, req, "LINE_EDITED", line.fullName);
  await run.save();
  await log(req, "HR_PAYROLL_CHANGE", `Adjusted payroll line ${line.fullName} (${run.period})`, run);
  return ok(res, serializeRun(run));
}

export async function deletePayroll(req, res) {
  const run = await loadRun(req, res); if (!run) return;
  if (run.status !== "DRAFT") return fail(res, 409, "Only draft payroll can be deleted");
  await run.deleteOne();
  await log(req, "HR_PAYROLL_CHANGE", `Deleted draft payroll ${run.countryCode} ${run.period}`, run);
  return ok(res, { deleted: true });
}

export async function approvePayroll(req, res) {
  const run = await loadRun(req, res); if (!run) return;
  if (run.status !== "DRAFT") return fail(res, 409, `Payroll is already ${run.status.toLowerCase()}`);
  if (!run.lines.length) return fail(res, 422, "Payroll has no staff");
  const settings = await HrSettings.findOne({ countryCode: run.countryCode }).lean();
  const sigId = req.body.signatureId ? String(req.body.signatureId) : run.branding?.signatureId || "";
  const picked = resolveBranding(settings || {}, { logoId: run.branding?.logoId, signatureId: sigId });
  if (picked.error) return fail(res, 400, picked.error);
  const sig = picked.signature;
  const signerName = sig?.signerName || settings?.signerName;
  if (!sig?.url || !signerName) return fail(res, 422, "Upload the authorised signature and signer name in HR settings before approving", { code: "SIGNATURE_REQUIRED" });
  if (run.lines.some((l) => !l.bank?.accountNumber || !l.bank?.bankName)) {
    if (req.body.allowMissingBank !== true) return fail(res, 422, "Some staff have no bank details", { code: "MISSING_BANK", staff: run.lines.filter((l) => !l.bank?.accountNumber || !l.bank?.bankName).map((l) => l.fullName) });
  }
  run.status = "APPROVED"; run.approvedAt = new Date();
  run.signedBy = { name: signerName, title: sig.signerTitle || settings.signerTitle, signatureUrl: sig.url, signedAt: new Date(), userId: req.user._id };
  run.branding = { logoId: run.branding?.logoId || "", signatureId: sigId, logoUrl: picked.logo?.url || "" }; // frozen with the signature
  hist(run, req, "APPROVED", `signed by ${signerName}`);
  await run.save();
  await log(req, "HR_PAYROLL_CHANGE", `Approved & signed payroll ${run.countryCode} ${run.period}`, run);
  return ok(res, serializeRun(run));
}

export async function markPaid(req, res) {
  const run = await loadRun(req, res); if (!run) return;
  if (run.status !== "APPROVED") return fail(res, 409, "Only approved payroll can be marked paid");
  run.status = "PAID"; run.paidAt = new Date(); hist(run, req, "PAID");
  await run.save();
  await log(req, "HR_PAYROLL_CHANGE", `Marked payroll ${run.countryCode} ${run.period} as paid`, run);
  return ok(res, serializeRun(run));
}

async function pdfAssets(run) {
  const settings = (await HrSettings.findOne({ countryCode: run.countryCode }).lean()) || {};
  const logoUrl = run.branding?.logoUrl || resolveBranding(settings, { logoId: run.branding?.logoId }).logo?.url || settings.logoUrl;
  const [logo, signature] = await Promise.all([logoUrl ? fetchImage(logoUrl) : null, run.signedBy?.signatureUrl ? fetchImage(run.signedBy.signatureUrl) : settings.signatureUrl && run.status !== "DRAFT" ? fetchImage(settings.signatureUrl) : null]);
  return { settings, logo, signature };
}
const plain = (run) => ({ ...run.toObject(), lines: run.lines.map((l) => l.toObject()) });

/** GET /payroll/:id/preview|download[?staffId=] — register PDF, or one payslip with ?staffId. Drafts are watermarked by status text. */
export const previewPayroll = (req, res) => sendPdf(req, res, "inline");
export const downloadPayroll = (req, res) => sendPdf(req, res, "attachment");
async function sendPdf(req, res, disposition) {
  const run = await loadRun(req, res); if (!run) return;
  const { settings, logo, signature } = await pdfAssets(run);
  const r = plain(run);
  let buf, name;
  if (req.query.staffId) {
    const line = r.lines.find((l) => String(l.staffId) === req.query.staffId);
    if (!line) return fail(res, 404, "Staff not on this payroll");
    buf = await buildPayslipPdf({ run: r, line, settings, logo, signature, maskBank: false });
    name = `payslip-${run.period}-${line.employeeId}.pdf`;
  } else {
    buf = await buildPayrollRegisterPdf({ run: r, settings, logo, signature });
    name = `payroll-${run.countryCode}-${run.period}.pdf`;
  }
  if (disposition === "attachment") await log(req, "HR_PAYROLL_CHANGE", `Downloaded payroll ${req.query.staffId ? "payslip" : "register"} ${run.countryCode} ${run.period}`, run);
  res.set({ "Content-Type": "application/pdf", "Content-Disposition": `${disposition}; filename="${name}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  return res.send(buf);
}

/** POST /payroll/:id/send { staffIds?:[], includeSummary?:bool } */
export async function sendPayroll(req, res) {
  const run = await loadRun(req, res); if (!run) return;
  if (!["APPROVED", "PAID"].includes(run.status)) return fail(res, 409, "Approve (sign) the payroll before sending");
  const want = Array.isArray(req.body.staffIds) && req.body.staffIds.length ? new Set(req.body.staffIds.map(String)) : null;
  const targets = run.lines.filter((l) => !want || want.has(String(l.staffId)));
  if (targets.length > 300) return fail(res, 400, "Send in batches of at most 300");
  const { settings, logo, signature } = await pdfAssets(run);
  const r = plain(run);
  const result = { sent: [], failed: [], noEmail: [], summary: null };
  for (const line of run.lines) {
    if (!targets.includes(line)) continue;
    if (!line.email) { result.noEmail.push(line.fullName); continue; }
    try {
      const pdf = await buildPayslipPdf({ run: r, line: line.toObject(), settings, logo, signature, maskBank: true });
      const out = await sendPayslipMail({ countryCode: run.countryCode, to: line.email, name: line.fullName, period: run.period, pdf });
      if (out?.suppressed) { result.failed.push({ name: line.fullName, reason: "Sending disabled" }); continue; }
      line.payslipSentAt = new Date(); result.sent.push(line.fullName);
    } catch (e) { result.failed.push({ name: line.fullName, reason: String(e.message || e).slice(0, 120) }); }
  }
  if (req.body.includeSummary !== false && settings.payrollNotifyEmails?.length) {
    try {
      const pdf = await buildPayrollRegisterPdf({ run: r, settings, logo, signature });
      for (const to of settings.payrollNotifyEmails) await sendPayrollSummaryMail({ countryCode: run.countryCode, to, period: run.period, count: run.lines.length, pdf });
      run.summarySentAt = new Date(); result.summary = { sentTo: settings.payrollNotifyEmails.length };
    } catch (e) { result.summary = { error: String(e.message || e).slice(0, 120) }; }
  }
  hist(run, req, "SENT", `${result.sent.length} payslips`);
  await run.save();
  await log(req, "HR_PAYROLL_SEND", `Sent payroll ${run.countryCode} ${run.period}: ${result.sent.length} payslips, ${result.failed.length} failed, ${result.noEmail.length} without e-mail`, run);
  return ok(res, result);
}
void sumTotals; void fmtMoney;
