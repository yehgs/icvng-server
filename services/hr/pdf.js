// server/services/hr/pdf.js — payroll register and payslip PDFs (pdfkit), with logo and signature.
import PDFDocument from "pdfkit";
import dns from "dns/promises";
import net from "net";
import { fmtMoney } from "./common.js";

const BROWN = "#4B2E2B", GOLD = "#C69C6D", GREY = "#6b6b6b";

const privateIp = (ip) => /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1|fc|fd|fe80)/i.test(ip);
/** Fetch an https image (png/jpeg) for embedding. Refuses private hosts, >2MB, other types. Returns Buffer|null. */
export async function fetchImage(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    if (net.isIP(u.hostname) ? privateIp(u.hostname) : false) return null;
    if (!net.isIP(u.hostname)) { const addrs = await dns.lookup(u.hostname, { all: true }); if (addrs.some((a) => privateIp(a.address))) return null; }
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    const res = await fetch(url, { signal: ctl.signal, redirect: "error" }).finally(() => clearTimeout(t));
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "";
    if (!/image\/(png|jpe?g)/i.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 2 * 1024 * 1024 ? null : buf;
  } catch {
    return null;
  }
}

const collect = (doc) => new Promise((resolve, reject) => {
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  doc.on("end", () => resolve(Buffer.concat(chunks)));
  doc.on("error", reject);
});

function header(doc, { settings, logo, title, subtitle }) {
  if (logo) { try { doc.image(logo, 40, 36, { fit: [90, 50] }); } catch { /* unsupported image: skip */ } }
  doc.fillColor(BROWN).font("Helvetica-Bold").fontSize(16).text(settings.companyName || "I-Coffee", 140, 38, { width: 415, align: "right" });
  doc.font("Helvetica").fontSize(9).fillColor(GREY).text(settings.companyAddress || "", 140, 58, { width: 415, align: "right" });
  doc.moveTo(40, 96).lineTo(555, 96).lineWidth(2).strokeColor(GOLD).stroke();
  doc.fillColor(BROWN).font("Helvetica-Bold").fontSize(14).text(title, 40, 108);
  doc.font("Helvetica").fontSize(9).fillColor(GREY).text(subtitle, 40, 128);
  doc.y = 150;
}
function signatureBlock(doc, run, signature) {
  const y = Math.min(doc.y + 24, 730);
  const s = run.signedBy;
  if (signature) { try { doc.image(signature, 40, y, { fit: [130, 50] }); } catch { /* skip */ } }
  doc.moveTo(40, y + 56).lineTo(200, y + 56).lineWidth(0.7).strokeColor("#999").stroke();
  doc.font("Helvetica-Bold").fontSize(9).fillColor(BROWN).text(s?.name || "Authorised signatory", 40, y + 60);
  doc.font("Helvetica").fontSize(8).fillColor(GREY).text(`${s?.title || ""}${s?.signedAt ? `  ·  signed ${new Date(s.signedAt).toISOString().slice(0, 10)}` : "  ·  NOT YET APPROVED"}`, 40, y + 72);
}

/** Payroll register: every staff name with bank details and amounts, signed. */
export async function buildPayrollRegisterPdf({ run, settings, logo, signature, status = run.status }) {
  const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
  const done = collect(doc);
  const d = run.decimals, cur = run.currency;
  header(doc, { settings, logo, title: `Payroll register — ${run.period}`, subtitle: `${run.countryCode} · ${cur} · ${run.totals.headcount} staff · status ${status}` });
  const cols = [{ t: "Staff", w: 118 }, { t: "Bank", w: 128 }, { t: "Gross", w: 90, r: 1 }, { t: "Deduct.", w: 85, r: 1 }, { t: "Net pay", w: 94, r: 1 }];
  const row = (cells, bold = false, shade = false) => {
    const y = doc.y;
    if (y > 740) { doc.addPage(); doc.y = 50; return row(cells, bold, shade); }
    if (shade) doc.rect(40, y - 2, 515, 30).fill("#f6efe8");
    let x = 40;
    cells.forEach((c, i) => {
      doc.fillColor("#222").font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8).text(String(c), x + 3, y, { width: cols[i].w - 6, align: cols[i].r ? "right" : "left", lineBreak: true, height: 28 });
      x += cols[i].w;
    });
    doc.y = y + 30;
  };
  row(cols.map((c) => c.t), true, true);
  for (const l of run.lines) {
    row([`${l.fullName}\n${l.employeeId}`, `${l.bank.bankName}\n${l.bank.accountName} · ${l.bank.accountNumber || "—"}`, fmtMoney(l.gross, d), fmtMoney(l.totalDeductions, d), fmtMoney(l.net, d)]);
  }
  doc.moveTo(40, doc.y).lineTo(555, doc.y).lineWidth(0.7).strokeColor(GOLD).stroke();
  doc.y += 6;
  row(["TOTAL", `${run.totals.headcount} staff`, fmtMoney(run.totals.gross, d), fmtMoney(run.totals.deductions, d), fmtMoney(run.totals.net, d)], true);
  signatureBlock(doc, run, signature);
  if (settings.payslipFooter) doc.font("Helvetica").fontSize(7).fillColor(GREY).text(settings.payslipFooter, 40, 790, { width: 515, align: "center" });
  doc.end();
  return done;
}

