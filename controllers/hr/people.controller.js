// server/controllers/hr/people.controller.js — leave, appraisals and the HR dashboard.
import HrLeave, { LEAVE_TYPES } from "../../models/hr/hr-leave.model.js";
import HrAppraisal from "../../models/hr/hr-appraisal.model.js";
import HrAttendance from "../../models/hr/hr-attendance.model.js";
import HrStaff from "../../models/hr/hr-staff.model.js";
import HrPayroll from "../../models/hr/hr-payroll.model.js";
import User from "../../models/user.model.js";
import { holidaySet } from "../../services/hr/payroll.js";
import { workingDays, isDateStr, localDate, countryTimezone } from "../../services/hr/common.js";
import { sendLeaveDecisionMail } from "../../services/hr/mail.js";
import { sanitizeText } from "../../utils/campaignValidation.js";
import { logActivity } from "../../utils/activityLogger.js";
import { featureCountryFilter } from "../../utils/featureScope.js";
import { ok, fail, isId, scopeOr403, countryWhere, paging, loadStaff, myStaff } from "./shared.js";

const log = (req, action, description, staff, extra = {}) => logActivity({ userId: req.user._id, action, description, resourceType: "Staff", resourceId: staff?._id, resourceName: staff?.fullName || "", req, ...extra });

// ───────────── leave ─────────────
async function leaveBalance(staff, year) {
  const used = await HrLeave.aggregate([
    { $match: { staffId: staff._id, type: "ANNUAL", status: "APPROVED", from: { $gte: `${year}-01-01`, $lte: `${year}-12-31` } } },
    { $group: { _id: null, days: { $sum: "$days" } } },
  ]);
  const taken = used[0]?.days || 0;
  return { entitlement: staff.leaveEntitlementDays, taken, remaining: Math.max(0, staff.leaveEntitlementDays - taken) };
}

async function makeLeave(req, res, staff, requestedBy) {
  const { type, from, to } = req.body;
  if (!LEAVE_TYPES.includes(type)) return fail(res, 400, "Leave type is invalid");
  if (!isDateStr(from) || !isDateStr(to) || to < from) return fail(res, 400, "Valid from/to dates are required (to must not precede from)");
  const days = workingDays(from, to, await holidaySet(staff.countryCode, from, to)).length;
  if (days < 1) return fail(res, 400, "That range contains no working days");
  if (days > 120) return fail(res, 400, "Leave cannot exceed 120 working days per request");
  const overlap = await HrLeave.exists({ staffId: staff._id, status: { $in: ["PENDING", "APPROVED"] }, from: { $lte: to }, to: { $gte: from } });
  if (overlap) return fail(res, 409, "You already have leave pending or approved in that period");
  if (type === "ANNUAL") {
    const bal = await leaveBalance(staff, from.slice(0, 4));
    if (days > bal.remaining) return fail(res, 422, `Only ${bal.remaining} annual leave day(s) remaining`, { balance: bal });
  }
  const doc = await HrLeave.create({ countryCode: staff.countryCode, staffId: staff._id, type, from, to, days, reason: sanitizeText(req.body.reason, 500), requestedBy });
  await log(req, "HR_LEAVE_CHANGE", `Leave ${type} requested for ${staff.fullName}: ${from} → ${to} (${days}d)`, staff);
  return ok(res, doc);
}

