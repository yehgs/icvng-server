// controllers/paymentGateway.controller.js
//
// Admin management of indigenous payment gateway settings (CinetPay first).
// Mirrors controllers/bankTransferSettings.controller.js's shape, with one
// deliberate difference: bank transfer settings are HQ-only
// (blockCountryScopedAdmins in the route); THIS module is the first to let
// a country-scoped MANAGER manage their own row — see route/paymentGateway.route.js
// for how countryScope + assertCountryAccess enforce "own country only"
// instead of blocking country-scoped admins outright.
//
// Credentials are encrypted before they ever touch Mongo (see
// models/paymentGateway.model.js#encryptCredentials / utils/encryption.js)
// and are NEVER sent back to the browser in plaintext — list/get endpoints
// return only a `hasCredentials` boolean plus which fields are set, never
// the values themselves. A country manager editing an existing row re-enters
// the key if they want to change it; leaving the field blank keeps the
// existing (encrypted) value.

import PaymentGatewayModel, { encryptCredentials } from "../models/paymentGateway.model.js";
import { ALL_COUNTRY_CODES, getCountryByCode } from "../config/countries/index.js";
import { buildCountryFilter } from "../middleware/countryScope.js";
import { invalidateCinetPayCache, isCinetPayEnvConfigured } from "../config/paymentRouter.js";

// Redact a document for the browser — same country/provider/isActive/mode
// info, but credentials collapse to booleans.
function toSafeJSON(doc) {
  const obj = doc.toObject ? doc.toObject() : doc;
  return {
    _id: obj._id,
    countryCode: obj.countryCode,
    provider: obj.provider,
    isActive: obj.isActive,
    isDefault: obj.isDefault,
    mode: obj.mode,
    hasApiKey: Boolean(obj.credentials?.apiKey),
    hasSiteId: Boolean(obj.credentials?.siteId),
    updatedBy: obj.updatedBy,
    updatedAt: obj.updatedAt,
    createdAt: obj.createdAt,
  };
}

/**
 * GET /api/payment-gateway/cinetpay
 *
 * All countries' CinetPay rows, plus which countries have none configured
 * yet — same "every country in one list" shape as
 * bankTransferSettings.controller.js#getAllBankTransferSettings.
 *
 * Country-scoped automatically: buildCountryFilter(req) returns {} for a
 * GLOBAL admin (IT/DIRECTOR — sees every country) and
 * { countryCode: req.countryScope } for a COUNTRY-scoped MANAGER, so a
 * Togo manager's list only ever contains Togo's row.
 */
export const listCinetPaySettings = async (request, response) => {
  try {
    const filter = { ...buildCountryFilter(request), provider: "cinetpay" };
    const rows = await PaymentGatewayModel.find(filter).populate("updatedBy", "name email");
    const byCountry = new Map(rows.map((r) => [r.countryCode, r]));

    // A country-scoped admin only ever sees their own country in this list
    // (buildCountryFilter already restricted the query above), so the
    // "every country" scaffold only applies to GLOBAL admins.
    const codes = request.countryScope ? [request.countryScope] : ALL_COUNTRY_CODES;

    const rowsOut = codes.map((code) => {
      const country = getCountryByCode(code);
      const existing = byCountry.get(code);
      return {
        countryCode: code,
        countryName: country?.name || code,
        currencyCode: country?.currency?.code || null,
        configured: !!existing,
        setting: existing ? toSafeJSON(existing) : null,
        // True when this country has no DB row (or an inactive one) but
        // CINETPAY_API_KEY_<CC>/CINETPAY_SITE_ID_<CC> env vars are set —
        // checkout already treats that as active (see
        // config/paymentRouter.js#getCinetPayConfig). Surfaced so the
        // admin page doesn't show "Not set — Stripe only" for a country
        // where CinetPay is actually live via env vars, and so it's clear
        // that adding a row here will TAKE OVER from the env vars (DB
        // always wins), not stack with them.
        activeViaEnv: (!existing || !existing.isActive) && isCinetPayEnvConfigured(code),
      };
    });

    return response.json({
      message: "CinetPay settings retrieved successfully",
      data: rowsOut,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || "Failed to fetch CinetPay settings",
      error: true,
      success: false,
    });
  }
};

