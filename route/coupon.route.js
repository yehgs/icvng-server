// route/coupon.route.js
import { Router } from "express";
import {
  createCoupon,
  getAllCoupons,
  validateCoupon,
  updateCoupon,
  deleteCoupon,
} from "../controllers/coupon.controller.js";
import auth from "../middleware/auth.js";
import { countryScope } from "../middleware/countryScope.js";
import { requireRole } from "../middleware/roleAuth.js";

const couponRouter = Router();

// Public route for validation
couponRouter.post("/validate", auth, validateCoupon);

// Admin routes — `auth` was missing here (requireRole assumes req.user is
// already set, so these previously 401'd for everyone), and `countryScope`
// is needed for the model's countryScopedPlugin auto-filter to activate for
// country-scoped Sales/Managers.
couponRouter.post(
  "/create",
  auth,
  countryScope,
  requireRole(["SALES", "MANAGER"]),
  createCoupon,
);
couponRouter.get(
  "/all",
  auth,
  countryScope,
  requireRole(["SALES", "MANAGER", "DIRECTOR"]),
  getAllCoupons,
);
couponRouter.patch(
  "/:couponId",
  auth,
  countryScope,
  requireRole(["SALES", "MANAGER"]),
  updateCoupon,
);
couponRouter.delete(
  "/:couponId",
  auth,
  countryScope,
  requireRole(["MANAGER", "DIRECTOR"]),
  deleteCoupon,
);

export default couponRouter;