export async function listLeave(req, res) {
  const c = countryWhere(req, res); if (!c) return;
  const { page, limit, skip } = paging(req);
  const where = { ...c.where };
  if (req.query.status) where.status = String(req.query.status);
  if (req.query.staffId && isId(req.query.staffId)) where.staffId = req.query.staffId;
  const [rows, total] = await Promise.all([HrLeave.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit).populate("staffId", "fullName employeeId employment.department").lean(), HrLeave.countDocuments(where)]);
  return ok(res, rows, { pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}
export async function createLeaveForStaff(req, res) {
  const f = await loadStaff(req, res, req.body.staffId); if (!f) return;
  return makeLeave(req, res, f.doc, req.user._id);
}
export async function decideLeave(req, res) {
  const scope = scopeOr403(req, res); if (!scope) return;
  if (!isId(req.params.id)) return fail(res, 404, "Leave request not found");
  const doc = await HrLeave.findOne({ _id: req.params.id, ...featureCountryFilter(scope) });
  if (!doc) return fail(res, 404, "Leave request not found");
  const status = req.body.status;
  if (!["APPROVED", "REJECTED"].includes(status)) return fail(res, 400, "status must be APPROVED or REJECTED");
  if (doc.status !== "PENDING") return fail(res, 409, `Request is already ${doc.status.toLowerCase()}`);
  const staff = await HrStaff.findById(doc.staffId);
  if (status === "APPROVED" && doc.type === "ANNUAL") {
    const bal = await leaveBalance(staff, doc.from.slice(0, 4));
    if (doc.days > bal.remaining) return fail(res, 422, `Only ${bal.remaining} annual leave day(s) remaining`, { balance: bal });
  }
  doc.status = status; doc.decidedBy = req.user._id; doc.decidedAt = new Date(); doc.decisionNote = sanitizeText(req.body.note, 300);
  await doc.save();
  await log(req, "HR_LEAVE_CHANGE", `Leave ${status.toLowerCase()} for ${staff?.fullName}: ${doc.from} → ${doc.to}`, staff);
  const u = staff?.userId ? await User.findById(staff.userId).select("email").lean() : null;
  await sendLeaveDecisionMail({ countryCode: doc.countryCode, to: u?.email || staff?.personalEmail, name: staff?.fullName, from: doc.from, toDate: doc.to, status: status.toLowerCase(), note: doc.decisionNote });
  return ok(res, doc);
}
export async function myLeave(req, res) {
  const staff = await myStaff(req);
  if (!staff) return ok(res, { rows: [], balance: null });
  const year = /^\d{4}$/.test(req.query.year || "") ? req.query.year : String(new Date().getUTCFullYear());
  return ok(res, { rows: await HrLeave.find({ staffId: staff._id }).sort({ createdAt: -1 }).limit(50).lean(), balance: await leaveBalance(staff, year) });
}
export async function requestMyLeave(req, res) {
  const staff = await myStaff(req);
  if (!staff) return fail(res, 404, "You don't have an HR profile yet");
  return makeLeave(req, res, staff, req.user._id);
}
export async function cancelMyLeave(req, res) {
  const staff = await myStaff(req);
  if (!staff || !isId(req.params.id)) return fail(res, 404, "Leave request not found");
  const doc = await HrLeave.findOne({ _id: req.params.id, staffId: staff._id });
  if (!doc) return fail(res, 404, "Leave request not found");
  if (doc.status !== "PENDING") return fail(res, 409, "Only pending requests can be cancelled");
  doc.status = "CANCELLED"; await doc.save();
  return ok(res, doc);
}

// ───────────── appraisals ─────────────
export function computeRating({ goals = [], competencies = [] }) {
  const parts = [];
  const wsum = goals.reduce((s, g) => s + (g.weight || 0), 0);
  if (goals.length) parts.push(wsum > 0 ? goals.reduce((s, g) => s + (g.score || 0) * (g.weight || 0), 0) / wsum : goals.reduce((s, g) => s + (g.score || 0), 0) / goals.length);
  if (competencies.length) parts.push(competencies.reduce((s, c) => s + (c.rating || 0), 0) / competencies.length);
  return parts.length ? Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100) / 100 : 0;
}
function appraisalInput(b, partial) {
  const errors = [], d = {};
  if (!partial || b.period !== undefined) { const p = sanitizeText(b.period, 30); p ? (d.period = p) : errors.push("Period is required (e.g. 2026-H2)"); }
  if (b.cycle !== undefined) ["PROBATION", "QUARTERLY", "HALF_YEARLY", "ANNUAL"].includes(b.cycle) ? (d.cycle = b.cycle) : errors.push("Cycle is invalid");
  const score = (v, lbl) => { const n = Number(v); if (!(n >= 0 && n <= 5)) { errors.push(`${lbl} must be 0–5`); return 0; } return n; };
  if (b.goals !== undefined) {
    if (!Array.isArray(b.goals) || b.goals.length > 20) errors.push("Up to 20 goals");
    else d.goals = b.goals.map((g) => ({ title: sanitizeText(g.title, 150), weight: Math.min(100, Math.max(0, Number(g.weight) || 0)), score: score(g.score ?? 0, "Goal score"), comment: sanitizeText(g.comment, 300) }));
  }
  if (b.competencies !== undefined) {
    if (!Array.isArray(b.competencies) || b.competencies.length > 20) errors.push("Up to 20 competencies");
    else d.competencies = b.competencies.map((c) => ({ name: sanitizeText(c.name, 80), rating: score(c.rating ?? 0, "Rating") }));
  }
  for (const [k, m] of [["strengths", 1500], ["improvements", 1500], ["comments", 1500]]) if (b[k] !== undefined) d[k] = sanitizeText(b[k], m);
  if (b.recommendedAction !== undefined) ["NONE", "INCREMENT", "PROMOTION", "BONUS", "TRAINING", "PIP", "CONFIRMATION"].includes(b.recommendedAction) ? (d.recommendedAction = b.recommendedAction) : errors.push("Recommended action is invalid");
  return { errors, d };
}
async function loadAppraisal(req, res) {
  const scope = scopeOr403(req, res); if (!scope) return null;
  if (!isId(req.params.id)) { fail(res, 404, "Appraisal not found"); return null; }
  const doc = await HrAppraisal.findOne({ _id: req.params.id, ...featureCountryFilter(scope) });
  if (!doc) { fail(res, 404, "Appraisal not found"); return null; }
  return doc;
}
export async function listAppraisals(req, res) {
  const c = countryWhere(req, res); if (!c) return;
  const { page, limit, skip } = paging(req);
  const where = { ...c.where };
  if (req.query.staffId && isId(req.query.staffId)) where.staffId = req.query.staffId;
  if (req.query.status) where.status = String(req.query.status);
  const [rows, total] = await Promise.all([HrAppraisal.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit).populate("staffId", "fullName employeeId employment.department employment.jobTitle").lean(), HrAppraisal.countDocuments(where)]);
  return ok(res, rows, { pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}
export async function getAppraisal(req, res) { const d = await loadAppraisal(req, res); if (d) return ok(res, d); }
export async function createAppraisal(req, res) {
  const f = await loadStaff(req, res, req.body.staffId); if (!f) return;
  const { errors, d } = appraisalInput(req.body, false);
  if (errors.length) return fail(res, 400, errors[0], { errors });
  if (await HrAppraisal.exists({ staffId: f.doc._id, period: d.period })) return fail(res, 409, "An appraisal for that period already exists");
  const doc = await HrAppraisal.create({ ...d, countryCode: f.doc.countryCode, staffId: f.doc._id, reviewerId: req.user._id, reviewerName: req.user.name || req.user.email, overallRating: computeRating(d), createdBy: req.user._id });
  await log(req, "HR_APPRAISAL_CHANGE", `Appraisal ${d.period} drafted for ${f.doc.fullName}`, f.doc);
  return ok(res, doc);
}
export async function updateAppraisal(req, res) {
  const doc = await loadAppraisal(req, res); if (!doc) return;
  if (doc.status !== "DRAFT") return fail(res, 409, "Submitted appraisals can no longer be edited");
  const { errors, d } = appraisalInput(req.body, true);
  if (errors.length) return fail(res, 400, errors[0], { errors });
  Object.assign(doc, d); doc.overallRating = computeRating(doc);
  await doc.save();
  return ok(res, doc);
}
export async function submitAppraisal(req, res) {
  const doc = await loadAppraisal(req, res); if (!doc) return;
  if (doc.status !== "DRAFT") return fail(res, 409, "Already submitted");
  if (!doc.goals.length && !doc.competencies.length) return fail(res, 400, "Add at least one goal or competency rating before submitting");
  doc.status = "SUBMITTED"; doc.submittedAt = new Date(); doc.overallRating = computeRating(doc);
  await doc.save();
  const staff = await HrStaff.findById(doc.staffId);
  await log(req, "HR_APPRAISAL_CHANGE", `Appraisal ${doc.period} submitted for ${staff?.fullName} (rating ${doc.overallRating})`, staff);
  return ok(res, doc);
}
export async function deleteAppraisal(req, res) {
  const doc = await loadAppraisal(req, res); if (!doc) return;
  if (doc.status !== "DRAFT") return fail(res, 409, "Only draft appraisals can be deleted");
  await doc.deleteOne();
  return ok(res, { deleted: true });
}
export async function myAppraisals(req, res) {
  const staff = await myStaff(req);
  if (!staff) return ok(res, []);
  return ok(res, await HrAppraisal.find({ staffId: staff._id, status: { $in: ["SUBMITTED", "ACKNOWLEDGED"] } }).sort({ createdAt: -1 }).lean());
}
export async function acknowledgeMyAppraisal(req, res) {
  const staff = await myStaff(req);
  if (!staff || !isId(req.params.id)) return fail(res, 404, "Appraisal not found");
  const doc = await HrAppraisal.findOne({ _id: req.params.id, staffId: staff._id });
  if (!doc) return fail(res, 404, "Appraisal not found");
  if (doc.status !== "SUBMITTED") return fail(res, 409, "Nothing to acknowledge");
  doc.status = "ACKNOWLEDGED"; doc.acknowledgedAt = new Date(); await doc.save();
  return ok(res, doc);
}

// ───────────── dashboard ─────────────
export async function dashboard(req, res) {
  const c = countryWhere(req, res); if (!c) return;
  const today = localDate(new Date(), countryTimezone(c.scope.countryCode || "NG"));
  const in30 = new Date(Date.now() + 30 * 86400000);
  const active = { ...c.where, "employment.status": { $in: ["ACTIVE", "ON_LEAVE"] } };
  const [headcount, byMode, byDept, presentToday, pendingLeave, onLeaveToday, staff, latestPayroll] = await Promise.all([
    HrStaff.countDocuments(active),
    HrStaff.aggregate([{ $match: active }, { $group: { _id: "$employment.workMode", n: { $sum: 1 } } }]),
    HrStaff.aggregate([{ $match: active }, { $group: { _id: "$employment.department", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 8 }]),
    HrAttendance.aggregate([{ $match: { ...c.where, date: today, type: { $in: ["OFFICE", "REMOTE"] } } }, { $group: { _id: "$type", n: { $sum: 1 } } }]),
    HrLeave.countDocuments({ ...c.where, status: "PENDING" }),
    HrLeave.countDocuments({ ...c.where, status: "APPROVED", from: { $lte: today }, to: { $gte: today } }),
    HrStaff.find(active).select("fullName employeeId dateOfBirth employment.probationEndDate employment.contractEndDate").lean(),
    HrPayroll.findOne({ ...c.where }).sort({ period: -1 }).select("period status totals currency countryCode").lean(),
  ]);
  const birthdays = staff.filter((s) => s.dateOfBirth).map((s) => {
    const d = new Date(s.dateOfBirth); let n = new Date(Date.UTC(new Date().getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    if (n < new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z")) n = new Date(Date.UTC(n.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate()));
    return { fullName: s.fullName, employeeId: s.employeeId, date: n.toISOString().slice(0, 10) };
  }).filter((b) => new Date(b.date) <= in30).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10);
  const ending = (k) => staff.filter((s) => s.employment?.[k] && new Date(s.employment[k]) >= new Date() && new Date(s.employment[k]) <= in30).map((s) => ({ fullName: s.fullName, employeeId: s.employeeId, date: new Date(s.employment[k]).toISOString().slice(0, 10) }));
  const pm = Object.fromEntries(presentToday.map((p) => [p._id, p.n]));
  return ok(res, { today, headcount, byWorkMode: Object.fromEntries(byMode.map((b) => [b._id, b.n])), byDepartment: byDept.map((d) => ({ department: d._id || "—", count: d.n })), presentToday: { office: pm.OFFICE || 0, remote: pm.REMOTE || 0 }, pendingLeave, onLeaveToday, upcomingBirthdays: birthdays, probationEnding: ending("probationEndDate"), contractsEnding: ending("contractEndDate"), latestPayroll });
}