/** One payslip. `maskBank` hides all but the last 4 digits (used for the copy e-mailed to the employee). */
export async function buildPayslipPdf({ run, line: l, settings, logo, signature, maskBank = true }) {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const done = collect(doc);
  const d = run.decimals;
  header(doc, { settings, logo, title: `Payslip — ${run.period}`, subtitle: `${l.fullName} · ${l.employeeId}${l.jobTitle ? " · " + l.jobTitle : ""}${l.department ? " · " + l.department : ""}` });
  const acct = l.bank.accountNumber ? (maskBank ? `••••${l.bank.accountNumber.slice(-4)}` : l.bank.accountNumber) : "—";
  doc.font("Helvetica").fontSize(9).fillColor("#222").text(`Paid to: ${l.bank.accountName || l.fullName} · ${l.bank.bankName || "—"} · ${acct}`, 40, doc.y);
  doc.moveDown(1);
  const line = (label, amount, { bold = false, neg = false } = {}) => {
    const y = doc.y;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor("#222").text(label, 40, y, { width: 340 });
    doc.text(`${neg ? "−" : ""}${fmtMoney(amount, d)}`, 380, y, { width: 175, align: "right" });
    doc.y = y + 18;
  };
  const section = (t) => { doc.moveDown(0.3).font("Helvetica-Bold").fontSize(9).fillColor(GOLD).text(t.toUpperCase(), 40, doc.y); doc.y += 4; };
  section(`Earnings (${run.currency})`);
  line("Base salary", l.baseSalary);
  for (const a of l.allowances) line(a.name, a.amount);
  if (l.bonus) line("Bonus", l.bonus);
  if (l.overtime) line("Overtime", l.overtime);
  if (l.unpaidLeaveDeduction) line(`Unpaid leave (${l.unpaidLeaveDays} day${l.unpaidLeaveDays === 1 ? "" : "s"})`, l.unpaidLeaveDeduction, { neg: true });
  line("Gross pay", l.gross, { bold: true });
  section("Deductions");
  for (const x of l.deductions) line(x.name, x.amount, { neg: true });
  if (l.otherDeductions) line("Other deductions", l.otherDeductions, { neg: true });
  if (!l.deductions.length && !l.otherDeductions) line("None", 0);
  line("Total deductions", l.totalDeductions, { bold: true, neg: true });
  doc.moveTo(40, doc.y + 2).lineTo(555, doc.y + 2).lineWidth(1.2).strokeColor(BROWN).stroke();
  doc.y += 10;
  line("NET PAY", l.net, { bold: true });
  if (l.note) doc.font("Helvetica-Oblique").fontSize(8).fillColor(GREY).text(`Note: ${l.note}`, 40, doc.y + 4);
  signatureBlock(doc, run, signature);
  if (settings.payslipFooter) doc.font("Helvetica").fontSize(7).fillColor(GREY).text(settings.payslipFooter, 40, 790, { width: 515, align: "center" });
  doc.end();
  return done;
}

