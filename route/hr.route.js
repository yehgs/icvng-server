// server/route/hr.route.js — HR module. Mounted at /api/hr.
//   Admin (IT, Director, HR; country-scoped in the controllers via utils/featureScope.js):
//     hr.view    → read directory, attendance, leave, appraisals, offices, dashboard
//     hr.manage  → create/update staff, offices, holidays, leave decisions, appraisals, settings, sensitive reveal
//     hr.payroll → payroll runs, PDFs, signing, e-mailing
//   Self-service /me/* → any admin user with an HR record (own attendance, leave, appraisals).
import { Router } from "express";
import auth from "../middleware/auth.js";
import { admin } from "../middleware/Admin.js";
import { requirePermission } from "../middleware/requirePermission.js";
import * as staff from "../controllers/hr/staff.controller.js";
import * as office from "../controllers/hr/office.controller.js";
import * as att from "../controllers/hr/attendance.controller.js";
import * as ppl from "../controllers/hr/people.controller.js";
import * as pay from "../controllers/hr/payroll.controller.js";
import * as docs from "../controllers/hr/documents.controller.js";

const router = Router();
const base = [auth, admin];
const view = [...base, requirePermission("hr.view")];
const manage = [...base, requirePermission("hr.manage")];
const payroll = [...base, requirePermission("hr.payroll")];
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ── self-service ──
router.get("/me/attendance/today", ...base, wrap(att.myToday));
router.post("/me/attendance/check-in", ...base, wrap(att.checkIn));
router.post("/me/attendance/check-out", ...base, wrap(att.checkOut));
router.get("/me/attendance", ...base, wrap(att.myHistory));
router.get("/me/leave", ...base, wrap(ppl.myLeave));
router.post("/me/leave", ...base, wrap(ppl.requestMyLeave));
router.post("/me/leave/:id/cancel", ...base, wrap(ppl.cancelMyLeave));
router.get("/me/appraisals", ...base, wrap(ppl.myAppraisals));
router.post("/me/appraisals/:id/acknowledge", ...base, wrap(ppl.acknowledgeMyAppraisal));

// ── dashboard / meta ──
router.get("/meta", ...view, staff.staffMeta);
router.get("/dashboard", ...view, wrap(ppl.dashboard));

// ── staff ──
router.get("/staff", ...view, wrap(staff.listStaff));
router.get("/staff-candidates", ...manage, wrap(staff.staffCandidates));
router.post("/staff", ...manage, wrap(staff.createStaff));
router.get("/staff/:id", ...view, wrap(staff.getStaff));
router.get("/staff/:id/sensitive", ...manage, wrap(staff.getStaffSensitive));
router.post("/staff/:id/export", ...manage, wrap(docs.exportStaffDetails)); // re-asks the caller's password
router.put("/staff/:id", ...manage, wrap(staff.updateStaff));
router.delete("/staff/:id", ...manage, wrap(staff.terminateStaff));

// ── printable forms ──
router.get("/forms/staff-form", ...view, wrap(docs.downloadBlankForm));
router.post("/forms/staff-form/send", ...manage, wrap(docs.emailBlankForm));

// ── offices / holidays / settings ──
router.get("/offices", ...view, wrap(office.listOffices));
router.post("/offices", ...manage, wrap(office.createOffice));
router.put("/offices/:id", ...manage, wrap(office.updateOffice));
router.delete("/offices/:id", ...manage, wrap(office.deleteOffice));
router.get("/holidays", ...view, wrap(office.listHolidays));
router.post("/holidays", ...manage, wrap(office.createHoliday));
router.delete("/holidays/:id", ...manage, wrap(office.deleteHoliday));
router.get("/settings", ...view, wrap(office.getSettings));
router.put("/settings", ...manage, wrap(office.saveSettings));

// ── attendance ──
router.get("/attendance", ...view, wrap(att.listAttendance));
router.get("/attendance/summary", ...view, wrap(att.attendanceSummary));
router.post("/attendance/manual", ...manage, wrap(att.manualAttendance));

// ── leave ──
router.get("/leave", ...view, wrap(ppl.listLeave));
router.post("/leave", ...manage, wrap(ppl.createLeaveForStaff));
router.put("/leave/:id/decision", ...manage, wrap(ppl.decideLeave));

// ── appraisals ──
router.get("/appraisals", ...view, wrap(ppl.listAppraisals));
router.post("/appraisals", ...manage, wrap(ppl.createAppraisal));
router.get("/appraisals/:id", ...view, wrap(ppl.getAppraisal));
router.put("/appraisals/:id", ...manage, wrap(ppl.updateAppraisal));
router.post("/appraisals/:id/submit", ...manage, wrap(ppl.submitAppraisal));
router.delete("/appraisals/:id", ...manage, wrap(ppl.deleteAppraisal));

// ── payroll ──
router.get("/payroll", ...payroll, wrap(pay.listPayrolls));
router.post("/payroll", ...payroll, wrap(pay.createPayroll));
router.get("/payroll/:id", ...payroll, wrap(pay.getPayroll));
router.post("/payroll/:id/recalculate", ...payroll, wrap(pay.recalcPayroll));
router.put("/payroll/:id/lines/:staffId", ...payroll, wrap(pay.updatePayrollLine));
router.get("/payroll/:id/preview", ...payroll, wrap(pay.previewPayroll));
router.get("/payroll/:id/download", ...payroll, wrap(pay.downloadPayroll));
router.put("/payroll/:id/branding", ...payroll, wrap(pay.setPayrollBranding));
router.post("/payroll/:id/approve", ...payroll, wrap(pay.approvePayroll));
router.post("/payroll/:id/send", ...payroll, wrap(pay.sendPayroll));
router.post("/payroll/:id/mark-paid", ...payroll, wrap(pay.markPaid));
router.delete("/payroll/:id", ...payroll, wrap(pay.deletePayroll));

export default router;
