// controllers/bankTransferSettings.controller.js
import BankTransferSettingsModel from "../models/bankTransferSettings.model.js";
import { ALL_COUNTRY_CODES, getCountryByCode } from "../config/countries/index.js";
import { buildCountryFilter } from "../middleware/countryScope.js";

// ── Admin management (IT/DIRECTOR any country, country-scoped MANAGER own country only) ──
//
// FIX: this used to be truly HQ-only (see route/bankTransferSettings.route.js's
// old blockCountryScopedAdmins) — none of the three functions below did any
// scoping at all because nothing but a GLOBAL admin could ever reach them.
// Now that a country-scoped MANAGER can too (payments.manageCountry — same
// permission controllers/paymentGateway.controller.js uses for CinetPay,
// since a country's receiving bank account is the same category of
// "payment settings a MANAGER should self-serve" the user asked for
// alongside CinetPay), each function scopes explicitly, mirroring
// paymentGateway.controller.js's pattern exactly.

/**
 * GET all countries' bank transfer settings, plus which countries have
 * none configured yet — so the settings UI can show every country
 * (configured or not) in one list. Country-scoped automatically:
 * buildCountryFilter(request) returns {} for a GLOBAL admin (sees every
 * country) and { countryCode: request.countryScope } for a COUNTRY-scoped
 * MANAGER, so a Togo manager's list only ever contains Togo's row.
 */
export const getAllBankTransferSettings = async (request, response) => {
  try {
    const settings = await BankTransferSettingsModel.find(buildCountryFilter(request)).populate(
      "updatedBy",
      "name email",
    );
    const byCountry = new Map(settings.map((s) => [s.countryCode, s]));

    // A country-scoped admin only ever sees their own country in this list
    // (the query above already restricted it), so the "every country"
    // scaffold only applies to GLOBAL admins — same as
    // paymentGateway.controller.js#listCinetPaySettings.
    const codes = request.countryScope ? [request.countryScope] : ALL_COUNTRY_CODES;

    const rows = codes.map((code) => {
      const country = getCountryByCode(code);
      const existing = byCountry.get(code);
      return {
        countryCode: code,
        countryName: country?.name || code,
        currencyCode: country?.currency?.code || null,
        configured: !!existing,
        setting: existing || null,
      };
    });

    return response.json({
      message: "Bank transfer settings retrieved successfully",
      data: rows,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || "Failed to fetch bank transfer settings",
      error: true,
      success: false,
    });
  }
};

/**
 * Add/edit/update the bank transfer settings for ONE country. Upsert:
 * creating for a country with no existing document, or updating one that
 * already exists, are the same call. Route-level
 * assertCountryAccess("body.countryCode") already rejects a MANAGER trying
 * to write another country's row before this ever runs; the explicit check
 * below is a second, defense-in-depth layer directly on the request, same
 * belt-and-suspenders approach as paymentGateway.controller.js's upsert.
 */
export const upsertBankTransferSettings = async (request, response) => {
  try {
    const userId = request.user._id;
    const {
      countryCode,
      isActive,
      bankName,
      accountName,
      accountNumber,
      sortCode,
      currencyCode,
      instructions,
    } = request.body;

    const code = (countryCode || "").toUpperCase();
    if (!ALL_COUNTRY_CODES.includes(code)) {
      return response.status(400).json({
        message: `Invalid countryCode: ${countryCode}`,
        error: true,
        success: false,
      });
    }

    if (request.countryScope && request.countryScope !== code) {
      return response.status(403).json({
        message: `Access denied: you can only manage ${request.countryScope}'s bank transfer settings`,
        error: true,
        success: false,
      });
    }

    if (!bankName?.trim() || !accountName?.trim() || !accountNumber?.trim()) {
      return response.status(400).json({
        message: "Bank name, account name, and account number are required",
        error: true,
        success: false,
      });
    }

    const country = getCountryByCode(code);
    const resolvedCurrency = (currencyCode || country?.currency?.code || "").toUpperCase();
    if (!resolvedCurrency) {
      return response.status(400).json({
        message: "Currency code is required",
        error: true,
        success: false,
      });
    }

    const updated = await BankTransferSettingsModel.findOneAndUpdate(
      { countryCode: code },
      {
        $set: {
          countryCode: code,
          isActive: isActive !== undefined ? isActive : true,
          bankName: bankName.trim(),
          accountName: accountName.trim(),
          accountNumber: accountNumber.trim(),
          sortCode: sortCode?.trim() || "",
          currencyCode: resolvedCurrency,
          instructions: instructions?.trim() || "",
          updatedBy: userId,
        },
      },
      { upsert: true, new: true, runValidators: true },
    );

    return response.json({
      message: `Bank transfer settings saved for ${code}`,
      data: updated,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || "Failed to save bank transfer settings",
      error: true,
      success: false,
    });
  }
};

/**
 * Delete a country's bank transfer settings entirely (as opposed to
 * isActive: false, which is the usual/reversible way to disable it).
 * Scoped the same way as the upsert above.
 */
export const deleteBankTransferSettings = async (request, response) => {
  try {
    const code = (request.params.countryCode || "").toUpperCase();

    if (request.countryScope && request.countryScope !== code) {
      return response.status(403).json({
        message: `Access denied: you can only manage ${request.countryScope}'s bank transfer settings`,
        error: true,
        success: false,
      });
    }

    const deleted = await BankTransferSettingsModel.findOneAndDelete({
      countryCode: code,
    });

    if (!deleted) {
      return response.status(404).json({
        message: "No bank transfer settings found for this country",
        error: true,
        success: false,
      });
    }

    return response.json({
      message: `Bank transfer settings removed for ${deleted.countryCode}`,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || "Failed to delete bank transfer settings",
      error: true,
      success: false,
    });
  }
};

// ── Public / storefront ─────────────────────────────────────────────────

/**
 * Which payment methods are available for THIS request's country
 * (resolved by the global countryDetect middleware from the storefront
 * domain). Stripe is always available (every country's config has
 * payments.stripe: true — see config/countries/index.js). Bank Transfer
 * is available only if that country has an active
 * BankTransferSettingsModel row — "if the country bank transfer is not
 * set, payment option will only be Stripe by default".
 */
export const getAvailablePaymentMethods = async (request, response) => {
  try {
    const countryCode = request.countryCode;
    const country = request.country;

    const bankSetting = countryCode
      ? await BankTransferSettingsModel.findOne({ countryCode, isActive: true })
      : null;

    return response.json({
      message: "Available payment methods retrieved successfully",
      data: {
        countryCode,
        stripe: !!country?.payments?.stripe,
        paystack: !!country?.payments?.paystack,
        bankTransfer: !!bankSetting,
        // Public-safe subset only — no need to leak instructions text
        // structure here beyond what checkout actually displays.
        bankTransferDetails: bankSetting
          ? {
              bankName: bankSetting.bankName,
              accountName: bankSetting.accountName,
              accountNumber: bankSetting.accountNumber,
              sortCode: bankSetting.sortCode,
              currencyCode: bankSetting.currencyCode,
              instructions: bankSetting.instructions,
            }
          : null,
      },
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || "Failed to fetch available payment methods",
      error: true,
      success: false,
    });
  }
};
