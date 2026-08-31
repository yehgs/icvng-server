/**
 * controllers/emailProviderSettings.controller.js
 *
 * System-wide email provider configuration. Route-guarded to
 * requirePermission(["settings.manage"]) + blockCountryScopedAdmins, so only
 * HQ IT/DIRECTOR reach these handlers — a country MANAGER must not be able
 * to repoint the whole system's mail, in any market.
 *
 * SECRET HANDLING
 * ───────────────
 * API keys are `select: false` on the schema and are NEVER returned to the
 * client. The GET handler returns a masked hint ("re_••••4f2a") purely so an
 * admin can tell whether a key is set and roughly which one, without the
 * value ever crossing the wire. An empty string on save means "leave the
 * stored key alone", so re-saving the form after an unrelated edit cannot
 * silently wipe the key — a very easy way to take all email down.
 */

import EmailProviderSettingsModel, {
  EMAIL_PROVIDERS,
} from "../models/emailProviderSettings.model.js";
import {
  sendCountryEmail,
  invalidateEmailSettingsCache,
} from "../config/emailService.js";
import { ALL_COUNTRY_CODES, getCountryByCode } from "../config/countries/index.js";
import { logActivity } from "../utils/activityLogger.js";

/** "re_1234abcd5678ef2a" → "re_••••ef2a". Never reveals the usable part. */
function maskKey(key) {
  if (!key) return null;
  const tail = key.slice(-4);
  const prefix = key.slice(0, 3);
  return `${prefix}••••${tail}`;
}

/**
 * GET /api/email-settings
 * Returns the singleton with secrets masked, plus the country list so the
 * UI can render a row per market without a second call.
 */
export const getEmailProviderSettings = async (request, response) => {
  try {
    const doc = await EmailProviderSettingsModel.getSettings({
      withSecrets: true,
    });

    const countries = ALL_COUNTRY_CODES.map((code) => {
      const meta = getCountryByCode(code);
      const entry = (doc.countries || []).find((c) => c.countryCode === code);
      return {
        countryCode: code,
        name: meta?.name || code,
        domain: meta?.domain || "",
        flagEmoji: meta?.flagEmoji || "🌍",
        language: meta?.language?.default || "en",
        fromEmail: entry?.fromEmail || "",
        fromName: entry?.fromName || "",
        replyTo: entry?.replyTo || "",
        isActive: entry?.isActive !== false,
        hasCountryApiKey: Boolean(entry?.resendApiKey),
      };
    });

    return response.json({
      message: "Email provider settings retrieved",
      error: false,
      success: true,
      data: {
        activeProvider: doc.activeProvider,
        availableProviders: EMAIL_PROVIDERS,
        sendingEnabled: doc.sendingEnabled,
        resend: {
          hasApiKey: Boolean(doc.resend?.apiKey || process.env.RESEND_API_KEY),
          // Distinguishes "set in the DB by an admin" from "set in env by
          // whoever deploys" — different people fix those two problems.
          apiKeySource: doc.resend?.apiKey
            ? "database"
            : process.env.RESEND_API_KEY
              ? "environment"
              : "none",
          apiKeyHint: maskKey(doc.resend?.apiKey || process.env.RESEND_API_KEY),
          defaultFromEmail: doc.resend?.defaultFromEmail || "",
          defaultFromName: doc.resend?.defaultFromName || "I-Coffee",
        },
        smtp: {
          service: doc.smtp?.service || "gmail",
          host: doc.smtp?.host || "",
          port: doc.smtp?.port || null,
          secure: doc.smtp?.secure !== false,
        },
        countries,
        health: {
          lastVerifiedAt: doc.lastVerifiedAt,
          lastVerifiedProvider: doc.lastVerifiedProvider,
          lastError: doc.lastError,
          lastErrorAt: doc.lastErrorAt,
        },
        updatedAt: doc.updatedAt,
      },
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || "Could not load email provider settings",
      error: true,
      success: false,
    });
  }
};

/**
 * PUT /api/email-settings
 * Partial update. Anything omitted is left untouched.
 */
