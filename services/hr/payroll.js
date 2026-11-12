// server/services/hr/payroll.js — payroll maths (integer minor units) and run construction.
import HrStaff from "../../models/hr/hr-staff.model.js";
import HrLeave from "../../models/hr/hr-leave.model.js";
import HrHoliday from "../../models/hr/hr-holiday.model.js";
import HrSettings from "../../models/hr/hr-settings.model.js";
import User from "../../models/user.model.js";
import { decryptSecret } from "../../utils/encryption.js";
import { toMinor, periodBounds, workingDays, countryCurrency } from "./common.js";

/**
 * Pure: one payslip line in MINOR units.
 *   gross = base + allowances + bonus + overtime − unpaidLeaveDeduction
 *   deductions: FIXED amount, or PERCENT of BASE / GROSS
 *   net = max(0, gross − deductions − otherDeductions)
 */
export function calcLine(salary, adj = {}, { decimals = 2, workingDays: wd = 22 } = {}) {
  const base = toMinor(salary.baseSalary, decimals);
  const allowances = (salary.allowances || []).map((a) => ({ name: a.name, amount: toMinor(a.amount, decimals) }));
  const bonus = Math.max(0, toMinor(adj.bonus, decimals));
  const overtime = Math.max(0, toMinor(adj.overtime, decimals));
  const unpaidLeaveDays = Math.max(0, Number(adj.unpaidLeaveDays) || 0);
  const unpaidLeaveDeduction = Math.min(base, Math.round((base * unpaidLeaveDays) / Math.max(1, wd)));
  const gross = base + allowances.reduce((s, a) => s + a.amount, 0) + bonus + overtime - unpaidLeaveDeduction;
  const deductions = (salary.deductions || []).map((d) => ({
    name: d.name,
    amount: d.type === "PERCENT" ? Math.round(((d.of === "BASE" ? base : gross) * Number(d.value)) / 100) : toMinor(d.value, decimals),
  }));
  const otherDeductions = Math.max(0, toMinor(adj.otherDeductions, decimals));
  const totalDeductions = deductions.reduce((s, d) => s + d.amount, 0) + otherDeductions;
  const net = Math.max(0, gross - totalDeductions);
  return { baseSalary: base, allowances, bonus, overtime, unpaidLeaveDays, unpaidLeaveDeduction, deductions, otherDeductions, gross, totalDeductions, net };
}

export const sumTotals = (lines) => ({
  gross: lines.reduce((s, l) => s + l.gross, 0),
  deductions: lines.reduce((s, l) => s + l.totalDeductions, 0),
  net: lines.reduce((s, l) => s + l.net, 0),
  headcount: lines.length,
});

export async function holidaySet(countryCode, from, to) {
  const hs = await HrHoliday.find({ countryCode, date: { $gte: from, $lte: to } }).lean();
  return new Set(hs.map((h) => h.date));
}

/** Approved UNPAID leave working-days falling inside the period, per staff. */
async function unpaidDaysByStaff(countryCode, period, holidays) {
  const { from, to } = periodBounds(period);
  const leaves = await HrLeave.find({ countryCode, type: "UNPAID", status: "APPROVED", from: { $lte: to }, to: { $gte: from } }).lean();
  const m = new Map();
  for (const l of leaves) {
    const days = workingDays(l.from < from ? from : l.from, l.to > to ? to : l.to, holidays).length;
    m.set(String(l.staffId), (m.get(String(l.staffId)) || 0) + days);
  }
  return m;
}

export const decOrEmpty = (v) => { try { return decryptSecret(v); } catch { return ""; } };

/** Snapshot a staff member into a payroll line (bank details decrypted here — payroll output needs them). */
export async function buildLine(staff, adj, ctx, email) {
  const calc = calcLine(staff.salary, adj, ctx);
  return {
    staffId: staff._id, userId: staff.userId || null, employeeId: staff.employeeId, fullName: staff.fullName, email: email || staff.personalEmail || "",
    jobTitle: staff.employment?.jobTitle || "", department: staff.employment?.department || "",
    bank: {
      bankName: staff.bank?.bankName || "", accountName: staff.bank?.accountName || staff.fullName, accountNumber: decOrEmpty(staff.bank?.accountNumberEnc),
      branch: staff.bank?.branch || "", sortCode: staff.bank?.sortCode || "", taxId: decOrEmpty(staff.bank?.taxIdEnc), pensionId: staff.bank?.pensionId || "",
    },
    ...calc,
    note: adj.note || "",
  };
}

/** Staff on payroll for a period: ACTIVE/ON_LEAVE, started on/before period end, not ended before period start, salary > 0. */
export async function eligibleStaff(countryCode, period) {
  const { from, to } = periodBounds(period);
  const all = await HrStaff.find({ countryCode, "employment.status": { $in: ["ACTIVE", "ON_LEAVE"] }, "salary.baseSalary": { $gt: 0 } }).sort({ fullName: 1 });
  return all.filter((s) => {
    const st = s.employment?.startDate, en = s.employment?.endDate;
    return (!st || st <= new Date(to + "T23:59:59Z")) && (!en || en >= new Date(from + "T00:00:00Z"));
  });
}

/** Build all lines for a run. `prior` = existing lines, so manual bonus/overtime/notes survive a recalculation. */
export async function buildRun(countryCode, period, prior = []) {
  const cur = countryCurrency(countryCode);
  const { from, to } = periodBounds(period);
  const holidays = await holidaySet(countryCode, from, to);
  const wd = workingDays(from, to, holidays).length || 22;
  const settings = await HrSettings.findOne({ countryCode }).lean();
  const workingDaysBasis = settings?.workingDaysPerMonth || wd;
  const staff = await eligibleStaff(countryCode, period);
  const unpaid = await unpaidDaysByStaff(countryCode, period, holidays);
  const users = await User.find({ _id: { $in: staff.map((s) => s.userId).filter(Boolean) } }).select("email").lean();
  const emailOf = new Map(users.map((u) => [String(u._id), u.email]));
  const priorBy = new Map(prior.map((l) => [String(l.staffId), l]));
  const lines = [];
  for (const s of staff) {
    const p = priorBy.get(String(s._id)) || {};
    lines.push(await buildLine(s, { bonus: (p.bonus || 0) / 10 ** cur.decimals, overtime: (p.overtime || 0) / 10 ** cur.decimals, otherDeductions: (p.otherDeductions || 0) / 10 ** cur.decimals, unpaidLeaveDays: unpaid.get(String(s._id)) || 0, note: p.note }, { decimals: cur.decimals, workingDays: workingDaysBasis }, emailOf.get(String(s.userId)) || ""));
    const l = lines.at(-1);
    l.payslipSentAt = p.payslipSentAt || null;
  }
  return { currency: cur.code, decimals: cur.decimals, workingDays: workingDaysBasis, lines, totals: sumTotals(lines) };
}
