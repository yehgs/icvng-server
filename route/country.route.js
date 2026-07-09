/**
 * route/country.route.js
 */
import express from "express";
import {
  getCountryConfig,
  getAllCountries,
  detectUserCountry,
} from "../controllers/countryConfig.controller.js";
import {
  listCountriesAdmin,
  getCountryAdmin,
  createCountry,
  updateCountry,
  setCountryStatus,
  getSupportedLanguages,
} from "../controllers/countryManagement.controller.js";
import { guard } from "../core/guard.js";

const countryRouter = express.Router();

// ── Public (storefront) ──────────────────────────────────────────────────────
// GET /api/country/config  — active country config (currency, payment, language…)
countryRouter.get("/config", getCountryConfig);
// GET /api/country/all  — all available countries for switcher UI
countryRouter.get("/all", getAllCountries);
// GET /api/country/detect  — what country does this request look like it's from?
countryRouter.get("/detect", detectUserCountry);

// ── Admin (HQ only — countries.view / countries.manage) ──────────────────────
// PHASE 6: onboarding a country is now configuration, not a deploy.
const viewG = () => guard({ permissions: "countries.view", hqOnly: true });
const manageG = () => guard({ permissions: "countries.manage", hqOnly: true });

countryRouter.get("/admin", ...viewG(), listCountriesAdmin);
countryRouter.get("/admin/meta/languages", ...viewG(), getSupportedLanguages);
countryRouter.get("/admin/:code", ...viewG(), getCountryAdmin);
countryRouter.post("/admin", ...manageG(), createCountry);
countryRouter.put("/admin/:code", ...manageG(), updateCountry);
countryRouter.patch("/admin/:code/status", ...manageG(), setCountryStatus);

export default countryRouter;
