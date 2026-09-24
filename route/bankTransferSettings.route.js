// route/bankTransferSettings.route.js
//
// Direct Bank Transfer settings — country-scoped receiving-account details.
// `GET /available` stays PUBLIC — the storefront checkout page depends on
// it to decide whether to show a Bank Transfer option at all.
//
// FIX: this used to be genuinely HQ-only (blockCountryScopedAdmins +
// settings.manage/view, which only IT/DIRECTOR hold via WILDCARD). Per the
// explicit request, a country's own bank account details are the same
// category of "payment settings a MANAGER should self-serve" as CinetPay —
// IT/DIRECTOR manage every country's financial details (payment keys AND
// bank details); a country-scoped MANAGER manages only their own. So this
// now uses the SAME payments.view/payments.manageCountry permissions and
// countryScope + assertCountryAccess pattern as
// route/paymentGateway.route.js, instead of blockCountryScopedAdmins.

import { Router } from "express";
import auth from "../middleware/auth.js";
import adminAuth from "../middleware/adminAuth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { countryScope, assertCountryAccess } from "../middleware/countryScope.js";
import {
  getAllBankTransferSettings,
  upsertBankTransferSettings,
  deleteBankTransferSettings,
  getAvailablePaymentMethods,
} from "../controllers/bankTransferSettings.controller.js";

const bankTransferSettingsRouter = Router();

// PUBLIC — storefront checkout availability check
bankTransferSettingsRouter.get("/available", getAvailablePaymentMethods);

bankTransferSettingsRouter.use(auth, adminAuth, countryScope);

bankTransferSettingsRouter.get(
  "/",
  requirePermission(["payments.view", "payments.manageCountry"]),
  getAllBankTransferSettings,
);

bankTransferSettingsRouter.post(
  "/",
  requirePermission("payments.manageCountry"),
  assertCountryAccess("body.countryCode"),
  upsertBankTransferSettings,
);

bankTransferSettingsRouter.delete(
  "/:countryCode",
  requirePermission("payments.manageCountry"),
  assertCountryAccess("params.countryCode"),
  deleteBankTransferSettings,
);

export default bankTransferSettingsRouter;
