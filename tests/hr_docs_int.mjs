// Run: TEST_MONGO_URI=mongodb://127.0.0.1:27018 node tests/hr_docs_int.mjs
// HR documents: blank staff form (download + e-mail), password-gated staff export with throttle,
// multiple logos/signatures and their use in payroll, plus country scope.
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
import bcryptjs from "bcryptjs";
import request from "supertest";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const sentMails = [], imageHits = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("api.resend.com")) { const body = JSON.parse(opts.body); sentMails.push(body); return { ok: true, status: 200, json: async () => ({ id: "m" + sentMails.length }) }; }
  if (u.startsWith("https://img.test/")) { imageHits.push(u); return { ok: true, status: 200, headers: { get: () => "image/png" }, arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.length) }; }
  return realFetch(url, opts);
};
// img.test must resolve for fetchImage's DNS guard
const dns = await import("dns/promises");
const realLookup = dns.default.lookup;
dns.default.lookup = async (h, o) => (h === "img.test" ? [{ address: "93.184.216.34", family: 4 }] : realLookup(h, o));

await mongoose.connect((process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27018") + "/icv_test_hrdocs_" + Date.now());
const { default: hrRouter } = await import("../route/hr.route.js");
const { default: User } = await import("../models/user.model.js");
const { default: ActivityLog } = await import("../models/activity-log.model.js");
const { default: HrSettings } = await import("../models/hr/hr-settings.model.js");
const { _resetThrottle } = await import("../controllers/hr/documents.controller.js");
const { refreshCountryCache } = await import("../services/countryService.js");
await refreshCountryCache();

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/hr", hrRouter);
app.use((err, req, res, next) => { console.error("UNHANDLED", err); res.status(500).json({ message: err.message }); });

const PASS = "Correct-Horse-9";
const hash = await bcryptjs.hash(PASS, 4);
let n = 0;
const mk = async (subRole, scope = "GLOBAL", assignedCountry = null, password = hash) => {
  const u = await User.create({ name: `${subRole}${assignedCountry || ""}${++n}`, email: `d${n}@t.com`, password, role: "ADMIN", subRole, scope, assignedCountry, status: "Active", avatar: "https://img/a.png" });
  return { u, h: { Authorization: `Bearer ${jwt.sign({ id: String(u._id) }, "testsecret")}` } };
};
const it = await mk("IT"), hrTG = await mk("HR", "COUNTRY", "TG"), hrNG = await mk("HR", "COUNTRY", "NG"), sales = await mk("SALES", "COUNTRY", "TG");
const c = (h) => ({
  get: (u) => request(app).get(u).set(h).buffer(true).parse((res, cb) => { const ch = []; res.on("data", (d) => ch.push(d)); res.on("end", () => cb(null, Buffer.concat(ch))); }),
  json: (u) => request(app).get(u).set(h),
  post: (u, b) => request(app).post(u).set(h).send(b),
  put: (u, b) => request(app).put(u).set(h).send(b),
});
let passed = 0;
const ok = (name) => { passed++; console.log("  ✓", name); };
const isPdf = (b) => Buffer.isBuffer(b) && b.slice(0, 5).toString() === "%PDF-";

// ── branding CRUD ──
console.log("multiple logos & signatures");
let r = await c(hrTG.h).put("/api/hr/settings", { logos: [{ label: "Main logo", url: "https://img.test/a.png", isDefault: true }, { label: "Gold edition", url: "https://img.test/b.png" }], signatures: [{ label: "HR Director", url: "https://img.test/s1.png", signerName: "Ama Mensah", signerTitle: "HR Director", isDefault: true }, { label: "CEO", url: "https://img.test/s2.png", signerName: "Kofi Boateng", signerTitle: "CEO" }] });
assert.equal(r.status, 200, JSON.stringify(r.body));
r = await c(hrTG.h).json("/api/hr/settings");
const logos = r.body.data.logos, sigs = r.body.data.signatures;
assert.equal(logos.length, 2); assert.equal(sigs.length, 2);
assert.equal(logos.filter((l) => l.isDefault).length, 1);
assert.equal(r.body.data.logoUrl, "https://img.test/a.png", "legacy field mirrors the default logo");
assert.equal(r.body.data.signerName, "Ama Mensah");
ok("several logos and signatures are saved; exactly one default; legacy fields mirror the default");
r = await c(hrTG.h).put("/api/hr/settings", { logos: [{ label: "Bad", url: "http://insecure/x.png" }] });
assert.equal(r.status, 400);
r = await c(hrTG.h).put("/api/hr/settings", { logos: Array.from({ length: 11 }, (_, i) => ({ label: "L" + i, url: "https://img.test/x.png" })) });
assert.equal(r.status, 400);
ok("non-https URLs and more than 10 logos are rejected");

// ── blank form ──
console.log("blank staff form");
r = await c(hrTG.h).get("/api/hr/forms/staff-form");
assert.equal(r.status, 200); assert.ok(isPdf(r.body), "is a PDF"); assert.match(r.headers["content-disposition"], /attachment; filename="staff-information-form-TG\.pdf"/);
assert.ok(r.body.length > 3000);
ok("HR downloads the blank form as a PDF attachment");
imageHits.length = 0;
r = await c(hrTG.h).get(`/api/hr/forms/staff-form?logoId=${logos[1]._id}`);
assert.equal(r.status, 200); assert.deepEqual(imageHits, ["https://img.test/b.png"], "the selected (non-default) logo was embedded");
ok("the selected logo is the one embedded");
assert.equal((await c(hrTG.h).get("/api/hr/forms/staff-form?logoId=" + new mongoose.Types.ObjectId())).status, 400);
assert.equal((await c(hrTG.h).get("/api/hr/forms/staff-form?countryCode=NG")).status, 403, "other country refused");
assert.equal((await c(sales.h).get("/api/hr/forms/staff-form")).status, 403);
assert.equal((await c(it.h).get("/api/hr/forms/staff-form")).status, 400, "global admin must name a country");
assert.equal((await c(it.h).get("/api/hr/forms/staff-form?countryCode=TG")).status, 200);
ok("unknown logo 400, foreign country 403, non-HR 403, global admin needs countryCode");
sentMails.length = 0;
r = await c(hrTG.h).post("/api/hr/forms/staff-form/send", { to: "newhire@example.com", logoId: logos[0]._id });
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(sentMails.length, 1);
assert.equal(sentMails[0].attachments?.length, 1);
assert.match(sentMails[0].attachments[0].filename, /\.pdf$/);
assert.equal((await c(hrTG.h).post("/api/hr/forms/staff-form/send", { to: "nope" })).status, 400);
ok("blank form e-mailed with a PDF attachment; bad address refused");

// ── staff export ──
console.log("password-gated staff export");
const staffBody = { fullName: "Ama Mensah", gender: "FEMALE", dateOfBirth: "1992-03-14", phone: "+22890000000", personalEmail: "ama@x.com", address: { line1: "5 Rue Test", city: "Lomé", country: "Togo" }, emergencyContact: { name: "Kofi", relationship: "Brother", phone: "+22891111111" }, health: { status: "FIT", bloodGroup: "O+", genotype: "AA", notes: "Mild asthma" }, employment: { jobTitle: "Barista Lead", department: "Retail", workMode: "FULL_TIME", employmentType: "PERMANENT", startDate: "2025-01-06" }, salary: { currency: "XOF", baseSalary: 300000 }, bank: { bankName: "Ecobank", accountName: "Ama Mensah", accountNumber: "0123456789", taxId: "TX-9981" } };
r = await c(hrTG.h).post("/api/hr/staff", staffBody);
assert.equal(r.status, 200, JSON.stringify(r.body));
const ama = r.body.data;
const exp = (a, id, body) => c(a.h).post(`/api/hr/staff/${id}/export`, body);
_resetThrottle();
r = await exp(hrTG, ama._id, {});
assert.equal(r.status, 400); ok("no password → 400");
r = await exp(hrTG, ama._id, { password: "wrong" });
assert.equal(r.status, 403); assert.equal(r.body.message, "Incorrect password");
ok("wrong password → 403, no PDF");
const bin = (a, id, body) => request(app).post(`/api/hr/staff/${id}/export`).set(a.h).send(body).buffer(true).parse((res, cb) => { const ch = []; res.on("data", (d) => ch.push(d)); res.on("end", () => cb(null, Buffer.concat(ch))); });
r = await bin(hrTG, ama._id, { password: PASS, logoId: logos[1]._id, signatureId: sigs[1]._id });
assert.equal(r.status, 200); assert.ok(isPdf(r.body)); assert.equal(r.headers["cache-control"], "no-store");
assert.match(r.headers["content-disposition"], /attachment; filename="staff-/);
ok("correct password → PDF attachment with no-store caching");
const plainPdf = r.body;
r = await bin(hrTG, ama._id, { password: PASS, includeSensitive: true });
assert.equal(r.status, 200); assert.ok(isPdf(r.body)); assert.notEqual(r.body.length, plainPdf.length, "sensitive export differs");
ok("includeSensitive produces a different (fuller) document");
assert.equal((await exp(hrTG, ama._id, { password: PASS, logoId: "000000000000000000000000" })).status, 400);
ok("unknown logo → 400");
const logs = await ActivityLog.find({ action: { $in: ["HR_STAFF_EXPORT", "HR_EXPORT_DENIED"] } }).lean();
assert.ok(logs.some((l) => l.action === "HR_STAFF_EXPORT") && logs.some((l) => l.action === "HR_EXPORT_DENIED"));
assert.ok(logs.some((l) => /including sensitive data/.test(l.description || l.details || JSON.stringify(l))));
ok("successful and denied exports are audited");

// scope
assert.equal((await exp(hrNG, ama._id, { password: PASS })).status, 404, "NG HR cannot export a TG staff record");
assert.equal((await exp(sales, ama._id, { password: PASS })).status, 403);
assert.equal((await exp(it, ama._id, { password: PASS })).status, 200);
ok("country scope (404), non-HR (403), IT global (200)");

// throttle
_resetThrottle();
for (let i = 0; i < 4; i++) assert.equal((await exp(hrTG, ama._id, { password: "bad" + i })).status, 403);
assert.equal((await exp(hrTG, ama._id, { password: "bad5" })).status, 429, "5th failure locks");
r = await exp(hrTG, ama._id, { password: PASS });
assert.equal(r.status, 429); assert.ok(r.headers["retry-after"]);
assert.equal((await exp(it, ama._id, { password: PASS })).status, 200, "lock is per account");
ok("5 wrong passwords lock that account for 15 minutes (even the right password), others unaffected");
_resetThrottle();
assert.equal((await exp(hrTG, ama._id, { password: PASS })).status, 200);
for (let i = 0; i < 3; i++) await exp(hrTG, ama._id, { password: "x" });
await exp(hrTG, ama._id, { password: PASS });
for (let i = 0; i < 4; i++) assert.equal((await exp(hrTG, ama._id, { password: "x" })).status, 403);
ok("a successful password resets the failure counter");

// no-password account
const social = await mk("HR", "COUNTRY", "TG", "x");
await User.updateOne({ _id: social.u._id }, { $unset: { password: 1 } }, { strict: false });
await User.collection.updateOne({ _id: social.u._id }, { $unset: { password: "" } });
r = await exp(social, ama._id, { password: "anything" });
assert.equal(r.status, 400); ok("account without a password gets a clear 400");

// ── payroll picks logo/signature ──
console.log("payroll branding");
const period = new Date().toISOString().slice(0, 7);
r = await c(hrTG.h).post("/api/hr/payroll", { period, logoId: logos[1]._id, signatureId: sigs[1]._id });
assert.equal(r.status, 200, JSON.stringify(r.body));
const run = r.body.data;
assert.equal(run.branding.logoId, logos[1]._id);
assert.equal((await c(hrTG.h).put(`/api/hr/payroll/${run._id}/branding`, { logoId: "000000000000000000000000" })).status, 400);
r = await c(hrTG.h).put(`/api/hr/payroll/${run._id}/branding`, { logoId: logos[0]._id, signatureId: sigs[0]._id });
assert.equal(r.status, 200); assert.equal(r.body.data.branding.logoId, logos[0]._id);
assert.equal((await c(hrNG.h).put(`/api/hr/payroll/${run._id}/branding`, { logoId: logos[0]._id })).status, 404);
imageHits.length = 0;
r = await c(hrTG.h).get(`/api/hr/payroll/${run._id}/download`);
assert.equal(r.status, 200); assert.ok(isPdf(r.body)); assert.ok(imageHits.includes("https://img.test/a.png"), "payroll PDF used the chosen logo");
ok("payroll create/change/download uses the chosen logo; unknown id 400; other country 404");
r = await c(hrTG.h).post(`/api/hr/payroll/${run._id}/approve`, { signatureId: sigs[1]._id });
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.data.signedBy?.name, "Kofi Boateng", "approval signed with the chosen signature");
assert.equal((await c(hrTG.h).put(`/api/hr/payroll/${run._id}/branding`, { logoId: logos[1]._id })).status, 409);
ok("approval signs with the selected signature, then the branding is locked (409)");

console.log(`\n${passed} groups passed`);
await mongoose.disconnect();
process.exit(0);
