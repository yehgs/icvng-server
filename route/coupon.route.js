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
import { requireRole } from "../middleware/roleAuth.js";

const couponRouter = Router();

// Public route for validation
couponRouter.post("/validate", auth, validateCoupon);

// Admin routes
couponRouter.post("/create", requireRole(["SALES", "MANAGER"]), createCoupon);
couponRouter.get(
  "/all",
  requireRole(["SALES", "MANAGER", "DIRECTOR"]),
  getAllCoupons,
);
couponRouter.patch(
  "/:couponId",
  requireRole(["SALES", "MANAGER"]),
  updateCoupon,
);
couponRouter.delete(
  "/:couponId",
  requireRole(["MANAGER", "DIRECTOR"]),
  deleteCoupon,
);

export default couponRouter;