export const updateEmailProviderSettings = async (request, response) => {
  try {
    const { activeProvider, sendingEnabled, resend, smtp, countries } =
      request.body;

    const doc = await EmailProviderSettingsModel.getSettings({
      withSecrets: true,
    });
    const previousProvider = doc.activeProvider;

    if (activeProvider !== undefined) {
      if (!EMAIL_PROVIDERS.includes(activeProvider)) {
        return response.status(400).json({
          message: `Unknown provider "${activeProvider}". Expected one of: ${EMAIL_PROVIDERS.join(", ")}`,
          error: true,
          success: false,
        });
      }
      doc.activeProvider = activeProvider;
    }

    if (sendingEnabled !== undefined) doc.sendingEnabled = Boolean(sendingEnabled);

    if (resend) {
      // Empty string means "keep the existing key". Only a non-empty value
      // replaces it — so re-saving the form never wipes the key by accident.
      if (resend.apiKey) doc.resend.apiKey = resend.apiKey.trim();
      if (resend.defaultFromEmail !== undefined) {
        doc.resend.defaultFromEmail = resend.defaultFromEmail.trim().toLowerCase();
      }
      if (resend.defaultFromName !== undefined) {
        doc.resend.defaultFromName = resend.defaultFromName.trim();
      }
    }

    if (smtp) {
      if (smtp.service !== undefined) doc.smtp.service = smtp.service.trim();
      if (smtp.host !== undefined) doc.smtp.host = smtp.host.trim();
      if (smtp.port !== undefined) doc.smtp.port = smtp.port ? Number(smtp.port) : undefined;
      if (smtp.secure !== undefined) doc.smtp.secure = Boolean(smtp.secure);
    }

    if (Array.isArray(countries)) {
      for (const incoming of countries) {
        const code = String(incoming.countryCode || "").toUpperCase();
        if (!ALL_COUNTRY_CODES.includes(code)) continue;

        let entry = doc.countries.find((c) => c.countryCode === code);
        if (!entry) {
          doc.countries.push({ countryCode: code });
          entry = doc.countries[doc.countries.length - 1];
        }
        if (incoming.fromEmail !== undefined) {
          entry.fromEmail = incoming.fromEmail.trim().toLowerCase();
        }
        if (incoming.fromName !== undefined) entry.fromName = incoming.fromName.trim();
        if (incoming.replyTo !== undefined) {
          entry.replyTo = incoming.replyTo.trim().toLowerCase();
        }
        if (incoming.isActive !== undefined) entry.isActive = Boolean(incoming.isActive);
        // Same keep-unless-non-empty rule as the global key.
        if (incoming.resendApiKey) entry.resendApiKey = incoming.resendApiKey.trim();
      }
    }

    doc.updatedBy = request.userId;
    await doc.save();

    // The send layer caches settings for a minute; drop it now so the change
    // is live immediately rather than "sometime in the next 60 seconds".
    invalidateEmailSettingsCache();

    logActivity({
      request,
      action: "UPDATE",
      entityType: "SETTINGS",
      entityId: doc._id,
      description:
        previousProvider !== doc.activeProvider
          ? `Email provider switched: ${previousProvider} → ${doc.activeProvider}`
          : "Email provider settings updated",
    });

    return response.json({
      message: "Email provider settings updated",
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || "Could not update email provider settings",
      error: true,
      success: false,
    });
  }
};

/**
 * POST /api/email-settings/test
 * Sends a real email through a chosen provider so an admin can verify a
 * configuration BEFORE switching the whole system onto it.
 *
 * `forceProvider` deliberately disables the automatic fallback — a test that
 * silently succeeded via the other provider would tell you nothing about the
 * one you are testing, which is the entire point of the button.
 */
export const testEmailProvider = async (request, response) => {
  try {
    const { sendTo, countryCode = "NG", provider } = request.body;

    if (!sendTo) {
      return response.status(400).json({
        message: "A recipient address is required",
        error: true,
        success: false,
      });
    }
    if (provider && !EMAIL_PROVIDERS.includes(provider)) {
      return response.status(400).json({
        message: `Unknown provider "${provider}"`,
        error: true,
        success: false,
      });
    }

    const country = getCountryByCode(countryCode) || getCountryByCode("NG");
    const started = Date.now();

    const result = await sendCountryEmail({
      countryCode: country.code,
      sendTo,
      subject: `Test email — ${country.name} (${provider || "active provider"})`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
          <h2 style="color:#8B4513">Email configuration test</h2>
          <p>This is a test message from the I-Coffee admin panel.</p>
          <table style="font-size:14px;border-collapse:collapse">
            <tr><td style="padding:4px 12px 4px 0;color:#6B7280">Provider</td><td><strong>${provider || "active"}</strong></td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#6B7280">Country</td><td>${country.flagEmoji} ${country.name} (${country.code})</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#6B7280">Domain</td><td>${country.domain}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#6B7280">Sent at</td><td>${new Date().toISOString()}</td></tr>
          </table>
          <p style="color:#6B7280;font-size:13px;margin-top:20px">
            If you received this, that provider can send mail for this country.
          </p>
        </div>`,
      forceProvider: provider,
    });

    // BUGFIX: when the global kill switch is off, sendCountryEmail returns
    // { suppressed: true } with no provider — and this used to report that
    // as "Test email sent via undefined", which reads as success. Nothing
    // was sent. Say so plainly and name the switch to un-tick.
    if (result?.suppressed) {
      return response.status(400).json({
        message:
          'Nothing was sent: "Email sending enabled" is currently off. Turn it on and save before testing.',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: `Test email sent via ${result.provider}`,
      error: false,
      success: true,
      data: {
        provider: result.provider,
        messageId: result.messageId,
        durationMs: Date.now() - started,
      },
    });
  } catch (error) {
    // A failed test is an expected outcome, not a server fault — return the
    // provider's own message so the admin can act on it (unverified domain,
    // bad key, etc.) rather than a generic 500.
    return response.status(400).json({
      message: error.message || "Test send failed",
      error: true,
      success: false,
    });
  }
};
