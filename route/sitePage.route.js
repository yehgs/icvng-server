// server/route/sitePage.route.js
import { Router } from "express";
import auth from "../middleware/auth.js";
import { countryScope } from "../middleware/countryScope.js";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  getPublicSitePage,
  getSitePagesSummary,
  getAdminSitePage,
  upsertSitePage,
  deleteSitePageOverride,
  triggerSitePageTranslation,
  getSitePageTranslations,
  updateSitePageTranslation,
} from "../controllers/sitePage.controller.js";

const sitePageRouter = Router();

// ── Public — storefront reads (country + language resolved automatically) ──
sitePageRouter.get("/public/:slug", getPublicSitePage);

// ── Admin — content.manage covers editors managing marketing/site copy;
// countryScope keeps a country-assigned editor confined to their own market
// (enforced again inside the controller for defence in depth). ─────────────
sitePageRouter.get(
  "/admin/summary",
  auth,
  countryScope,
  requirePermission("content.view"),
  getSitePagesSummary
);
sitePageRouter.get(
  "/admin/:slug/:countryCode",
  auth,
  countryScope,
  requirePermission("content.view"),
  getAdminSitePage
);
sitePageRouter.put(
  "/admin/:slug/:countryCode",
  auth,
  countryScope,
  requirePermission("content.manage"),
  upsertSitePage
);
sitePageRouter.delete(
  "/admin/:slug/:countryCode",
  auth,
  countryScope,
  requirePermission("content.manage"),
  deleteSitePageOverride
);

// ── Translation (foreign-market editors translating HQ or their own copy) ──
sitePageRouter.post(
  "/admin/:slug/:countryCode/translate",
  auth,
  countryScope,
  requirePermission("translations.manage"),
  triggerSitePageTranslation
);
sitePageRouter.get(
  "/admin/:slug/:countryCode/translations",
  auth,
  countryScope,
  requirePermission("translations.view"),
  getSitePageTranslations
);
sitePageRouter.put(
  "/admin/:slug/:countryCode/translations/:language",
  auth,
  countryScope,
  requirePermission("translations.manage"),
  updateSitePageTranslation
);

export default sitePageRouter;
