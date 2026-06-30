/**
 * route/shipping.route.js — PATCHED
 *
 * Added blockForeignFromLogistics middleware to all routes.
 * Foreign admins have ZERO access to the logistics system.
 *
 * NOTE: Import and re-export pattern — this file patches the existing
 * route by prepending the logistics block middleware.
 * Replace your existing shipping.route.js with this file.
 */

import express from "express";
import auth from "../middleware/auth.js";
import adminAuth from "../middleware/adminAuth.js";
import { blockForeignFromLogistics, countryScope } from "../middleware/countryScope.js";

// Import existing shipping controllers (unchanged)
import {
  // List your existing shipping controller imports here — they are unchanged
  // e.g.:
  // createShippingZone, updateShippingZone, deleteShippingZone,
  // getShippingZones, createShippingMethod, etc.
} from "../controllers/shipping.controller.js";

const shippingRouter = express.Router();

// 🔴 Block ALL foreign admins from any shipping route
shippingRouter.use(auth, adminAuth, blockForeignFromLogistics, countryScope);

// Re-add your existing shipping routes here with the same paths/controllers
// They remain unchanged — only the middleware chain above is added.
// Example:
// shippingRouter.get('/zones', getShippingZones);
// shippingRouter.post('/zones', createShippingZone);

export default shippingRouter;
