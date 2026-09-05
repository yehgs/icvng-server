import { Router } from "express";
import auth from "../middleware/auth.js";
import { admin } from "../middleware/Admin.js";
import { countryScope, assertCountryAccess } from "../middleware/countryScope.js";
import {
  createPopupController,
  getPopupsAdminController,
  updatePopupController,
  deletePopupController,
  getActivePopupController,
} from "../controllers/popup.controller.js";

const popupRouter = Router();

// Admin — countryScope activates the model's per-country isolation
// (countryScopedPlugin): a COUNTRY-scoped admin only sees/edits their own
// market's popups; a GLOBAL admin sees everything and can target any
// country explicitly via body.countryCode.
popupRouter.post(
  "/add",
  auth,
  admin,
  countryScope,
  assertCountryAccess("body.countryCode"),
  createPopupController,
);
popupRouter.get("/get", auth, admin, countryScope, getPopupsAdminController);
popupRouter.put(
  "/update",
  auth,
  admin,
  countryScope,
  assertCountryAccess("body.countryCode"),
  updatePopupController,
);
popupRouter.delete("/delete", auth, admin, countryScope, deletePopupController);

// Public — storefront widget. Filtered by the visited domain's country and
// the current page, with an HQ (Nigeria) fallback if that market hasn't
// configured its own popup yet.
popupRouter.get("/active", getActivePopupController);

export default popupRouter;
