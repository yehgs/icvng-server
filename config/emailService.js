/**
 * config/emailService.js
 *
 * Country-aware, PROVIDER-AGNOSTIC email sender.
 *
 * ── WHAT CHANGED (2026-08-28) ────────────────────────────────────────────
 * This used to hardcode `nodemailer.createTransport({ service: "gmail" })`.
 * The provider is now chosen at runtime from
 * models/emailProviderSettings.model.js, which only IT/DIRECTOR can edit.
 * Resend is the default; SMTP remains as a fallback.
 *
 * ── THE PUBLIC API IS UNCHANGED ──────────────────────────────────────────
 * `sendCountryEmail({ countryCode, sendTo, subject, html, replyTo })` keeps
 * the exact signature it always had, so every existing call site — order
 * confirmation, payment status, shipping notification, verification,
 * password reset — works with no edit. That is deliberate: a provider swap
 * requiring 30 call-site changes is a swap nobody dares perform.
 *
 * ── COUNTRY SCOPING ──────────────────────────────────────────────────────
 * The PROVIDER is system-wide; the SENDER IDENTITY is per-country. Callers
 * still pass the ORDER's countryCode and this layer resolves the right
 * from-address, from-name and reply-to for that market, whichever provider
 * carries the message. A Togo customer gets a Togo sender on Resend exactly
 * as they did on SMTP.
 *
 * ── FAILURE POSTURE ──────────────────────────────────────────────────────
 * An order email is what reassures a customer their money did something, so
 * losing one to a misconfiguration is worse than sending from a slightly
 * wrong address. If the active provider is unconfigured or throws, we fall
 * back to the other provider before giving up, and record the error on the
 * settings document so it surfaces in the admin health strip rather than
 * only in a log nobody reads.
 */

import nodemailer from "nodemailer";
import { getCountryByCode } from "./countries/index.js";
import EmailProviderSettingsModel from "../models/emailProviderSettings.model.js";

// ── Settings cache ──────────────────────────────────────────────────────────
// Re-reading settings on every send would add a DB round-trip to every
// email. Cached briefly; the settings controller calls
// invalidateEmailSettingsCache() on save so an IT/DIRECTOR change takes
// effect immediately rather than up to a minute later.
let _settingsCache = null;
let _settingsCachedAt = 0;
const SETTINGS_TTL_MS = 60_000;

export function invalidateEmailSettingsCache() {
  _settingsCache = null;
  _settingsCachedAt = 0;
}

async function loadSettings() {
  const now = Date.now();
  if (_settingsCache && now - _settingsCachedAt < SETTINGS_TTL_MS) {
    return _settingsCache;
  }
  try {
    _settingsCache = await EmailProviderSettingsModel.getSettings({
      withSecrets: true,
    });
    _settingsCachedAt = now;
  } catch (err) {
    // DB unreachable — fall back to env-only SMTP rather than failing the
    // send. This is the path that keeps password-reset email working during
    // a partial outage.
    console.warn(
      `[emailService] Could not load provider settings (${err.message}); using env SMTP.`,
    );
    return null;
  }
  return _settingsCache;
}

// ── Sender identity ─────────────────────────────────────────────────────────

function envSender(countryCode = "NG") {
  const country = getCountryByCode(countryCode) || getCountryByCode("NG");
  const code = country.code;
  return {
    fromEmail: process.env[`EMAIL_USER_${code}`] || process.env.EMAIL_USER || "",
    fromName:
      process.env[`EMAIL_FROM_NAME_${code}`] || `I-Coffee ${country.name}`,
  };
}

function resolveSender(settings, countryCode = "NG") {
  const country = getCountryByCode(countryCode) || getCountryByCode("NG");
  if (!settings) {
    return { ...envSender(country.code), replyTo: undefined, countryApiKey: undefined, country };
  }
  return { ...settings.senderFor(country.code, country), country };
}

// ── Resend transport ────────────────────────────────────────────────────────

function resendApiKey(settings, countryApiKey) {
  return (
    countryApiKey || settings?.resend?.apiKey || process.env.RESEND_API_KEY || ""
  );
}

/**
 * Send via Resend's HTTP API.
 *
 * Deliberately uses fetch rather than the `resend` npm package: it is one
 * POST, and this keeps the dependency surface — and the install step for
 * whoever deploys — at zero. Node 18+ ships fetch.
 */
async function sendViaResend({ apiKey, from, to, subject, html, replyTo }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Resend's most common rejection is an unverified sending domain, which
    // is not obvious from the raw message — name it explicitly.
    const hint =
      res.status === 403 || /domain/i.test(body?.message || "")
        ? " (is the sending domain verified in Resend?)"
        : "";
    throw new Error(
      `Resend ${res.status}: ${body?.message || res.statusText}${hint}`,
    );
  }
  return { messageId: body?.id, provider: "RESEND" };
}

// ── SMTP transport ──────────────────────────────────────────────────────────

const _transporters = {};

