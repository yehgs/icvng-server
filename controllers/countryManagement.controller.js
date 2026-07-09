/**
 * controllers/countryManagement.controller.js
 *
 * PHASE 6 — admin CRUD for countries. This is what makes onboarding a new
 * market (e.g. Ghana) pure configuration: a DIRECTOR/IT creates a Country
 * document + maps its domain, and detection/currency/branding/email/payments
 * all activate with no code deploy.
 *
 * Gated on countries.view / countries.manage (HQ only).
 */

import CountryModel from "../models/country.model.js";
import {
  refreshCountryCache,
  invalidateCountryCache,
} from "../services/countryService.js";
import { ALL_SUPPORTED_LANGUAGES } from "../config/countries/index.js";

/** GET /api/country/admin — list all countries (admin view, full docs). */
export async function listCountriesAdmin(req, res) {
  try {
    const countries = await CountryModel.find({}).sort({ isHQ: -1, name: 1 }).lean();
    return res.json({ success: true, error: false, data: countries });
  } catch (err) {
    return res.status(500).json({ message: err.message, error: true, success: false });
  }
}

/** GET /api/country/admin/:code — one country's full config. */
export async function getCountryAdmin(req, res) {
  try {
    const country = await CountryModel.findOne({ code: req.params.code.toUpperCase() }).lean();
    if (!country) {
      return res.status(404).json({ message: "Country not found", error: true, success: false });
    }
    return res.json({ success: true, error: false, data: country });
  } catch (err) {
    return res.status(500).json({ message: err.message, error: true, success: false });
  }
}

/** POST /api/country/admin — create a new country. */
export async function createCountry(req, res) {
  try {
    const { code, name } = req.body;
    if (!code || !name) {
      return res.status(400).json({ message: "code and name are required", error: true, success: false });
    }
    const upperCode = code.toUpperCase();

    const existing = await CountryModel.findOne({ code: upperCode });
    if (existing) {
      return res.status(409).json({ message: `Country ${upperCode} already exists`, error: true, success: false });
    }

    // A new country is never HQ (only Nigeria is HQ; guard against accidental
    // second HQ).
    const payload = { ...req.body, code: upperCode, isHQ: false };
    // Default status to COMING_SOON so a half-configured country doesn't serve
    // a broken storefront until explicitly activated.
    if (!payload.status) payload.status = "COMING_SOON";

    const country = await CountryModel.create(payload);
    invalidateCountryCache();
    await refreshCountryCache();

    return res.status(201).json({ success: true, error: false, data: country });
  } catch (err) {
    return res.status(500).json({ message: err.message, error: true, success: false });
  }
}

/** PUT /api/country/admin/:code — update a country's config. */
export async function updateCountry(req, res) {
  try {
    const upperCode = req.params.code.toUpperCase();
    const country = await CountryModel.findOne({ code: upperCode });
    if (!country) {
      return res.status(404).json({ message: "Country not found", error: true, success: false });
    }

    // Protect immutable / dangerous fields.
    const { code, isHQ, _id, ...updatable } = req.body;
    // Never allow flipping HQ via this endpoint.
    Object.assign(country, updatable);
    await country.save();

    invalidateCountryCache();
    await refreshCountryCache();

    return res.json({ success: true, error: false, data: country });
  } catch (err) {
    return res.status(500).json({ message: err.message, error: true, success: false });
  }
}

/** PATCH /api/country/admin/:code/status — activate / deactivate. */
export async function setCountryStatus(req, res) {
  try {
    const { status } = req.body;
    if (!["ACTIVE", "INACTIVE", "COMING_SOON"].includes(status)) {
      return res.status(400).json({ message: "Invalid status", error: true, success: false });
    }
    const upperCode = req.params.code.toUpperCase();
    const country = await CountryModel.findOne({ code: upperCode });
    if (!country) {
      return res.status(404).json({ message: "Country not found", error: true, success: false });
    }
    // HQ can never be deactivated.
    if (country.isHQ && status !== "ACTIVE") {
      return res.status(400).json({ message: "Headquarters cannot be deactivated", error: true, success: false });
    }
    country.status = status;
    await country.save();
    invalidateCountryCache();
    await refreshCountryCache();
    return res.json({ success: true, error: false, data: country });
  } catch (err) {
    return res.status(500).json({ message: err.message, error: true, success: false });
  }
}

/** GET /api/country/admin/meta/languages — supported languages for the form. */
export async function getSupportedLanguages(req, res) {
  return res.json({ success: true, error: false, data: ALL_SUPPORTED_LANGUAGES });
}
