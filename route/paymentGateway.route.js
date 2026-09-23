// route/paymentGateway.route.js
//
// Country-scoped indigenous payment gateway settings (CinetPay). Unlike
// bankTransferSettingsRouter (HQ-only via blockCountryScopedAdmins), this
// router deliberately ALLOWS a country-scoped admin through — gated on
// payments.manageCountry (held by MANAGER — see config/roles.js) — and
// relies on assertCountryAccess to confine them to their own
// assignedCountry. IT/DIRECTOR hold the same permission via WILDCARD and
// are never scoped (HQ_ONLY_SUBROLES), so they pass through unrestricted.

import { Router } from "express";
import auth from "../middleware/auth.js";
import adminAuth from "../middleware/adminAuth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { countryScope, assertCountryAccess } from "../middleware/countryScope.js";
import {
  listCinetPaySettings,
  upsertCinetPaySettings,
  deleteCinetPaySettings,
} from "../controllers/paymentGateway.controller.js";

const paymentGatewayRouter = Router();

paymentGatewayRouter.use(auth, adminAuth, countryScope);

paymentGatewayRouter.get(
  "/cinetpay",
  requirePermission(["payments.view", "payments.manageCountry"]),
  listCinetPaySettings,
);

paymentGatewayRouter.post(
  "/cinetpay",
  requirePermission("payments.manageCountry"),
  assertCountryAccess("body.countryCode"),
  upsertCinetPaySettings,
);

paymentGatewayRouter.delete(
  "/cinetpay/:countryCode",
  requirePermission("payments.manageCountry"),
  assertCountryAccess("params.countryCode"),
  deleteCinetPaySettings,
);

export default paymentGatewayRouter;
