// controllers/bankTransferSettings.controller.js
import BankTransferSettingsModel from "../models/bankTransferSettings.model.js";
import { ALL_COUNTRY_CODES, getCountryByCode } from "../config/countries/index.js";

// ── HQ (IT/DIRECTOR) management ─────────────────────────────────────────

/**
 * GET all countries' bank transfer settings, plus which countries have
 * none configured yet — so the settings UI can show every country
 * (configured or not) in one list.
 */
export const getAllBankTransferSettings = async (request, response) => {
  try {
    const settings = await BankTransferSettingsModel.find({}).populate(
      "updatedBy",
      "name email",
    );
    const byCountry = new Map(settings.map((s) => [s.countryCode, s]));

    const rows = ALL_COUNTRY_CODES.map((code) => {
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
 * Add/edit/update the bank transfer settings for ONE country — IT/DIRECTOR
 * only (see route). Upsert: creating for a country with no existing
 * document, or updating one that already exists, are the same call.
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
 */
export const deleteBankTransferSettings = async (request, response) => {
  try {
    const { countryCode } = request.params;
    const deleted = await BankTransferSettingsModel.findOneAndDelete({
      countryCode: (countryCode || "").toUpperCase(),
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
