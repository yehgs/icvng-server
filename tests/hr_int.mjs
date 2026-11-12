// Run: TEST_MONGO_URI=mongodb://127.0.0.1:27018 node tests/hr_int.mjs
//
// HR module end to end through the real router (Resend + geocoder stubbed): permissions, country
// scoping, encrypted sensitive fields, geofenced attendance + notification, leave, appraisals,
// payroll maths, signed PDFs and e-mailed payslips.
process.env.SECRET_KEY_ACCESS_TOKEN = "testsecret";
process.env.RESEND_API_KEY = "re_test";
process.env.PAYMENT_SECRETS_KEY = "a".repeat(64);
process.env.SERVER_BASE_URL = "https://api.test";
delete process.env.OPENAI_API_KEY;
import assert from "assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import request from "supertest";

const sentMails = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("api.resend.com")) { const body = JSON.parse(opts.body); sentMails.push(body); return { ok: true, status: 200, json: async () => ({ id: "m" + sentMails.length }) }; }
  if (u.includes("nominatim")) return { ok: true, status: 200, json: async () => ({ display_name: "12 Test Street, Lomé" }) };
  return realFetch(url, opts);
};

await mongoose.connect((process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27018") + "/icv_test_hr_" + Date.now());
const { default: hrRouter } = await import("../route/hr.route.js");
const { default: User } = await import("../models/user.model.js");
const { default: HrStaff } = await import("../models/hr/hr-staff.model.js");
const { default: HrAttendance } = await import("../models/hr/hr-attendance.model.js");
const { default: ActivityLog } = await import("../models/activity-log.model.js");
const { calcLine } = await import("../services/hr/payroll.js");
const { localDate } = await import("../services/hr/common.js");
const { refreshCountryCache } = await import("../services/countryService.js");
await refreshCountryCache();

const { default: adminUserRouter } = await import("../route/admin-user.route.js");
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/hr", hrRouter);
app.use("/api/admin-user", adminUserRouter);
app.use((err, req, res, next) => { console.error("UNHANDLED", err); res.status(500).json({ message: err.message }); });

let n = 0;
const mk = async (subRole, scope = "GLOBAL", assignedCountry = null) => {
  const u = await User.create({ name: `${subRole}${assignedCountry || ""}${++n}`, email: `s${n}@t.com`, password: "x", role: "ADMIN", subRole, scope, assignedCountry, status: "Active", avatar: "https://img/a.png" });
  return { u, h: { Authorization: `Bearer ${jwt.sign({ id: String(u._id) }, "testsecret")}` } };
};
const it = await mk("IT"), director = await mk("DIRECTOR");
const hrTG = await mk("HR", "COUNTRY", "TG"), hrNG = await mk("HR", "COUNTRY", "NG"), hrHQ = await mk("HR");
const mgr = await mk("MANAGER", "COUNTRY", "TG"), sales = await mk("SALES", "COUNTRY", "TG"), accountant = await mk("ACCOUNTANT"), editor = await mk("EDITOR");
const c = (h) => ({ get: (u) => request(app).get(u).set(h), post: (u, b) => request(app).post(u).set(h).send(b), put: (u, b) => request(app).put(u).set(h).send(b), del: (u) => request(app).delete(u).set(h) });
let passed = 0;
const ok = (name) => { passed++; console.log("  ✓", name); };
const staffBody = (over = {}) => ({
  fullName: "Ama Mensah", gender: "FEMALE", dateOfBirth: "1992-03-14", phone: "+22890000000", personalEmail: "ama.personal@x.com",
  address: { line1: "5 Rue Test", city: "Lomé", country: "Togo" }, emergencyContact: { name: "Kofi", relationship: "Brother", phone: "+22891111111" },
  health: { status: "FIT", bloodGroup: "O+", genotype: "AA", notes: "Mild asthma — inhaler at desk" },
  employment: { jobTitle: "Barista Lead", department: "Retail", workMode: "FULL_TIME", employmentType: "PERMANENT", startDate: "2025-01-06" },
  salary: { currency: "XOF", baseSalary: 300000, allowances: [{ name: "Transport", amount: 20000 }], deductions: [{ name: "Pension", type: "PERCENT", value: 5, of: "BASE" }, { name: "Tax", type: "PERCENT", value: 10, of: "GROSS" }] },
  bank: { bankName: "Ecobank", accountName: "Ama Mensah", accountNumber: "0123456789", branch: "Lomé", taxId: "TX-9981" }, ...over,
});

// ── permissions ──
console.log("permissions");
assert.equal((await request(app).get("/api/hr/staff")).status, 401);
for (const [who, a, st] of [["it", it, 200], ["director", director, 200], ["hr", hrTG, 200], ["manager", mgr, 403], ["sales", sales, 403], ["accountant", accountant, 403], ["editor", editor, 403]]) {
  assert.equal((await c(a.h).get("/api/hr/staff")).status, st, `${who} list staff`);
  assert.equal((await c(a.h).get("/api/hr/payroll")).status, st, `${who} payroll`);
}
ok("only IT, Director and HR reach the HR module; manager/sales/accountant/editor are refused");

// ── staff + scope ──
console.log("staff & country scope");
let r = await c(hrTG.h).post("/api/hr/staff", staffBody());
assert.equal(r.status, 200, JSON.stringify(r.body));
const ama = r.body.data;
assert.equal(ama.countryCode, "TG");
assert.match(ama.employeeId, /^ICV-TG-0001$/);
assert.equal(ama.bank.accountMasked, "••••6789");
assert.ok(!JSON.stringify(ama).includes("0123456789") && !JSON.stringify(ama).includes("asthma"), "no secrets in the normal payload");
const raw = await HrStaff.findById(ama._id).lean();
assert.ok(!JSON.stringify(raw).includes("0123456789") && !JSON.stringify(raw).includes("asthma") && !JSON.stringify(raw).includes("TX-9981"), "stored encrypted");
assert.equal((await c(hrTG.h).post("/api/hr/staff", staffBody({ countryCode: "NG" }))).status, 403, "tampered country → 403");
assert.equal((await c(it.h).post("/api/hr/staff", staffBody())).status, 400, "global admin must name a country");
const kofi = (await c(it.h).post("/api/hr/staff", staffBody({ fullName: "Kofi Owusu", countryCode: "TG", bank: { bankName: "UBA", accountNumber: "9999888877" } }))).body.data;
const ngStaff = (await c(hrNG.h).post("/api/hr/staff", staffBody({ fullName: "Chika Obi", salary: { currency: "NGN", baseSalary: 500000 } }))).body.data;
const hqStaff = (await c(hrHQ.h).post("/api/hr/staff", staffBody({ fullName: "Tunde HQ" }))).body.data;
assert.equal(hqStaff.countryCode, "NG", "an unscoped (HQ) HR is Nigeria-only");
assert.equal((await c(hrTG.h).get(`/api/hr/staff/${ngStaff._id}`)).status, 404);
assert.equal((await c(hrTG.h).put(`/api/hr/staff/${ngStaff._id}`, { fullName: "x" })).status, 404);
assert.equal((await c(hrTG.h).get(`/api/hr/staff/${ngStaff._id}/sensitive`)).status, 404);
assert.equal((await c(hrNG.h).get(`/api/hr/staff/${ama._id}`)).status, 404);
assert.equal((await c(hrTG.h).put(`/api/hr/staff/${ama._id}`, { countryCode: "NG" })).status, 403, "country is immutable");
const listTG = (await c(hrTG.h).get("/api/hr/staff?countryCode=NG")).body.data;
assert.ok(listTG.length === 2 && listTG.every((s) => s.countryCode === "TG"), "?countryCode ignored for scoped HR");
assert.equal((await c(it.h).get("/api/hr/staff")).body.data.length, 4, "IT sees all countries");
assert.equal((await c(it.h).get("/api/hr/staff?countryCode=NG")).body.data.length, 2);
assert.equal((await c(hrTG.h).get("/api/hr/staff?q=mensah")).body.data.length, 1, "search by name");
assert.equal((await c(hrTG.h).get("/api/hr/staff?q=ICV-TG-0002")).body.data[0].fullName, "Kofi Owusu", "search by employee id");
assert.equal((await c(hrTG.h).get("/api/hr/staff?q=chika")).body.data.length, 0, "search never crosses countries");
ok("staff created per country, tampering refused, other countries invisible, search scoped");

const logsBefore = await ActivityLog.countDocuments({ action: "HR_SENSITIVE_VIEW" });
r = await c(hrTG.h).get(`/api/hr/staff/${ama._id}/sensitive`);
assert.deepEqual(r.body.data, { accountNumber: "0123456789", taxId: "TX-9981", healthNotes: "Mild asthma — inhaler at desk" });
assert.equal(await ActivityLog.countDocuments({ action: "HR_SENSITIVE_VIEW" }), logsBefore + 1, "sensitive reveal is audited");
r = await c(hrTG.h).put(`/api/hr/staff/${ama._id}`, { employment: { jobTitle: "Head Barista" }, bank: { bankName: "Ecobank Togo" } });
assert.equal(r.body.data.employment.jobTitle, "Head Barista");
assert.equal(r.body.data.employment.department, "Retail", "untouched siblings preserved");
assert.equal(r.body.data.bank.accountMasked, "••••6789", "account number preserved when not resubmitted");
assert.equal((await c(hrTG.h).put(`/api/hr/staff/${ama._id}`, { dateOfBirth: "not-a-date" })).status, 400);
assert.equal((await c(hrTG.h).post("/api/hr/staff", staffBody({ photoUrl: "http://insecure/x.png" }))).status, 400, "photo must be https");
ok("sensitive details decrypt only via the audited endpoint; partial updates keep other fields");

// link to a login account
const staffUser = await mk("SALES", "COUNTRY", "TG");
const cands = (await c(hrTG.h).get("/api/hr/staff-candidates")).body.data.map((u) => String(u._id));
assert.ok(cands.includes(String(staffUser.u._id)) && !cands.includes(String(hrNG.u._id)), "candidates are in-territory admin users");
r = await c(hrTG.h).post("/api/hr/staff", staffBody({ fullName: "", userId: String(staffUser.u._id), employment: { workMode: "HYBRID", jobTitle: "Sales rep", startDate: "2025-02-03" } }));
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.data.fullName, staffUser.u.name, "name defaults from the linked user");
const linked = r.body.data;
assert.equal((await c(hrTG.h).post("/api/hr/staff", staffBody({ userId: String(staffUser.u._id) }))).status, 409, "one HR record per user");
assert.equal((await c(hrTG.h).post("/api/hr/staff", staffBody({ userId: String(hrNG.u._id) }))).status, 400, "cannot link a user from another country");
ok("existing admin users can be linked; duplicates and cross-country links refused");

// ── offices ──
console.log("offices & attendance");
const officeBody = { name: "Lomé HQ", address: "Boulevard du 13 Janvier, Lomé", lat: 6.1319, lng: 1.2228, radiusMeters: 150, notifyEmails: ["hr@i-coffee.tg", "boss@i-coffee.tg"] };
r = await c(hrTG.h).post("/api/hr/offices", officeBody);
assert.equal(r.status, 200, JSON.stringify(r.body));
const office = r.body.data;
assert.equal(office.countryCode, "TG");
assert.equal((await c(hrTG.h).post("/api/hr/offices", { ...officeBody, countryCode: "NG" })).status, 403);
assert.equal((await c(hrTG.h).post("/api/hr/offices", { ...officeBody, lat: 0, lng: 0 })).status, 400, "0,0 is not a valid office location");
assert.equal((await c(hrNG.h).put(`/api/hr/offices/${office._id}`, { name: "hijack" })).status, 404);
assert.equal((await c(hrNG.h).get("/api/hr/offices")).body.data.length, 0);
await c(hrTG.h).put(`/api/hr/staff/${linked._id}`, { employment: { officeId: office._id } });
await c(hrTG.h).put(`/api/hr/staff/${ama._id}`, { userId: undefined });

// ama (FULL_TIME) is linked to a login for self-service
const amaUser = await mk("MANAGER", "COUNTRY", "TG");
await HrStaff.updateOne({ _id: ama._id }, { userId: amaUser.u._id });
let t = await c(amaUser.h).get("/api/hr/me/attendance/today");
assert.equal(t.body.data.hasProfile, true);
assert.deepEqual(t.body.data.allowed, ["OFFICE"]);
assert.equal(t.body.data.offices.length, 1);

assert.equal((await c(amaUser.h).post("/api/hr/me/attendance/check-in", { type: "OFFICE" })).status, 400, "location is required");
assert.equal((await c(amaUser.h).post("/api/hr/me/attendance/check-in", { type: "REMOTE" })).status, 403, "full-time staff cannot mark remote");
sentMails.length = 0;
r = await c(amaUser.h).post("/api/hr/me/attendance/check-in", { type: "OFFICE", lat: 6.1320, lng: 1.2229, accuracy: 12 });
assert.equal(r.status, 200, JSON.stringify(r.body));
const rec = r.body.data;
assert.equal(rec.type, "OFFICE");
assert.equal(rec.geo.withinGeofence, true);
assert.ok(rec.geo.distanceMeters < 30);
assert.equal(rec.geo.address, "12 Test Street, Lomé");
assert.equal(rec.geo.addressSource, "REVERSE_GEOCODE");
assert.deepEqual(rec.flags, []);
assert.equal(sentMails.length, 2, "one notification per assigned e-mail");
assert.deepEqual(sentMails.map((m) => m.to[0]).sort(), ["boss@i-coffee.tg", "hr@i-coffee.tg"]);
assert.ok(sentMails[0].html.includes("Ama Mensah") && sentMails[0].html.includes("12 Test Street"), "e-mail carries who + geolocation address");
assert.match(sentMails[0].subject, /présent|Personnel/i, "TG notification is in French");
assert.ok((await HrAttendance.findById(rec._id)).notifiedAt, "notification time stored");
r = await c(amaUser.h).post("/api/hr/me/attendance/check-in", { type: "OFFICE", lat: 6.1320, lng: 1.2229 });
assert.equal(r.body.alreadyMarked, true);
assert.equal(await HrAttendance.countDocuments({ staffId: ama._id }), 1, "one record per day");
assert.equal(sentMails.length, 2, "no duplicate notification");
ok("full-time check-in captures geolocation + address and e-mails the assigned addresses (in French for TG)");

// hybrid staff: remote allowed; outside the fence is flagged (or refused when enforced)
const hybridUser = await mk("SALES", "COUNTRY", "TG");
await HrStaff.updateOne({ _id: linked._id }, { userId: hybridUser.u._id });
r = await c(hybridUser.h).post("/api/hr/me/attendance/check-in", { type: "OFFICE", lat: 6.2, lng: 1.3, accuracy: 15 });
assert.equal(r.status, 200);
assert.deepEqual(r.body.data.flags, ["OUTSIDE_GEOFENCE"]);
assert.equal(r.body.data.geo.withinGeofence, false);
assert.ok(sentMails.at(-1).html.includes("⚠") || sentMails.at(-1).html.includes("hors"), "notification flags out-of-range check-in");
await HrAttendance.deleteMany({ staffId: linked._id });
await c(hrTG.h).put(`/api/hr/offices/${office._id}`, { enforceGeofence: true });
r = await c(hybridUser.h).post("/api/hr/me/attendance/check-in", { type: "OFFICE", lat: 6.2, lng: 1.3 });
assert.equal(r.status, 422);
assert.equal(r.body.code, "OUTSIDE_GEOFENCE");
assert.equal(await HrAttendance.countDocuments({ staffId: linked._id }), 0, "refused check-in stores nothing");
assert.equal((await c(hybridUser.h).post("/api/hr/me/attendance/check-in", { type: "REMOTE" })).status, 200, "hybrid staff may mark remote");
await c(hrTG.h).put(`/api/hr/offices/${office._id}`, { enforceGeofence: false });
ok("hybrid staff: remote allowed, out-of-range flagged or refused per office setting");

// remote staff, holiday, leave day block, non-staff
const remoteUser = await mk("EDITOR", "COUNTRY", "TG");
const rem = (await c(hrTG.h).post("/api/hr/staff", staffBody({ fullName: "Remote Rita", userId: String(remoteUser.u._id), employment: { workMode: "REMOTE", startDate: "2025-03-03" } }))).body.data;
assert.equal((await c(remoteUser.h).post("/api/hr/me/attendance/check-in", { type: "OFFICE", lat: 6.1319, lng: 1.2228 })).status, 403, "remote staff cannot mark office");
const today = localDate(new Date(), "Africa/Lome");
assert.equal((await c(hrTG.h).post("/api/hr/holidays", { name: "Test Day", date: today })).status, 200);
assert.equal((await c(remoteUser.h).post("/api/hr/me/attendance/check-in", { type: "REMOTE" })).status, 409, "public holiday blocks check-in");
assert.equal((await c(hrNG.h).get("/api/hr/holidays")).body.data.length, 0, "holidays are per country");
const hol = (await c(hrTG.h).get("/api/hr/holidays")).body.data[0];
assert.equal((await c(hrTG.h).post("/api/hr/holidays", { name: "Dup", date: today })).status, 409);
await c(hrTG.h).del(`/api/hr/holidays/${hol._id}`);
assert.equal((await c(remoteUser.h).post("/api/hr/me/attendance/check-in", { type: "REMOTE" })).status, 200);
const stranger = await mk("WAREHOUSE");
assert.equal((await c(stranger.h).get("/api/hr/me/attendance/today")).body.data.hasProfile, false);
assert.equal((await c(stranger.h).post("/api/hr/me/attendance/check-in", { type: "OFFICE", lat: 6.13, lng: 1.22 })).status, 404, "no HR profile → no check-in");
ok("remote staff restricted, holidays block check-in, staff without an HR profile cannot check in");

// HR views
let att = (await c(hrTG.h).get(`/api/hr/attendance?date=${today}`)).body;
assert.equal(att.data.length, 3, "HR sees today's TG check-ins (ama, hybrid rep remote, rita)");
assert.equal((await c(hrNG.h).get(`/api/hr/attendance?date=${today}`)).body.data.length, 0, "NG HR sees none of them");
assert.equal((await c(hrTG.h).get(`/api/hr/attendance?date=${today}&type=OFFICE`)).body.data.length, 1);
r = await c(hrTG.h).post("/api/hr/attendance/manual", { staffId: kofi._id, date: today, type: "REMOTE", note: "forgot" });
assert.equal(r.status, 200);
assert.equal((await c(hrNG.h).post("/api/hr/attendance/manual", { staffId: kofi._id, date: today, type: "REMOTE" })).status, 404);
assert.equal((await c(hrTG.h).post("/api/hr/attendance/manual", { staffId: kofi._id, date: "2999-01-01", type: "REMOTE" })).status, 400, "no future entries");
const sum = (await c(hrTG.h).get(`/api/hr/attendance/summary?period=${today.slice(0, 7)}`)).body.data;
assert.ok(sum.rows.find((x) => x.fullName === "Ama Mensah").officeDays === 1);
ok("HR attendance list, manual entry and monthly summary are country-scoped");

// ── leave ──
console.log("leave");
r = await c(hybridUser.h).post("/api/hr/me/leave", { type: "ANNUAL", from: "2027-03-01", to: "2027-03-05", reason: "Holiday" });
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.data.days, 5);
assert.equal((await c(hybridUser.h).post("/api/hr/me/leave", { type: "ANNUAL", from: "2027-03-03", to: "2027-03-04" })).status, 409, "overlap refused");
assert.equal((await c(hybridUser.h).post("/api/hr/me/leave", { type: "ANNUAL", from: "2027-05-03", to: "2027-08-30" })).status, 422, "beyond annual balance");
assert.equal((await c(hybridUser.h).post("/api/hr/me/leave", { type: "ANNUAL", from: "2027-04-03", to: "2027-04-04" })).status, 400, "weekend-only range has no working days");
const leave = r.body.data;
assert.equal((await c(hrNG.h).put(`/api/hr/leave/${leave._id}/decision`, { status: "APPROVED" })).status, 404);
sentMails.length = 0;
r = await c(hrTG.h).put(`/api/hr/leave/${leave._id}/decision`, { status: "APPROVED", note: "Enjoy" });
assert.equal(r.body.data.status, "APPROVED");
assert.equal(sentMails.length, 1);
assert.equal(sentMails[0].to[0], hybridUser.u.email);
assert.equal((await c(hrTG.h).put(`/api/hr/leave/${leave._id}/decision`, { status: "REJECTED" })).status, 409, "already decided");
const bal = (await c(hybridUser.h).get("/api/hr/me/leave?year=2027")).body.data.balance;
assert.deepEqual([bal.taken, bal.remaining], [5, 15]);
assert.equal((await c(hrTG.h).get("/api/hr/leave?status=APPROVED")).body.data.length, 1);
assert.equal((await c(hrNG.h).get("/api/hr/leave")).body.data.length, 0);
r = await c(hrTG.h).post("/api/hr/leave", { staffId: kofi._id, type: "UNPAID", from: `${today.slice(0, 7)}-01`, to: `${today.slice(0, 7)}-04` });
assert.equal(r.status, 200);
await c(hrTG.h).put(`/api/hr/leave/${r.body.data._id}/decision`, { status: "APPROVED" });
const cancel = (await c(hybridUser.h).post("/api/hr/me/leave", { type: "SICK", from: "2027-06-07", to: "2027-06-08" })).body.data;
assert.equal((await c(hybridUser.h).post(`/api/hr/me/leave/${cancel._id}/cancel`, {})).body.data.status, "CANCELLED");
ok("leave: working-day maths, overlap/balance rules, country-scoped decisions with e-mail, self cancel");

