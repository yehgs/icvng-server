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
