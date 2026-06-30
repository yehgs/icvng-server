/**
 * route/country.route.js
 */
import express from "express";
import {
  getCountryConfig,
  getAllCountries,
  detectUserCountry,
} from "../controllers/countryConfig.controller.js";

const countryRouter = express.Router();

// GET /api/country/config  — active country config (currency, payment, language…)
countryRouter.get("/config", getCountryConfig);

// GET /api/country/all  — all available countries for switcher UI
countryRouter.get("/all", getAllCountries);

// GET /api/country/detect  — what country does this request look like it's from?
countryRouter.get("/detect", detectUserCountry);

export default countryRouter;
