// route/booking-admin.route.js — ADMIN, mounted at /api/admin/booking-requests
//
// Barista-training / coffee-machine-rental requests. Nigeria only:
//   • requirePermission("bookings.view" | "bookings.manage") — Sales, Sales Manager,
//     Manager, IT, Director (see config/roles.js)
//   • nigeriaOnly — refuses any country-scoped admin that is not NG
//   • countryScope + countryScopedPlugin on the model — data is also filtered by country
import { Router } from "express";
import auth from "../middleware/auth.js";
import adminAuth from "../middleware/adminAuth.js";
import { countryScope } from "../middleware/countryScope.js";
import { nigeriaOnly } from "../middleware/nigeriaOnly.js";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  listBookingRequestsController,
  updateBookingRequestController,
} from "../controllers/booking-admin.controller.js";

const r = Router();

r.use(auth);
r.use(adminAuth);
r.use(countryScope);
r.use(nigeriaOnly);
r.use(requirePermission("bookings.view"));

r.get("/", listBookingRequestsController);
r.patch("/:id", requirePermission("bookings.manage"), updateBookingRequestController);

export default r;
