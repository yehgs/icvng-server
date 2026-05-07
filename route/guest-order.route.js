// server/route/guestOrder.route.js — no auth required
import { Router } from "express";
import {
  createGuestTempAddress,
  guestPaystackController,
  guestStripeController,
  guestBankTransferController,
} from "../controllers/guest_order.controller";

const guestOrderRouter = Router();

// Step 1 — save temp address for shipping calculation
guestOrderRouter.post("/address/guest-temp", createGuestTempAddress);

// Step 2a — Paystack (NGN only)
guestOrderRouter.post("/order/guest-paystack", guestPaystackController);

// Step 2b — Stripe (USD / EUR / GBP)
guestOrderRouter.post("/order/guest-stripe", guestStripeController);

// Step 2c — Direct bank transfer (NGN only)
guestOrderRouter.post(
  "/order/guest-bank-transfer",
  guestBankTransferController,
);

export default guestOrderRouter;
