// route/emailProviderSettings.route.js
//
// System-wide email provider configuration (Resend / SMTP).
//
// EVERY route here is HQ-only. Two guards, deliberately both:
//   requirePermission(["settings.manage"]) — only IT/DIRECTOR hold this, via
//     the WILDCARD permission in config/roles.js
//   blockCountryScopedAdmins            — belt-and-braces: even if a
//     permission were mis-granted, a country-scoped admin still cannot reach
//     these handlers
//
// This is intentionally stricter than bankTransferSettings, which exposes a
// PUBLIC /available route for checkout. There is no public surface here:
// nothing on the storefront needs to know which provider carries the mail,
// and exposing it would leak infrastructure detail for no benefit.

import { Router } from "express";
import auth from "../middleware/auth.js";
import adminAuth from "../middleware/adminAuth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { blockCountryScopedAdmins } from "../middleware/countryScope.js";
import {
  getEmailProviderSettings,
  updateEmailProviderSettings,
  testEmailProvider,
} from "../controllers/emailProviderSettings.controller.js";

const emailProviderSettingsRouter = Router();

emailProviderSettingsRouter.use(auth, adminAuth);

// Read current configuration (secrets masked — see the controller).
emailProviderSettingsRouter.get(
  "/",
  requirePermission(["settings.manage"]),
  blockCountryScopedAdmins,
  getEmailProviderSettings,
);

// Switch provider / edit sender identities.
emailProviderSettingsRouter.put(
  "/",
  requirePermission(["settings.manage"]),
  blockCountryScopedAdmins,
  updateEmailProviderSettings,
);

// Send a real test email through a named provider, so a configuration can be
// verified BEFORE the whole system is switched onto it.
emailProviderSettingsRouter.post(
  "/test",
  requirePermission(["settings.manage"]),
  blockCountryScopedAdmins,
  testEmailProvider,
);

export default emailProviderSettingsRouter;
