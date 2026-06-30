/**
 * route/dashboard.route.js
 */
import express from "express";
import auth from "../middleware/auth.js";
import adminAuth from "../middleware/adminAuth.js";
import { countryScope } from "../middleware/countryScope.js";
import { getDashboardSummary, getCountryComparison } from "../controllers/dashboard.controller.js";

const dashboardRouter = express.Router();

// countryScope runs on every dashboard request — auto-filters data
dashboardRouter.use(auth, adminAuth, countryScope);

// Single summary endpoint — works for all roles, data filtered by scope
dashboardRouter.get("/summary", getDashboardSummary);

// GLOBAL admins only — side-by-side country comparison
dashboardRouter.get("/countries", getCountryComparison);

export default dashboardRouter;
