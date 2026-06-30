/**
 * config/emailService.js
 *
 * Country-aware email sender.
 * Replaces the old config/sendEmail.js for all new code.
 * The legacy sendEmail.js is kept intact so existing controllers
 * continue working without modification.
 *
 * Usage:
 *   import { sendCountryEmail } from '../config/emailService.js';
 *
 *   await sendCountryEmail({
 *     countryCode: req.countryCode,   // from countryDetect middleware
 *     sendTo: 'user@example.com',
 *     subject: 'Your Order',
 *     html: '<p>...</p>',
 *   });
 */

import nodemailer from "nodemailer";
import { getCountryByCode } from "./countries/index.js";

/**
 * Per-country sender identity.
 * Falls back to the shared Nigeria credentials when a country-specific
 * pair is not configured.
 */
function getSenderConfig(countryCode = "NG") {
  const country = getCountryByCode(countryCode) || getCountryByCode("NG");
  const code = country.code;

  // Look for country-specific overrides first, e.g. EMAIL_USER_IT, EMAIL_USER_TG
  const user =
    process.env[`EMAIL_USER_${code}`] || process.env.EMAIL_USER || "";
  const pass =
    process.env[`EMAIL_APP_PASSWORD_${code}`] ||
    process.env.EMAIL_APP_PASSWORD ||
    "";
  const fromName =
    process.env[`EMAIL_FROM_NAME_${code}`] ||
    `I-Coffee ${country.name}`;

  return { user, pass, fromName, country };
}

// Cache transporters per country code to avoid recreating them on every send
const _transporters = {};

function getTransporter(countryCode = "NG") {
  if (_transporters[countryCode]) return _transporters[countryCode];

  const { user, pass } = getSenderConfig(countryCode);

  if (!user || !pass) {
    console.warn(
      `[emailService] No credentials for country ${countryCode}. Falling back to NG.`
    );
    return getTransporter("NG");
  }

  const t = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });

  _transporters[countryCode] = t;
  return t;
}

/**
 * Send an email scoped to a country.
 *
 * @param {{
 *   countryCode: string,
 *   sendTo: string | string[],
 *   subject: string,
 *   html: string,
 *   replyTo?: string,
 * }} options
 */
export async function sendCountryEmail({
  countryCode = "NG",
  sendTo,
  subject,
  html,
  replyTo,
}) {
  const { user, fromName } = getSenderConfig(countryCode);
  const transporter = getTransporter(countryCode);

  const info = await transporter.sendMail({
    from: `"${fromName}" <${user}>`,
    to: Array.isArray(sendTo) ? sendTo.join(", ") : sendTo,
    subject,
    html,
    ...(replyTo ? { replyTo } : {}),
  });

  console.log(
    `[emailService][${countryCode}] Sent to ${sendTo}: ${info.messageId}`
  );
  return info;
}

/**
 * Wrap an HTML body in a country-branded email shell.
 *
 * @param {string} countryCode
 * @param {string} bodyHtml   Inner content (paragraphs, tables, etc.)
 * @returns {string}  Full HTML email
 */
export function wrapEmailTemplate(countryCode = "NG", bodyHtml = "") {
  const country = getCountryByCode(countryCode) || getCountryByCode("NG");
  const domain = `https://${country.domain}`;
  const siteName = country.seo.siteName;

  return `<!DOCTYPE html>
<html lang="${country.language.default}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${siteName}</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #8B4513, #D2691E); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border: 1px solid #ddd; }
    .footer { background: #333; color: white; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; font-size: 12px; }
    .button { display: inline-block; background: #8B4513; color: white !important; padding: 12px 25px; text-decoration: none; border-radius: 5px; margin: 15px 0; }
  </style>
</head>
<body>
  <div class="header">
    <h1>☕ ${siteName}</h1>
  </div>
  <div class="content">
    ${bodyHtml}
  </div>
  <div class="footer">
    <p>© ${new Date().getFullYear()} ${siteName} — <a href="${domain}" style="color:#ccc;">${domain}</a></p>
    <p>${country.flagEmoji} ${country.name}</p>
  </div>
</body>
</html>`;
}