/**
 * POST /api/payment-gateway/cinetpay
 *
 * Add/edit CinetPay settings for ONE country. Upsert, same as bank
 * transfer settings. Route-level assertCountryAccess("body.countryCode")
 * already rejects a MANAGER trying to write another country's row before
 * this ever runs; buildCountryFilter is applied again here as a second,
 * defense-in-depth layer directly on the query itself.
 */
export const upsertCinetPaySettings = async (request, response) => {
  try {
    const userId = request.user._id;
    const { countryCode, isActive, isDefault, mode, apiKey, siteId } = request.body;

    const code = (countryCode || "").toUpperCase();
    if (!ALL_COUNTRY_CODES.includes(code)) {
      return response.status(400).json({
        message: `Invalid countryCode: ${countryCode}`,
        error: true,
        success: false,
      });
    }

    // Belt-and-suspenders: route/paymentGateway.route.js's
    // assertCountryAccess("body.countryCode") already rejects this before
    // the controller runs, but building the filter by MERGING the scope
    // filter with an explicit countryCode (rather than letting the
    // explicit one silently win) means this check holds even if the route
    // guard is ever removed/reordered by mistake.
    if (request.countryScope && request.countryScope !== code) {
      return response.status(403).json({
        message: `Access denied: you can only manage ${request.countryScope}'s payment gateway`,
        error: true,
        success: false,
      });
    }

    const filter = { countryCode: code, provider: "cinetpay" };

    const existing = await PaymentGatewayModel.findOne(filter);

    // apiKey/siteId are only required on FIRST creation — an edit that
    // only flips isActive/mode shouldn't force re-entering both secrets.
    if (!existing && (!apiKey?.trim() || !siteId?.trim())) {
      return response.status(400).json({
        message: "apiKey and siteId are required when configuring CinetPay for the first time",
        error: true,
        success: false,
      });
    }

    const credentialUpdate = {};
    if (apiKey?.trim() || siteId?.trim()) {
      const encrypted = encryptCredentials({
        apiKey: apiKey?.trim() || undefined,
        siteId: siteId?.trim() || undefined,
      });
      // Only overwrite the fields actually resubmitted — leaving one
      // blank (e.g. rotating just the apikey) keeps the other encrypted
      // value untouched rather than wiping it.
      if (apiKey?.trim()) credentialUpdate["credentials.apiKey"] = encrypted.apiKey;
      if (siteId?.trim()) credentialUpdate["credentials.siteId"] = encrypted.siteId;
    }

    const updated = await PaymentGatewayModel.findOneAndUpdate(
      filter,
      {
        $set: {
          countryCode: code,
          provider: "cinetpay",
          isActive: isActive !== undefined ? isActive : true,
          isDefault: isDefault !== undefined ? isDefault : true,
          mode: mode === "TEST" ? "TEST" : "PRODUCTION",
          updatedBy: userId,
          ...credentialUpdate,
        },
      },
      { upsert: true, new: true, runValidators: true },
    );

    // See config/paymentRouter.js's own comment on why getCinetPayConfig is
    // cached — without this, a country manager saving new keys would see
    // checkout keep using the old (or absent) config for up to a minute.
    invalidateCinetPayCache(code);

    return response.json({
      message: `CinetPay settings saved for ${code}`,
      data: toSafeJSON(updated),
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || "Failed to save CinetPay settings",
      error: true,
      success: false,
    });
  }
};

/**
 * DELETE /api/payment-gateway/cinetpay/:countryCode
 *
 * Remove a country's CinetPay row entirely (as opposed to isActive: false,
 * the usual reversible way to disable it). Scoped the same way as the
 * upsert above.
 */
export const deleteCinetPaySettings = async (request, response) => {
  try {
    const code = (request.params.countryCode || "").toUpperCase();

    // Same explicit scope check as the upsert above — see its comment.
    if (request.countryScope && request.countryScope !== code) {
      return response.status(403).json({
        message: `Access denied: you can only manage ${request.countryScope}'s payment gateway`,
        error: true,
        success: false,
      });
    }

    const deleted = await PaymentGatewayModel.findOneAndDelete({
      countryCode: code,
      provider: "cinetpay",
    });

    if (!deleted) {
      return response.status(404).json({
        message: "No CinetPay settings found for this country",
        error: true,
        success: false,
      });
    }

    invalidateCinetPayCache(code);

    return response.json({
      message: `CinetPay settings removed for ${deleted.countryCode}`,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || "Failed to remove CinetPay settings",
      error: true,
      success: false,
    });
  }
};