/* ───────────────────────── HR forms ───────────────────────── */
const box = (doc, x, y, w, h = 20) => doc.roundedRect(x, y, w, h, 2).lineWidth(0.7).strokeColor("#9a9a9a").stroke();
function ensureSpace(doc, need) { if (doc.y + need > 780) { doc.addPage(); doc.y = 50; } }
function sectionBar(doc, text) {
  ensureSpace(doc, 40);
  const y = doc.y + 6;
  doc.rect(40, y, 515, 16).fill("#f6efe8");
  doc.fillColor(BROWN).font("Helvetica-Bold").fontSize(9).text(text.toUpperCase(), 46, y + 4);
  doc.y = y + 24;
}
/** Row of empty fill-in boxes: fields = [[label, widthFraction], …] */
function blankRow(doc, fields, h = 20) {
  ensureSpace(doc, h + 16);
  const y = doc.y, gap = 8, total = fields.reduce((n, f) => n + (f[1] || 1), 0), usable = 515 - gap * (fields.length - 1);
  let x = 40;
  for (const [label, frac = 1] of fields) {
    const w = (usable * frac) / total;
    doc.font("Helvetica").fontSize(7.5).fillColor(GREY).text(label, x, y, { width: w });
    box(doc, x, y + 10, w, h);
    x += w + gap;
  }
  doc.y = y + h + 18;
}
function checkRow(doc, label, options) {
  ensureSpace(doc, 30);
  const y = doc.y;
  doc.font("Helvetica").fontSize(7.5).fillColor(GREY).text(label, 40, y);
  let x = 40;
  for (const o of options) {
    doc.rect(x, y + 11, 9, 9).lineWidth(0.7).strokeColor("#9a9a9a").stroke();
    doc.font("Helvetica").fontSize(8.5).fillColor("#222").text(o, x + 13, y + 11.5, { lineBreak: false });
    x += 22 + doc.widthOfString(o) + 14;
  }
  doc.y = y + 30;
}
function digitBoxes(doc, label, n) {
  ensureSpace(doc, 34);
  const y = doc.y;
  doc.font("Helvetica").fontSize(7.5).fillColor(GREY).text(label, 40, y);
  for (let i = 0; i < n; i++) box(doc, 40 + i * 22, y + 10, 20, 20);
  doc.y = y + 40;
}
function footers(doc, settings, text) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // footer sits inside the bottom margin; without this pdfkit adds a blank page
    doc.font("Helvetica").fontSize(7).fillColor(GREY).text(`${text}${settings.payslipFooter ? "  ·  " + settings.payslipFooter : ""}   —   Page ${i + 1} of ${range.count}`, 40, 812, { width: 515, align: "center", lineBreak: false });
  }
}