// ── appraisals ──
console.log("appraisals");
r = await c(hrTG.h).post("/api/hr/appraisals", { staffId: ama._id, period: "2026-H2", cycle: "HALF_YEARLY", goals: [{ title: "Sales", weight: 60, score: 4 }, { title: "Quality", weight: 40, score: 3 }], competencies: [{ name: "Teamwork", rating: 5 }], recommendedAction: "INCREMENT" });
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.data.overallRating, 4.3, "avg(weighted goals 3.6, competencies 5)");
const ap = r.body.data;
assert.equal((await c(hrTG.h).post("/api/hr/appraisals", { staffId: ama._id, period: "2026-H2" })).status, 409);
assert.equal((await c(hrNG.h).post("/api/hr/appraisals", { staffId: ama._id, period: "2027-H1" })).status, 404);
assert.equal((await c(hrNG.h).get(`/api/hr/appraisals/${ap._id}`)).status, 404);
assert.equal((await c(hrTG.h).post("/api/hr/appraisals", { staffId: ama._id, period: "2027-H1", goals: [{ title: "x", score: 9 }] })).status, 400, "score capped at 5");
assert.equal((await c(amaUser.h).get("/api/hr/me/appraisals")).body.data.length, 0, "drafts are not visible to the employee");
assert.equal((await c(hrTG.h).post(`/api/hr/appraisals/${ap._id}/submit`, {})).body.data.status, "SUBMITTED");
assert.equal((await c(hrTG.h).put(`/api/hr/appraisals/${ap._id}`, { comments: "late edit" })).status, 409, "submitted is locked");
assert.equal((await c(amaUser.h).post(`/api/hr/me/appraisals/${ap._id}/acknowledge`, {})).body.data.status, "ACKNOWLEDGED");
assert.equal((await c(hybridUser.h).post(`/api/hr/me/appraisals/${ap._id}/acknowledge`, {})).status, 404, "only the appraised employee acknowledges");
ok("appraisals: weighted rating, draft → submitted → acknowledged, scoped");

