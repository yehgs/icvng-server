// routes/shipping.route.js - COMPLETE WITH FIX
import { Router } from "express";
import auth from "../middleware/auth.js";
import { requireRole } from "../middleware/roleAuth.js";
import {
  createShippingZone,
  getShippingZones,
  getAllShippingZones, // NEW: Get all zones without pagination
  updateShippingZone,
  getZoneDependencies,
  deleteShippingZone,
  createShippingMethod,
  getShippingMethods,
  updateShippingMethod,
  deleteShippingMethod,
  calculateCheckoutShipping,
  calculateManualOrderShipping, // NEW: Calculate shipping for manual orders
  getPublicShippingMethods,
  createShipment,
  updateTracking,
  getTrackingByNumber,
  getAllTrackings,
  getTrackingStats,
  getOrdersReadyForShipping,
  getShippingDashboardStats,
  getCategoriesForAssignment,
  getProductsForAssignment,
} from "../controllers/shipping.controller.js";

const shippingRouter = Router();

// Logistics roles that can manage shipping
const logisticsRoles = ["IT", "DIRECTOR", "LOGISTICS"];
const deleteRoles = ["IT", "DIRECTOR", "LOGISTICS"];

// ===== PUBLIC ROUTES =====
shippingRouter.get("/track/:trackingNumber", getTrackingByNumber);
shippingRouter.get("/methods/public", getPublicShippingMethods);
shippingRouter.post("/calculate-checkout", calculateCheckoutShipping);
shippingRouter.post("/calculate-manual-order", calculateManualOrderShipping);

// ===== ADMIN ROUTES =====

// Dashboard
shippingRouter.get(
  "/dashboard/stats",
  auth,
  requireRole(logisticsRoles),
  getShippingDashboardStats
);

// Shipping Zones
shippingRouter.get(
  "/zones/all",
  auth,
  requireRole(logisticsRoles),
  getAllShippingZones
);

shippingRouter.get(
  "/zones",
  auth,
  requireRole(logisticsRoles),
  getShippingZones
);

shippingRouter.post(
  "/zones",
  auth,
  requireRole(logisticsRoles),
  createShippingZone
);

shippingRouter.put(
  "/zones/:zoneId",
  auth,
  requireRole(logisticsRoles),
  updateShippingZone
);

shippingRouter.get(
  "/zones/:zoneId/dependencies",
  auth,
  requireRole(logisticsRoles),
  getZoneDependencies
);

shippingRouter.delete(
  "/zones/:zoneId",
  auth,
  requireRole(deleteRoles),
  deleteShippingZone
);

// Shipping Methods
shippingRouter.get(
  "/methods",
  auth,
  requireRole(logisticsRoles),
  getShippingMethods
);

shippingRouter.post(
  "/methods",
  auth,
  requireRole(logisticsRoles),
  createShippingMethod
);

shippingRouter.put(
  "/methods/:methodId",
  auth,
  requireRole(logisticsRoles),
  updateShippingMethod
);

shippingRouter.delete(
  "/methods/:methodId",
  auth,
  requireRole(deleteRoles),
  deleteShippingMethod
);

// Categories and Products for Assignment
shippingRouter.get(
  "/categories/for-assignment",
  auth,
  requireRole(logisticsRoles),
  getCategoriesForAssignment
);

shippingRouter.get(
  "/products/for-assignment",
  auth,
  requireRole(logisticsRoles),
  getProductsForAssignment
);

// Orders Ready for Shipping
shippingRouter.get(
  "/orders/ready-for-shipping",
  auth,
  requireRole(logisticsRoles),
  getOrdersReadyForShipping
);

// Shipment Creation
shippingRouter.post(
  "/shipments",
  auth,
  requireRole(logisticsRoles),
  createShipment
);

// Tracking Management
shippingRouter.get(
  "/trackings",
  auth,
  requireRole(logisticsRoles),
  getAllTrackings
);

shippingRouter.put(
  "/trackings/:trackingId",
  auth,
  requireRole(logisticsRoles),
  updateTracking
);

shippingRouter.get(
  "/trackings/stats",
  auth,
  requireRole(logisticsRoles),
  getTrackingStats
);

export default shippingRouter;
