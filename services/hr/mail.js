// server/services/hr/mail.js — HR e-mails (attendance notification, payslips, leave decisions).
import { sendCountryEmail, wrapEmailTemplate } from "../../config/emailService.js";
import { esc } from "./common.js";

const L = {
  en: { attTitle: "Staff present in office", attBody: (n, o, t, a, d, f) => `<strong>${n}</strong> marked present at <strong>${o}</strong> on ${t}.<br/>Location: ${a}<br/>Distance from office: ${d}${f}`, outside: " — ⚠ outside the office geofence", slip: (p) => `Your payslip for ${p}`, slipBody: (n, p) => `Hello ${n},<br/><br/>Your payslip for <strong>${p}</strong> is attached. Please keep it confidential.`, summary: (p) => `Payroll ${p} — signed register`, summaryBody: (p, n) => `The signed payroll register for <strong>${p}</strong> (${n} staff) is attached.`, leave: (s) => `Your leave request was ${s}`, leaveBody: (n, f, t, s, note) => `Hello ${n},<br/><br/>Your leave from ${f} to ${t} has been <strong>${s}</strong>.${note ? `<br/>Note: ${note}` : ""}` },
  fr: { attTitle: "Personnel présent au bureau", attBody: (n, o, t, a, d, f) => `<strong>${n}</strong> s'est déclaré(e) présent(e) à <strong>${o}</strong> le ${t}.<br/>Position : ${a}<br/>Distance du bureau : ${d}${f}`, outside: " — ⚠ hors du périmètre du bureau", slip: (p) => `Votre bulletin de paie — ${p}`, slipBody: (n, p) => `Bonjour ${n},<br/><br/>Votre bulletin de paie pour <strong>${p}</strong> est joint. Merci de le garder confidentiel.`, summary: (p) => `Paie ${p} — état signé`, summaryBody: (p, n) => `L'état de paie signé pour <strong>${p}</strong> (${n} employés) est joint.`, leave: (s) => `Votre demande de congé : ${s}`, leaveBody: (n, f, t, s, note) => `Bonjour ${n},<br/><br/>Votre congé du ${f} au ${t} a été <strong>${s}</strong>.${note ? `<br/>Note : ${note}` : ""}` },
  it: { attTitle: "Personale presente in ufficio", attBody: (n, o, t, a, d, f) => `<strong>${n}</strong> ha segnato la presenza presso <strong>${o}</strong> il ${t}.<br/>Posizione: ${a}<br/>Distanza dall'ufficio: ${d}${f}`, outside: " — ⚠ fuori dal perimetro dell'ufficio", slip: (p) => `Il tuo cedolino — ${p}`, slipBody: (n, p) => `Ciao ${n},<br/><br/>In allegato il cedolino di <strong>${p}</strong>. Ti preghiamo di mantenerlo riservato.`, summary: (p) => `Paghe ${p} — registro firmato`, summaryBody: (p, n) => `In allegato il registro paghe firmato per <strong>${p}</strong> (${n} dipendenti).`, leave: (s) => `La tua richiesta di ferie: ${s}`, leaveBody: (n, f, t, s, note) => `Ciao ${n},<br/><br/>Le tue ferie dal ${f} al ${t} sono state <strong>${s}</strong>.${note ? `<br/>Nota: ${note}` : ""}` },
};
const lang = (code) => ({ TG: "fr", BJ: "fr", CI: "fr", SN: "fr", IT: "it" }[code] || "en");
const t = (code) => L[lang(code)];

export async function sendAttendanceNotice({ countryCode, to, staffName, officeName, when, address, distance, outside }) {
  if (!to?.length) return false;
  const s = t(countryCode);
  const html = wrapEmailTemplate(countryCode, `<h2>${s.attTitle}</h2><p>${s.attBody(esc(staffName), esc(officeName), esc(when), esc(address || "—"), esc(distance), outside ? s.outside : "")}</p>`);
  let sent = false;
  for (const addr of to) { try { const r = await sendCountryEmail({ countryCode, sendTo: addr, subject: `${s.attTitle}: ${staffName}`, html }); sent = sent || !r?.suppressed; } catch (e) { console.error("[hr] attendance mail failed:", e.message); } }
  return sent;
}
export async function sendPayslipMail({ countryCode, to, name, period, pdf }) {
  const s = t(countryCode);
  return sendCountryEmail({ countryCode, sendTo: to, subject: s.slip(period), html: wrapEmailTemplate(countryCode, `<p>${s.slipBody(esc(name), esc(period))}</p>`), attachments: [{ filename: `payslip-${period}.pdf`, content: pdf, contentType: "application/pdf" }] });
}
export async function sendPayrollSummaryMail({ countryCode, to, period, count, pdf }) {
  const s = t(countryCode);
  return sendCountryEmail({ countryCode, sendTo: to, subject: s.summary(period), html: wrapEmailTemplate(countryCode, `<p>${s.summaryBody(esc(period), count)}</p>`), attachments: [{ filename: `payroll-${period}.pdf`, content: pdf, contentType: "application/pdf" }] });
}
export async function sendLeaveDecisionMail({ countryCode, to, name, from, toDate, status, note }) {
  if (!to) return;
  const s = t(countryCode);
  try { await sendCountryEmail({ countryCode, sendTo: to, subject: s.leave(status), html: wrapEmailTemplate(countryCode, `<p>${s.leaveBody(esc(name), esc(from), esc(toDate), esc(status), esc(note))}</p>`) }); } catch (e) { console.error("[hr] leave mail failed:", e.message); }
}

const FORM_L = {
  en: { subject: "Staff information form", body: (c) => `Hello,<br/><br/>Please find attached the <strong>Staff Information Form</strong> from ${c}. Print it, complete it in block letters, sign it and return it to HR.` },
  fr: { subject: "Fiche de renseignements du personnel", body: (c) => `Bonjour,<br/><br/>Veuillez trouver ci-joint la <strong>fiche de renseignements du personnel</strong> de ${c}. Imprimez-la, remplissez-la en lettres capitales, signez-la et retournez-la aux RH.` },
  it: { subject: "Modulo dati del personale", body: (c) => `Ciao,<br/><br/>In allegato il <strong>modulo dati del personale</strong> di ${c}. Stampalo, compilalo in stampatello, firmalo e restituiscilo alle HR.` },
};
export async function sendStaffFormMail({ countryCode, to, company, pdf }) {
  const s = FORM_L[lang(countryCode)];
  return sendCountryEmail({ countryCode, sendTo: to, subject: s.subject, html: wrapEmailTemplate(countryCode, `<p>${s.body(esc(company || "the company"))}</p>`), attachments: [{ filename: "staff-information-form.pdf", content: pdf, contentType: "application/pdf" }] });
}
