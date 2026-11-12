// server/controllers/hr/attendance.controller.js
//
// Attendance: self-service "present in office" with geolocation (any staff member with an HR
// record), plus HR views, manual entries and monthly summaries (country-scoped).
import HrAttendance from "../../models/hr/hr-attendance.model.js";
import HrOffice from "../../models/hr/hr-office.model.js";
import HrLeave from "../../models/hr/hr-leave.model.js";
import HrStaff from "../../models/hr/hr-staff.model.js";
import User from "../../models/user.model.js";
import { distanceMeters, reverseGeocode, validCoords } from "../../services/hr/geo.js";
import { sendAttendanceNotice } from "../../services/hr/mail.js";
import { holidaySet } from "../../services/hr/payroll.js";
import { localDate, countryTimezone, isDateStr, isPeriod, periodBounds, workingDays, eachDay, isWeekend, escRegex } from "../../services/hr/common.js";
import { sanitizeText } from "../../utils/campaignValidation.js";
import { logActivity } from "../../utils/activityLogger.js";
import { ok, fail, isId, scopeOr403, countryWhere, paging, loadStaff, myStaff, duplicate } from "./shared.js";

const WHEN = (d, tz) => { try { return new Intl.DateTimeFormat("en-GB", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(d); } catch { return d.toISOString(); } };
const dist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

async function approvedLeaveOn(staffId, date) {
  return HrLeave.findOne({ staffId, status: "APPROVED", from: { $lte: date }, to: { $gte: date } }).lean();
}

/** GET /me/attendance/today — what the check-in screen needs: today's record, offices, allowed modes. */
export async function myToday(req, res) {
  const staff = await myStaff(req);
  if (!staff) return ok(res, { hasProfile: false });
  const tz = countryTimezone(staff.countryCode);
  const date = localDate(new Date(), tz);
  const [record, offices, leave, holiday] = await Promise.all([
    HrAttendance.findOne({ staffId: staff._id, date }).lean(),
    HrOffice.find({ countryCode: staff.countryCode, isActive: true }).select("name address location radiusMeters enforceGeofence").lean(),
    approvedLeaveOn(staff._id, date),
    holidaySet(staff.countryCode, date, date).then((s) => s.has(date)),
  ]);
  const mode = staff.employment.workMode;
  return ok(res, {
    hasProfile: true, date, timezone: tz, workMode: mode, record, offices, onLeave: !!leave, isHoliday: holiday,
    // FULL_TIME → office only; HYBRID → office or remote; REMOTE → remote only
    allowed: mode === "FULL_TIME" ? ["OFFICE"] : mode === "HYBRID" ? ["OFFICE", "REMOTE"] : ["REMOTE"],
    defaultOfficeId: staff.employment.officeId || null,
  });
}

/** POST /me/attendance/check-in { type, lat, lng, accuracy, officeId?, note? } */
export async function checkIn(req, res) {
  const staff = await myStaff(req);
  if (!staff) return fail(res, 404, "You don't have an HR profile yet — ask HR to add you");
  if (!["ACTIVE", "ON_LEAVE"].includes(staff.employment.status)) return fail(res, 403, "Your employment status does not allow check-in");
  const mode = staff.employment.workMode;
  const type = req.body.type === "REMOTE" ? "REMOTE" : "OFFICE";
  if (type === "OFFICE" && mode === "REMOTE") return fail(res, 403, "Remote staff cannot mark office presence");
  if (type === "REMOTE" && mode === "FULL_TIME") return fail(res, 403, "Full-time on-site staff must mark presence in the office");
  const tz = countryTimezone(staff.countryCode);
  const now = new Date();
  const date = localDate(now, tz);
  if ((await holidaySet(staff.countryCode, date, date)).has(date)) return fail(res, 409, "Today is a public holiday");
  if (await approvedLeaveOn(staff._id, date)) return fail(res, 409, "You are on approved leave today");
  const existing = await HrAttendance.findOne({ staffId: staff._id, date });
  if (existing) return ok(res, existing, { alreadyMarked: true });

  const base = { countryCode: staff.countryCode, staffId: staff._id, userId: req.user._id, date, type, workModeAtTime: mode, checkInAt: now, recordedBy: req.user._id, note: sanitizeText(req.body.note, 300) };
  let record, office = null, notifyArgs = null;
  if (type === "REMOTE") {
    record = { ...base, flags: [] };
  } else {
    const lat = Number(req.body.lat), lng = Number(req.body.lng), accuracy = Number(req.body.accuracy) || 0;
    if (!validCoords(lat, lng)) return fail(res, 400, "Location is required to mark presence in the office — please allow location access", { code: "LOCATION_REQUIRED" });
    const offices = await HrOffice.find({ countryCode: staff.countryCode, isActive: true });
    if (!offices.length) return fail(res, 409, "No office has been configured for your country yet — contact HR", { code: "NO_OFFICE" });
    const pick = (req.body.officeId && isId(req.body.officeId) ? offices.find((o) => String(o._id) === String(req.body.officeId)) : null) || offices.map((o) => ({ o, d: distanceMeters({ lat, lng }, o.location) })).sort((a, b) => a.d - b.d)[0].o;
    office = pick;
    const d = distanceMeters({ lat, lng }, office.location);
    const within = d <= office.radiusMeters;
    const flags = [];
    if (!within) flags.push("OUTSIDE_GEOFENCE");
    if (accuracy > 200) flags.push("LOW_ACCURACY");
    if (!within && office.enforceGeofence) return fail(res, 422, `You are ${dist(d)} from ${office.name}; you must be within ${dist(office.radiusMeters)} to mark presence`, { code: "OUTSIDE_GEOFENCE", distanceMeters: d, radiusMeters: office.radiusMeters });
    const rev = await reverseGeocode(lat, lng);
    record = { ...base, officeId: office._id, flags, geo: { lat, lng, accuracyMeters: accuracy, distanceMeters: d, withinGeofence: within, address: rev || office.address || "", addressSource: rev ? "REVERSE_GEOCODE" : "OFFICE" } };
    notifyArgs = { countryCode: staff.countryCode, to: office.notifyEmails, staffName: staff.fullName, officeName: office.name, when: WHEN(now, tz), address: record.geo.address, distance: dist(d), outside: !within };
  }
  let doc;
  try { doc = await HrAttendance.create(record); } catch (e) { if (duplicate(e)) return ok(res, await HrAttendance.findOne({ staffId: staff._id, date }), { alreadyMarked: true }); throw e; }
  if (notifyArgs?.to?.length) {
    const sent = await sendAttendanceNotice(notifyArgs);
    if (sent) { doc.notifiedAt = new Date(); await doc.save(); }
  }
  await logActivity({ userId: req.user._id, action: "HR_ATTENDANCE", description: `${staff.fullName} marked ${type === "OFFICE" ? "present in office" : "remote"} ${date}`, resourceType: "Staff", resourceId: staff._id, resourceName: staff.fullName, req });
  return ok(res, doc);
}

export async function checkOut(req, res) {
  const staff = await myStaff(req);
  if (!staff) return fail(res, 404, "You don't have an HR profile yet");
  const date = localDate(new Date(), countryTimezone(staff.countryCode));
  const rec = await HrAttendance.findOne({ staffId: staff._id, date });
  if (!rec) return fail(res, 409, "You haven't marked presence today");
  if (!rec.checkOutAt) { rec.checkOutAt = new Date(); await rec.save(); }
  return ok(res, rec);
}

export async function myHistory(req, res) {
  const staff = await myStaff(req);
  if (!staff) return ok(res, []);
  const period = isPeriod(req.query.period) ? req.query.period : localDate(new Date(), countryTimezone(staff.countryCode)).slice(0, 7);
  const { from, to } = periodBounds(period);
  return ok(res, await HrAttendance.find({ staffId: staff._id, date: { $gte: from, $lte: to } }).sort({ date: -1 }).lean());
}

// ── HR views ──
export async function listAttendance(req, res) {
  const c = countryWhere(req, res); if (!c) return;
  const { page, limit, skip } = paging(req, 50);
  const where = { ...c.where };
  const { date, from, to, type, staffId, flagged } = req.query;
  if (isDateStr(date)) where.date = date;
  else if (isDateStr(from) || isDateStr(to)) where.date = { ...(isDateStr(from) && { $gte: from }), ...(isDateStr(to) && { $lte: to }) };
  else where.date = localDate(new Date(), "Africa/Lagos");
  if (type) where.type = String(type);
  if (staffId && isId(staffId)) where.staffId = staffId;
  if (flagged === "true") where.flags = { $in: ["OUTSIDE_GEOFENCE", "LOW_ACCURACY"] };
  const [rows, total] = await Promise.all([
    HrAttendance.find(where).sort({ date: -1, checkInAt: -1 }).skip(skip).limit(limit).populate("staffId", "fullName employeeId employment.department employment.workMode photoUrl").populate("officeId", "name").lean(),
    HrAttendance.countDocuments(where),
  ]);
  return ok(res, rows, { pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}

/** POST /attendance/manual { staffId, date, type, note } — HR corrects/records a day. */
export async function manualAttendance(req, res) {
  const f = await loadStaff(req, res, req.body.staffId); if (!f) return;
  const { date, type } = req.body;
  if (!isDateStr(date)) return fail(res, 400, "date must be YYYY-MM-DD");
  if (!["OFFICE", "REMOTE", "LEAVE", "HOLIDAY", "ABSENT"].includes(type)) return fail(res, 400, "type is invalid");
  if (date > localDate(new Date(), countryTimezone(f.doc.countryCode))) return fail(res, 400, "Cannot record a future day");
  const doc = await HrAttendance.findOneAndUpdate({ staffId: f.doc._id, date }, { $set: { countryCode: f.doc.countryCode, userId: f.doc.userId, type, workModeAtTime: f.doc.employment.workMode, manual: true, flags: ["MANUAL_ENTRY"], note: sanitizeText(req.body.note, 300), recordedBy: req.user._id, checkInAt: type === "OFFICE" || type === "REMOTE" ? new Date(date + "T08:00:00Z") : null } }, { upsert: true, new: true });
  await logActivity({ userId: req.user._id, action: "HR_ATTENDANCE", description: `Manual attendance ${type} for ${f.doc.fullName} on ${date}`, resourceType: "Staff", resourceId: f.doc._id, resourceName: f.doc.fullName, req });
  return ok(res, doc);
}

/** GET /attendance/summary?period=YYYY-MM — per-staff office/remote/leave/absent counts. */
export async function attendanceSummary(req, res) {
  const c = countryWhere(req, res); if (!c) return;
  const period = isPeriod(req.query.period) ? req.query.period : localDate(new Date(), "Africa/Lagos").slice(0, 7);
  const { from, to } = periodBounds(period);
  const today = localDate(new Date(), "Africa/Lagos");
  const upTo = to < today ? to : today;
  const staff = await HrStaff.find({ ...c.where, "employment.status": { $in: ["ACTIVE", "ON_LEAVE"] } }).select("fullName employeeId countryCode employment.workMode employment.startDate employment.department").sort({ fullName: 1 }).lean();
  const ids = staff.map((s) => s._id);
  const [recs, leaves] = await Promise.all([
    HrAttendance.find({ staffId: { $in: ids }, date: { $gte: from, $lte: to } }).lean(),
    HrLeave.find({ staffId: { $in: ids }, status: "APPROVED", from: { $lte: to }, to: { $gte: from } }).lean(),
  ]);
  const countries = [...new Set(staff.map((s) => s.countryCode))];
  const hol = new Map();
  for (const cc of countries) hol.set(cc, await holidaySet(cc, from, to));
  const rows = staff.map((s) => {
    const mine = recs.filter((r) => String(r.staffId) === String(s._id));
    const wd = from <= upTo ? workingDays(from, upTo, hol.get(s.countryCode)) : [];
    const startStr = s.employment.startDate ? new Date(s.employment.startDate).toISOString().slice(0, 10) : null;
    const due = wd.filter((d) => !startStr || d >= startStr);
    const leaveDays = new Set();
    for (const l of leaves.filter((x) => String(x.staffId) === String(s._id))) for (const d of eachDay(l.from < from ? from : l.from, l.to > to ? to : l.to)) leaveDays.add(d);
    const present = new Set(mine.filter((r) => ["OFFICE", "REMOTE"].includes(r.type)).map((r) => r.date));
    const absent = due.filter((d) => !present.has(d) && !leaveDays.has(d) && !mine.some((r) => r.date === d && ["LEAVE", "HOLIDAY"].includes(r.type)));
    return {
      staffId: s._id, fullName: s.fullName, employeeId: s.employeeId, workMode: s.employment.workMode, department: s.employment.department,
      officeDays: mine.filter((r) => r.type === "OFFICE").length, remoteDays: mine.filter((r) => r.type === "REMOTE").length,
      leaveDays: [...leaveDays].filter((d) => due.includes(d)).length, absentDays: absent.length, flagged: mine.filter((r) => r.flags?.some((f) => f !== "MANUAL_ENTRY")).length, workingDays: due.length,
    };
  });
  return ok(res, { period, rows });
}
void User; void escRegex;
