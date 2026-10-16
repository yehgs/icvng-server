// controllers/booking-request.controller.js
// PUBLIC endpoint for the banner landing pages (barista training / machine rental).
// Nothing is stored: the request is validated and emailed through Resend
// (via the existing sendCountryEmail) to the recipient array from env.
import { sendCountryEmail, wrapEmailTemplate } from "../config/emailService.js";

const SERVICES = {
  training: { subject: "New Barista Training Registration", envKey: "BOOKING_RECIPIENTS_TRAINING" },
  rental: { subject: "New Coffee Machine Rental Request", envKey: "BOOKING_RECIPIENTS_RENTAL" },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d][\d\s().-]{5,24}$/;
const CONTACT_MODES = ["Phone call", "WhatsApp", "Email"];
const TIME_SLOTS = ["Morning", "Afternoon"];

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const clean = (v, max = 200) => String(v ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);

// Env: BOOKING_RECIPIENTS_TRAINING / _RENTAL, else BOOKING_RECIPIENTS (comma-separated)
function recipientsFor(service) {
  const raw = process.env[SERVICES[service].envKey] || process.env.BOOKING_RECIPIENTS || "";
  return [...new Set(raw.split(",").map((e) => e.trim()).filter((e) => EMAIL_RE.test(e)))];
}

export async function submitBookingRequestController(req, res) {
  try {
    const b = req.body || {};

    // Honeypot: pretend success so bots learn nothing
    if (b.honeypot) return res.json({ success: true, message: "Request received" });

    const service = clean(b.service, 20);
    if (!SERVICES[service]) {
      return res.status(400).json({ success: false, error: true, message: "Unknown service" });
    }

    const name = clean(b.name, 100);
    const email = clean(b.email, 150).toLowerCase();
    const phone = clean(b.phone, 30);
    const whatsapp = clean(b.whatsapp || b.phone, 30);
    const contactMode = clean(b.contactMode, 20);
    const timeSlot = clean(b.timeSlot, 20);
    const date = clean(b.date, 10);

    const errors = [];
    if (name.length < 2) errors.push("Name is required");
    if (!EMAIL_RE.test(email)) errors.push("A valid email is required");
    if (!PHONE_RE.test(phone)) errors.push("A valid phone number is required");
    if (!PHONE_RE.test(whatsapp)) errors.push("A valid WhatsApp number is required");
    if (!CONTACT_MODES.includes(contactMode)) errors.push("Choose how we should reach you");
    if (!TIME_SLOTS.includes(timeSlot)) errors.push("Choose morning or afternoon");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) errors.push("Choose a valid date");
    else if (Date.parse(date) < Date.now() - 24 * 3600 * 1000) errors.push("Date cannot be in the past");
    if (errors.length) {
      return res.status(400).json({ success: false, error: true, message: errors[0], errors });
    }

    // Service-specific answers: [{label, value}] — capped and escaped
    const extras = (Array.isArray(b.extras) ? b.extras : [])
      .slice(0, 20)
      .map((x) => ({ label: clean(x?.label, 60), value: clean(x?.value, 1000) }))
      .filter((x) => x.label && x.value);

    const to = recipientsFor(service);
    if (!to.length) {
      console.error(`[booking] No recipients configured for "${service}" (set BOOKING_RECIPIENTS)`);
      return res.status(503).json({ success: false, error: true, message: "Booking is temporarily unavailable. Please call us." });
    }

    const rows = [
      ["Name", name],
      ["Email", email],
      ["Phone", phone],
      ["WhatsApp", whatsapp],
      ["Preferred contact mode", contactMode],
      ["Preferred date", date],
      ["Time of day", timeSlot],
      ...extras.map((x) => [x.label, x.value]),
      ["Submitted", new Date().toISOString()],
    ];

    const table = rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#6D4C41;font-weight:bold;white-space:nowrap;vertical-align:top;">${esc(k)}</td>` +
          `<td style="padding:8px 12px;border-bottom:1px solid #eee;color:#333;">${esc(v)}</td></tr>`,
      )
      .join("");

    const body =
      `<h2 style="color:#4B2E2B;margin:0 0 12px;">${esc(SERVICES[service].subject)}</h2>` +
      `<p style="color:#444;">A new request was submitted by <strong>${esc(name)}</strong>.</p>` +
      `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">${table}</table>` +
      `<p style="margin-top:20px;"><a href="mailto:${esc(email)}" style="background:#9B2226;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:bold;">Reply to ${esc(name)}</a></p>`;

    const countryCode = req.countryCode || "NG";
    await sendCountryEmail({
      countryCode,
      sendTo: to, // array -> Resend delivers to all recipients
      subject: `${SERVICES[service].subject} - ${name}`,
      html: wrapEmailTemplate(countryCode, body),
      replyTo: email,
    });

    return res.json({ success: true, message: "Request received" });
  } catch (error) {
    console.error("[booking] send failed:", error.message);
    return res.status(500).json({ success: false, error: true, message: "We couldn't send your request. Please try again or call us." });
  }
}