/** Empty, printable "Staff information form" for hard-copy completion. */
export async function buildBlankStaffFormPdf({ settings, logo, countryName = "" }) {
  const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
  const done = collect(doc);
  header(doc, { settings, logo, title: "Staff Information Form", subtitle: `${countryName ? countryName + " · " : ""}Please complete in BLOCK LETTERS using black or blue ink. Return the signed form to HR.` });
  // passport photo box, top right of the first section
  doc.rect(455, 150, 100, 120).lineWidth(0.7).strokeColor("#9a9a9a").stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(GREY).text("Attach passport photograph", 460, 200, { width: 90, align: "center" });
  const full = doc.y;
  const narrow = (rows) => { for (const r of rows) { ensureSpace(doc, 40); const y = doc.y, gap = 8, usable = 400 - gap * (r.length - 1), total = r.reduce((n, f) => n + (f[1] || 1), 0); let x = 40; for (const [label, frac = 1] of r) { const w = (usable * frac) / total; doc.font("Helvetica").fontSize(7.5).fillColor(GREY).text(label, x, y, { width: w }); box(doc, x, y + 10, w, 20); x += w + gap; } doc.y = y + 38; } };
  sectionBar(doc, "A. Personal details");
  doc.y = Math.max(doc.y, full + 30);
  narrow([[["Full name (surname first) *", 1]], [["Date of birth (DD/MM/YYYY)", 1], ["Nationality", 1]]]);
  doc.y = Math.max(doc.y, 280);
  checkRow(doc, "Gender", ["Male", "Female", "Other", "Prefer not to say"]);
  checkRow(doc, "Marital status", ["Single", "Married", "Divorced", "Widowed", "Other"]);
  blankRow(doc, [["Phone number *", 1], ["Personal e-mail", 1.4]]);
  blankRow(doc, [["Residential address — line 1 *", 1]]);
  blankRow(doc, [["Address — line 2", 1]]);
  blankRow(doc, [["City / town", 1], ["State / region", 1], ["Country", 1], ["Postal code", 0.7]]);

  sectionBar(doc, "B. Emergency contact");
  blankRow(doc, [["Full name *", 1.3], ["Relationship *", 1], ["Phone *", 1]]);

  sectionBar(doc, "C. Employment (completed by HR)");
  blankRow(doc, [["Employee ID", 0.8], ["Job title", 1.2], ["Department", 1]]);
  checkRow(doc, "Employment type", ["Permanent", "Contract", "Part-time", "Intern"]);
  checkRow(doc, "Work mode", ["Full-time (on site)", "Hybrid", "Remote"]);
  blankRow(doc, [["Start date", 1], ["Line manager", 1.2], ["Office / location", 1]]);

  sectionBar(doc, "D. Bank & statutory details (salary payment)");
  blankRow(doc, [["Bank name *", 1], ["Account name *", 1.2]]);
  digitBoxes(doc, "Account number *", 10);
  blankRow(doc, [["Branch", 1], ["Sort code / IBAN / SWIFT", 1.2], ["Tax ID", 1], ["Pension ID", 1]]);

  sectionBar(doc, "E. Health information (optional — confidential)");
  blankRow(doc, [["Blood group", 0.6], ["Genotype", 0.6], ["Allergies / conditions HR should know about", 2.4]]);

  sectionBar(doc, "F. Documents submitted");
  checkRow(doc, "Tick what you are handing in", ["Government ID", "Certificates", "Passport photos", "Guarantor form", "Bank letter"]);

  sectionBar(doc, "G. Declaration");
  ensureSpace(doc, 110);
  doc.font("Helvetica").fontSize(8.5).fillColor("#222").text("I confirm that the information above is true and complete. I will tell HR promptly of any change and I consent to the company keeping and processing this information for employment, payroll and legal purposes.", 40, doc.y, { width: 515 });
  doc.y += 14;
  const sy = doc.y + 24;
  doc.moveTo(40, sy).lineTo(260, sy).lineWidth(0.7).strokeColor("#777").stroke();
  doc.moveTo(300, sy).lineTo(420, sy).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(GREY).text("Employee signature", 40, sy + 3).text("Date", 300, sy + 3);
  doc.y = sy + 26;
  ensureSpace(doc, 60);
  const oy = doc.y;
  doc.rect(40, oy, 515, 46).lineWidth(0.7).strokeColor("#9a9a9a").stroke();
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(BROWN).text("HR OFFICE USE", 46, oy + 4);
  doc.font("Helvetica").fillColor(GREY).text("Received by: ______________________   Date: ____________   Employee ID assigned: ____________   Entered in system ☐", 46, oy + 24, { width: 505 });
  footers(doc, settings, "Staff information form — confidential once completed");
  doc.end();
  return done;
}

const val = (v) => (v === undefined || v === null || v === "" ? "—" : String(v));
const fmtDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");
function kv(doc, rows, { cols = 2 } = {}) {
  const w = 515 / cols;
  for (let i = 0; i < rows.length; i += cols) {
    ensureSpace(doc, 34);
    const y = doc.y;
    rows.slice(i, i + cols).forEach(([k, v], j) => {
      doc.font("Helvetica").fontSize(7.5).fillColor(GREY).text(k, 40 + j * w, y, { width: w - 10 });
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#222").text(val(v), 40 + j * w, y + 10, { width: w - 10 });
    });
    doc.y = y + 30;
  }
}

/**
 * One staff member's details. `sensitive` (decrypted account number, tax id, health notes + salary) is only passed
 * after the caller re-entered their password; otherwise the bank number is masked and salary/health are omitted.
 */
