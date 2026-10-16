// route/booking-request.route.js — PUBLIC, mounted at /api/booking-requests
import { Router } from "express";
import { rateLimit } from "../utils/rateLimit.js";
import { submitBookingRequestController } from "../controllers/booking-request.controller.js";

const r = Router();
// 5 submissions / 10 min per IP
r.post(
  "/",
  rateLimit({ windowMs: 10 * 60_000, max: 5, message: "Too many requests. Please try again later." }),
  submitBookingRequestController,
);
export default r;