// ── payroll ──
console.log("payroll");
const line = calcLine({ baseSalary: 300000, allowances: [{ name: "Transport", amount: 20000 }], deductions: [{ name: "Pension", type: "PERCENT", value: 5, of: "BASE" }, { name: "Tax", type: "PERCENT", value: 10, of: "GROSS" }] }, {}, { decimals: 0, workingDays: 22 });
assert.deepEqual([line.gross, line.totalDeductions, line.net], [320000, 15000 + 32000, 273000]);
const period = today.slice(0, 7);
assert.equal((await c(hrTG.h).post("/api/hr/payroll", { period: "2999-01" })).status, 400, "future month refused");
r = await c(hrTG.h).post("/api/hr/payroll", { period });
assert.equal(r.status, 200, JSON.stringify(r.body));
let run = r.body.data;
assert.equal(run.countryCode, "TG");
assert.equal(run.currency, "XOF");
assert.equal(run.decimals, 0);
assert.equal(run.lines.length, 4, "ama + kofi + linked sales rep + rita");
assert.ok(!JSON.stringify(run).includes("0123456789"), "JSON never exposes account numbers");
const aLine = run.lines.find((l) => l.fullName === "Ama Mensah");
assert.equal(aLine.net, 273000);
assert.equal(aLine.bank.accountMasked, "••••6789");
const kLine = run.lines.find((l) => l.fullName === "Kofi Owusu");
assert.ok(kLine.unpaidLeaveDays >= 1 && kLine.unpaidLeaveDeduction > 0, "approved unpaid leave reduces pay");
assert.equal(run.totals.net, run.lines.reduce((s, l) => s + l.net, 0));
assert.equal((await c(hrTG.h).post("/api/hr/payroll", { period })).status, 409, "one run per country+month");
assert.equal((await c(hrNG.h).get(`/api/hr/payroll/${run._id}`)).status, 404);
assert.equal((await c(hrNG.h).post(`/api/hr/payroll/${run._id}/approve`, {})).status, 404);
assert.equal((await c(hrNG.h).get(`/api/hr/payroll/${run._id}/preview`)).status, 404);
assert.equal((await c(it.h).post("/api/hr/payroll", { period })).status, 400, "global admin must name a country");
r = await c(hrTG.h).put(`/api/hr/payroll/${run._id}/lines/${ama._id}`, { bonus: 10000, overtime: 5000, note: "Q4 bonus" });
assert.equal(r.status, 200, JSON.stringify(r.body));
const a2 = r.body.data.lines.find((l) => l.fullName === "Ama Mensah");
assert.equal(a2.gross, 335000);
assert.equal(a2.note, "Q4 bonus");
assert.equal((await c(hrTG.h).put(`/api/hr/payroll/${run._id}/lines/${ama._id}`, { bonus: -5 })).status, 400);
ok("payroll run: integer-minor maths, unpaid leave, adjustments, one run per month, other countries blocked");

