import { Router } from "express";
import auth from "../middleware/auth.js";
import { optionalAuth } from "../middleware/optionalAuth.js";
import { admin } from "../middleware/Admin.js";
import { countryScope, assertCountryAccess } from "../middleware/countryScope.js";
import {
  initiatePaystackGiftCardPurchase,
  verifyPaystackGiftCardPurchase,
  initiateStripeGiftCardPurchase,
  getGiftCardPurchaseStatus,
  validateGiftCardForCheckoutController,
  listGiftCardsAdminController,
  getGiftCardAdminController,
  issueGiftCardAdminController,
  updateGiftCardAdminController,
  resendGiftCardEmailController,
} from "../controllers/giftCard.controller.js";

const giftCardRouter = Router();

// ── Purchase (public — a gift can be bought without an account) ─────────────
giftCardRouter.post("/purchase/paystack", optionalAuth, initiatePaystackGiftCardPurchase);
giftCardRouter.get("/purchase/paystack/verify/:reference", verifyPaystackGiftCardPurchase);
giftCardRouter.post("/purchase/stripe", optionalAuth, initiateStripeGiftCardPurchase);
giftCardRouter.get("/purchase/status/:reference", getGiftCardPurchaseStatus);

// ── Redemption (public, read-only — see validateGiftCardForCheckoutController) ─
giftCardRouter.post("/validate", optionalAuth, validateGiftCardForCheckoutController);

// ── Admin ─────────────────────────────────────────────────────────────────────
// countryScope activates countryScopedPlugin's auto-filtering on GiftCardModel
// (every query/update below is transparently scoped to the admin's assigned
// country) — same mechanism as products/popups/banners. Per
// middleware/countryScope.js's HQ_ONLY_SUBROLES list, IT and DIRECTOR (plus
// ACCOUNTANT/WAREHOUSE/EDITOR) are never country-scoped; every other admin
// subRole only sees/manages their own market's gift cards.
giftCardRouter.get("/admin/get", auth, admin, countryScope, listGiftCardsAdminController);
giftCardRouter.get("/admin/get/:id", auth, admin, countryScope, getGiftCardAdminController);
giftCardRouter.post(
  "/admin/issue",
  auth,
  admin,
  countryScope,
  assertCountryAccess("body.countryCode"),
  issueGiftCardAdminController,
);
giftCardRouter.put("/admin/update/:id", auth, admin, countryScope, updateGiftCardAdminController);
giftCardRouter.post(
  "/admin/resend-email/:id",
  auth,
  admin,
  countryScope,
  resendGiftCardEmailController,
);

export default giftCardRouter;