function getTransporter(settings, countryCode, fromEmail) {
  const cacheKey = `${countryCode}:${fromEmail}`;
  if (_transporters[cacheKey]) return _transporters[cacheKey];

  const code = (getCountryByCode(countryCode) || getCountryByCode("NG")).code;
  const user =
    fromEmail || process.env[`EMAIL_USER_${code}`] || process.env.EMAIL_USER;
  const pass =
    process.env[`EMAIL_APP_PASSWORD_${code}`] || process.env.EMAIL_APP_PASSWORD;

  if (!user || !pass) return null;

  const smtp = settings?.smtp || {};
  const t = smtp.host
    ? nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port || 587,
        secure: smtp.secure !== false,
        auth: { user, pass },
      })
    : nodemailer.createTransport({
        service: smtp.service || "gmail",
        auth: { user, pass },
      });

  _transporters[cacheKey] = t;
  return t;
}

async function sendViaSmtp({
  settings, countryCode, from, fromEmail, to, subject, html, replyTo,
}) {
  const transporter = getTransporter(settings, countryCode, fromEmail);
  if (!transporter) {
    throw new Error(`No SMTP credentials configured for ${countryCode}`);
  }
  const info = await transporter.sendMail({
    from,
    to: Array.isArray(to) ? to.join(", ") : to,
    subject,
    html,
    ...(replyTo ? { replyTo } : {}),
  });
  return { messageId: info.messageId, provider: "SMTP" };
}

// ── Health recording ────────────────────────────────────────────────────────

async function recordResult({ ok, provider, error }) {
  try {
    const patch = ok
      ? { lastVerifiedAt: new Date(), lastVerifiedProvider: provider, lastError: null }
      : { lastError: String(error).slice(0, 500), lastErrorAt: new Date() };
    await EmailProviderSettingsModel.updateOne({ key: "GLOBAL" }, { $set: patch });
  } catch {
    // Health telemetry must never break a send.
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Send an email scoped to a country. Signature unchanged.
 *
 * @param {{
 *   countryCode?: string,
 *   sendTo: string | string[],
 *   subject: string,
 *   html: string,
 *   replyTo?: string,
 *   forceProvider?: "RESEND" | "SMTP",   // test-send only
 * }} options
 */
export async function sendCountryEmail({
  countryCode = "NG",
  sendTo,
  subject,
  html,
  replyTo,
  forceProvider,
}) {
  const settings = await loadSettings();

  // Global kill switch — for restoring production data into staging, where
  // replaying real order emails to real customers would be harmful.
  if (settings && settings.sendingEnabled === false) {
    console.log(
      `[emailService][${countryCode}] SUPPRESSED (sending disabled): "${subject}" -> ${sendTo}`,
    );
    return { suppressed: true };
  }

  const sender = resolveSender(settings, countryCode);
  const from = sender.fromEmail
    ? `${sender.fromName} <${sender.fromEmail}>`
    : sender.fromName;
  const effectiveReplyTo = replyTo || sender.replyTo;

  const primary = forceProvider || settings?.activeProvider || "RESEND";
  const secondary = primary === "RESEND" ? "SMTP" : "RESEND";

  const attempt = async (provider) => {
    if (provider === "RESEND") {
      const apiKey = resendApiKey(settings, sender.countryApiKey);
      if (!apiKey) throw new Error("Resend selected but no API key configured");
      if (!sender.fromEmail) {
        throw new Error("Resend requires a verified from-address; none configured");
      }
      return sendViaResend({
        apiKey, from, to: sendTo, subject, html, replyTo: effectiveReplyTo,
      });
    }
    return sendViaSmtp({
      settings,
      countryCode: sender.country.code,
      from,
      fromEmail: sender.fromEmail,
      to: sendTo,
      subject,
      html,
      replyTo: effectiveReplyTo,
    });
  };

  try {
    const result = await attempt(primary);
    console.log(
      `[emailService][${sender.country.code}][${result.provider}] Sent to ${sendTo}: ${result.messageId}`,
    );
    recordResult({ ok: true, provider: result.provider });
    return result;
  } catch (primaryErr) {
    // A test send must report the truth about the provider being tested —
    // silently succeeding via the other one would make the test meaningless.
    if (forceProvider) throw primaryErr;

    console.warn(
      `[emailService][${sender.country.code}] ${primary} failed (${primaryErr.message}); trying ${secondary}.`,
    );
    try {
      const result = await attempt(secondary);
      console.log(
        `[emailService][${sender.country.code}][${result.provider}] Sent via fallback to ${sendTo}: ${result.messageId}`,
      );
      recordResult({ ok: true, provider: result.provider });
      return result;
    } catch (secondaryErr) {
      recordResult({
        ok: false,
        error: `${primary}: ${primaryErr.message} | ${secondary}: ${secondaryErr.message}`,
      });
      throw new Error(
        `Both providers failed. ${primary}: ${primaryErr.message}. ${secondary}: ${secondaryErr.message}`,
      );
    }
  }
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