// approval needs the signature
r = await c(hrTG.h).post(`/api/hr/payroll/${run._id}/approve`, {});
assert.equal(r.status, 422);
assert.equal(r.body.code, "SIGNATURE_REQUIRED");
assert.equal((await c(hrTG.h).put("/api/hr/settings", { signatureUrl: "http://x/sig.png" })).status, 400);
r = await c(hrTG.h).put("/api/hr/settings", { companyName: "I-Coffee Togo SARL", companyAddress: "Lomé", logoUrl: "https://res.cloudinary.com/x/logo.png", signatureUrl: "https://res.cloudinary.com/x/sig.png", signerName: "Marie Koffi", signerTitle: "Head of HR", payrollNotifyEmails: ["finance@i-coffee.tg"] });
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal((await c(hrNG.h).get("/api/hr/settings")).body.data.companyName, undefined, "settings are per country");
await c(hrTG.h).put(`/api/hr/staff/${rem._id}`, { bank: { accountNumber: "" } });
assert.equal((await c(hrTG.h).post(`/api/hr/payroll/${run._id}/recalculate`, {})).status, 200);
r = await c(hrTG.h).post(`/api/hr/payroll/${run._id}/approve`, {});
assert.equal(r.status, 422);
assert.equal(r.body.code, "MISSING_BANK", "staff without bank details block approval");
assert.ok(r.body.staff.includes("Remote Rita"));
await c(hrTG.h).put(`/api/hr/staff/${rem._id}`, { bank: { bankName: "UBA", accountNumber: "5555666677" } });
await c(hrTG.h).put(`/api/hr/staff/${linked._id}`, { bank: { bankName: "UBA", accountNumber: "4444333322" } });
r = await c(hrTG.h).post(`/api/hr/payroll/${run._id}/recalculate`, {});
assert.equal(r.status, 200);
assert.equal(r.body.data.lines.find((l) => l.fullName === "Ama Mensah").bonus, 10000, "manual adjustments survive recalculation");
r = await c(hrTG.h).post(`/api/hr/payroll/${run._id}/approve`, {});
assert.equal(r.status, 200, JSON.stringify(r.body));
run = r.body.data;
assert.equal(run.status, "APPROVED");
assert.equal(run.signedBy.name, "Marie Koffi");
assert.equal((await c(hrTG.h).put(`/api/hr/payroll/${run._id}/lines/${ama._id}`, { bonus: 1 })).status, 409, "approved run is locked");
assert.equal((await c(hrTG.h).del(`/api/hr/payroll/${run._id}`)).status, 409);
ok("approval requires signature + bank details; approved payroll is locked and records who signed");

