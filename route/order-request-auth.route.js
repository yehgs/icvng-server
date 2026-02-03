// route/orderRequestAuth.route.js
import { Router } from "express";
import {
  registerBTBCustomer,
  verifyEmail,
  login,
  forgotPassword,
  resetPassword,
  resendVerificationEmail,
} from "../controllers/orderRequestAuth.controller.js";

const orderRequestAuthRouter = Router();

orderRequestAuthRouter.post("/register", registerBTBCustomer);
orderRequestAuthRouter.post("/verify-email", verifyEmail);
orderRequestAuthRouter.post("/login", login);
orderRequestAuthRouter.post("/forgot-password", forgotPassword);
orderRequestAuthRouter.post("/reset-password", resetPassword);
orderRequestAuthRouter.post("/resend-verification", resendVerificationEmail);

export default orderRequestAuthRouter;