export async function buildStaffDetailsPdf({ staff: s, sensitive = null, settings, logo, photo = null, signature = null, signer = null, exportedBy = "", countryName = "" }) {
  const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
  const done = collect(doc);
  header(doc, { settings, logo, title: `Staff details — ${s.fullName}`, subtitle: `${s.employeeId}${s.employment?.jobTitle ? " · " + s.employment.jobTitle : ""}${countryName ? " · " + countryName : ""}` });
  const top = doc.y;
  if (photo) { try { doc.image(photo, 455, top, { fit: [100, 120] }); } catch { /* unsupported image: skip */ } } else { doc.rect(455, top, 100, 120).lineWidth(0.5).strokeColor("#ccc").stroke(); }
  const a = s.address || {}, e = s.employment || {}, ec = s.emergencyContact || {}, b = s.bank || {};
  doc.y = top; // left column narrower beside the photo
  const side = (rows) => { for (const [k, v] of rows) { const y = doc.y; doc.font("Helvetica").fontSize(7.5).fillColor(GREY).text(k, 40, y, { width: 400 }); doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#222").text(val(v), 40, y + 10, { width: 400 }); doc.y = y + 28; } };
  side([["Full name", s.fullName], ["Gender / Date of birth", `${val(s.gender)} · ${fmtDate(s.dateOfBirth)}`], ["Marital status / Nationality", `${val(s.maritalStatus)} · ${val(s.nationality)}`], ["Phone / Personal e-mail", `${val(s.phone)} · ${val(s.personalEmail)}`]]);
  doc.y = Math.max(doc.y, top + 128);
  sectionBar(doc, "Address & emergency contact");
  kv(doc, [["Address", [a.line1, a.line2].filter(Boolean).join(", ")], ["City / State", [a.city, a.state].filter(Boolean).join(", ")], ["Country / Postal code", [a.country, a.postalCode].filter(Boolean).join(" · ")], ["Emergency contact", [ec.name, ec.relationship, ec.phone].filter(Boolean).join(" · ")]]);
  sectionBar(doc, "Employment");
  kv(doc, [["Job title", e.jobTitle], ["Department", e.department], ["Employment type", e.employmentType], ["Work mode", e.workMode], ["Status", e.status], ["Start date", fmtDate(e.startDate)], ["Probation ends", fmtDate(e.probationEndDate)], ["Contract ends", fmtDate(e.contractEndDate)], ["Leave entitlement (days)", s.leaveEntitlementDays]], { cols: 3 });
  sectionBar(doc, "Bank details");
  const acct = sensitive ? sensitive.accountNumber : b.accountMasked || (b.accountLast4 ? `••••${b.accountLast4}` : "");
  kv(doc, [["Bank", b.bankName], ["Account name", b.accountName], ["Account number", acct || "—"], ["Branch", b.branch], ["Sort code / IBAN / SWIFT", b.sortCode], ["Pension ID", b.pensionId]], { cols: 3 });
  if (sensitive) {
    const sal = s.salary || {};
    sectionBar(doc, "Salary & confidential");
    kv(doc, [["Base salary (monthly)", `${val(sal.currency)} ${Number(sal.baseSalary || 0).toLocaleString("en-US")}`], ["Allowances", (sal.allowances || []).map((x) => `${x.name} ${Number(x.amount).toLocaleString("en-US")}`).join(", ") || "None"], ["Deductions", (sal.deductions || []).map((x) => `${x.name} ${x.type === "PERCENT" ? x.value + "% of " + String(x.of).toLowerCase() : Number(x.value).toLocaleString("en-US")}`).join(", ") || "None"], ["Tax ID", sensitive.taxId], ["Health status", s.health?.status], ["Blood group / Genotype", `${val(s.health?.bloodGroup)} / ${val(s.health?.genotype)}`]], { cols: 3 });
    if (sensitive.healthNotes) { doc.font("Helvetica").fontSize(7.5).fillColor(GREY).text("Health notes", 40, doc.y); doc.font("Helvetica").fontSize(9).fillColor("#222").text(sensitive.healthNotes, 40, doc.y + 2, { width: 515 }); doc.y += 8; }
  }
  if (s.notes) { sectionBar(doc, "HR notes"); doc.font("Helvetica").fontSize(9).fillColor("#222").text(s.notes, 40, doc.y, { width: 515 }); doc.y += 8; }
  ensureSpace(doc, 90);
  const y = doc.y + 18;
  if (signature) { try { doc.image(signature, 40, y, { fit: [130, 50] }); } catch { /* skip */ } }
  doc.moveTo(40, y + 56).lineTo(200, y + 56).lineWidth(0.7).strokeColor("#999").stroke();
  doc.font("Helvetica-Bold").fontSize(9).fillColor(BROWN).text(signer?.name || "Authorised signatory", 40, y + 60);
  doc.font("Helvetica").fontSize(8).fillColor(GREY).text(signer?.title || "", 40, y + 72);
  footers(doc, settings, `CONFIDENTIAL — exported by ${exportedBy || "HR"} on ${new Date().toISOString().slice(0, 10)}${sensitive ? " (includes sensitive data)" : ""}`);
  doc.end();
  return done;
}