// PDFs
const pdfOf = async (url) => new Promise((resolve, reject) => request(app).get(url).set(hrTG.h).buffer(true).parse((res, cb) => { const ch = []; res.on("data", (d) => ch.push(d)); res.on("end", () => cb(null, Buffer.concat(ch))); }).end((e, x) => (e ? reject(e) : resolve(x))));
let pdf = await pdfOf(`/api/hr/payroll/${run._id}/preview`);
assert.equal(pdf.status, 200);
assert.match(pdf.headers["content-type"], /application\/pdf/);
assert.match(pdf.headers["content-disposition"], /^inline/);
assert.equal(pdf.body.subarray(0, 4).toString(), "%PDF");
pdf = await pdfOf(`/api/hr/payroll/${run._id}/download`);
assert.match(pdf.headers["content-disposition"], /^attachment; filename="payroll-TG-/);
pdf = await pdfOf(`/api/hr/payroll/${run._id}/download?staffId=${ama._id}`);
assert.match(pdf.headers["content-disposition"], /payslip-.*ICV-TG-0001/);
assert.equal(pdf.body.subarray(0, 4).toString(), "%PDF");
assert.equal((await pdfOf(`/api/hr/payroll/${run._id}/download?staffId=${ngStaff._id}`)).status, 404);
ok("register + payslip PDFs render (preview inline, download as attachment)");

// send
sentMails.length = 0;
r = await c(hrTG.h).post(`/api/hr/payroll/${run._id}/send`, {});
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.data.sent.length + r.body.data.noEmail.length, 4);
assert.equal(r.body.data.failed.length, 0);
const slip = sentMails.find((m) => m.to[0] === amaUser.u.email);
assert.ok(slip, "payslip e-mailed to the staff member's work e-mail");
assert.equal(slip.attachments[0].filename, `payslip-${period}.pdf`);
assert.equal(Buffer.from(slip.attachments[0].content, "base64").subarray(0, 4).toString(), "%PDF");
assert.match(slip.subject, /bulletin de paie/i, "TG payslip e-mail is French");
const summary = sentMails.find((m) => m.to[0] === "finance@i-coffee.tg");
assert.ok(summary && summary.attachments[0].filename === `payroll-${period}.pdf`, "signed register sent to the payroll notification address");
const after = (await c(hrTG.h).get(`/api/hr/payroll/${run._id}`)).body.data;
assert.ok(after.lines.find((l) => l.fullName === "Ama Mensah").payslipSentAt && after.summarySentAt);
assert.equal((await c(hrTG.h).post(`/api/hr/payroll/${run._id}/mark-paid`, {})).body.data.status, "PAID");
assert.ok((await ActivityLog.countDocuments({ action: "HR_PAYROLL_SEND" })) >= 1);
ok("payslips (with attachment) and the signed register are e-mailed; run marked paid");

