// route/bankTransferSettings.route.js
//
// Direct Bank Transfer settings — country-scoped receiving-account details,
// managed exclusively by HQ IT/DIRECTOR (settings.manage/view, which those
// two subRoles hold via the WILDCARD permission — see config/roles.js).
// `GET /available` stays PUBLIC — the storefront checkout page depends on
// it to decide whether to show a Bank Transfer option at all.

import { Router } from "express";
import auth from "../middleware/auth.js";
import adminAuth from "../middleware/adminAuth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { countryScope, blockCountryScopedAdmins } from "../middleware/countryScope.js";
import {
  getAllBankTransferSettings,
  upsertBankTransferSettings,
  deleteBankTransferSettings,
  getAvailablePaymentMethods,
} from "../controllers/bankTransferSettings.controller.js";

const bankTransferSettingsRouter = Router();

// PUBLIC — storefront checkout availability check
bankTransferSettingsRouter.get("/available", getAvailablePaymentMethods);

// Everything below is HQ (IT/DIRECTOR) territory — a country-scoped
// Logistics/Manager/etc admin never sees or edits another country's (or
// even their own country's) receiving bank account; this is deliberately
// centrally managed, same as exchange rates.
bankTransferSettingsRouter.use(
  auth,
  adminAuth,
  countryScope,
  blockCountryScopedAdmins,
  requirePermission(["settings.view", "settings.manage"]),
);

bankTransferSettingsRouter.get("/", getAllBankTransferSettings);
bankTransferSettingsRouter.post("/", upsertBankTransferSettings);
bankTransferSettingsRouter.delete("/:countryCode", deleteBankTransferSettings);

export default bankTransferSettingsRouter;