// draft delete + IT global
const itRun = await c(it.h).post("/api/hr/payroll", { period, countryCode: "NG" });
assert.equal(itRun.status, 200, JSON.stringify(itRun.body));
assert.equal(itRun.body.data.currency, "NGN");
assert.equal((await c(hrHQ.h).get(`/api/hr/payroll/${itRun.body.data._id}`)).status, 200, "HQ HR sees Nigeria's payroll");
assert.equal((await c(hrTG.h).get(`/api/hr/payroll/${itRun.body.data._id}`)).status, 404);
assert.equal((await c(it.h).del(`/api/hr/payroll/${itRun.body.data._id}`)).status, 200, "draft can be deleted");
assert.equal((await c(it.h).get("/api/hr/payroll")).body.data.length, 1);
ok("IT/Director are global; HQ HR is Nigeria-only; drafts deletable");

// user management: HR details captured together with the account
console.log("user management integration");
const mount = (await import("../route/admin-user.route.js")).default;
void mount;
const newAcct = (over = {}) => ({ name: "New Hire", email: "newhire@t.com", password: "Passw0rd!x", role: "ADMIN", subRole: "SALES", ...over });
r = await c(hrTG.h).post("/api/admin-user/create-user", newAcct({ staffProfile: staffBody({ fullName: "" , employment: { workMode: "HYBRID", jobTitle: "Rep", startDate: "2026-01-05" } }) }));
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.staff.countryCode, "TG", "HR record lands in the creator's country");
assert.equal(r.body.staff.fullName, "New Hire");
assert.equal(String(r.body.staff.userId), String(r.body.data._id), "staff record is linked to the new login");
assert.equal(r.body.staff.bank.accountMasked, "••••6789");
r = await c(hrTG.h).post("/api/admin-user/create-user", newAcct({ email: "bad@t.com", staffProfile: { dateOfBirth: "garbage" } }));
assert.equal(r.status, 400);
assert.equal(await User.countDocuments({ email: "bad@t.com" }), 0, "invalid HR details create no account");
r = await c(hrHQ.h).post("/api/admin-user/create-user", newAcct({ email: "hq@t.com", staffProfile: staffBody({ fullName: "HQ Hire" }) }));
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.staff.countryCode, "NG", "unscoped HR → Nigeria");
r = await c(it.h).post("/api/admin-user/create-user", newAcct({ email: "it@t.com", staffProfile: staffBody() }));
assert.equal(r.status, 200);
assert.ok(r.body.staffError, "global creator without a country: account created, HR record reported as pending");
r = await c(it.h).post("/api/admin-user/create-user", newAcct({ email: "it2@t.com", scope: "COUNTRY", assignedCountry: "BJ", staffProfile: staffBody({ countryCode: "BJ" }) }));
assert.equal(r.body.staff?.countryCode, "BJ");
r = await c(it.h).post("/api/admin-user/create-user", newAcct({ email: "cust@t.com", role: "USER", subRole: undefined, staffProfile: staffBody() }));
assert.equal(r.status, 400, "HR details only for admin accounts");
ok("user management: HR details saved with the account, validated first, country rules shared with HR");

// dashboard + termination
r = await c(hrTG.h).get("/api/hr/dashboard");
assert.equal(r.body.data.headcount, 5);
assert.equal(r.body.data.byWorkMode.FULL_TIME, 2);
assert.equal(r.body.data.presentToday.office + r.body.data.presentToday.remote >= 2, true);
assert.equal((await c(hrTG.h).del(`/api/hr/staff/${kofi._id}`)).body.data.employment.status, "TERMINATED");
assert.equal((await c(hrTG.h).get("/api/hr/dashboard")).body.data.headcount, 4);
assert.equal((await c(hrNG.h).del(`/api/hr/staff/${ama._id}`)).status, 404);
ok("dashboard counts; termination is a soft delete");

console.log(`\nall ${passed} HR groups passed`);
await mongoose.disconnect();
process.exit(0);
