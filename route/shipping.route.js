// routes/shipping.route.js - COMPLETE WITH FIX
import { Router } from "express";
import auth from "../middleware/auth.js";
import { countryScope, assertCountryAccess } from "../middleware/countryScope.js";
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
  getGeoDivisions,
  createShipment,
  updateTracking,
  getTrackingByNumber,
  getAllTrackings,
  getTrackingStats,
  getOrdersReadyForShipping,
  getShippingDashboardStats,
  getCategoriesForAssignment,
  getProductsForAssignment,
  exportShippingZonesCSV,
  importShippingZonesCSV,
  exportShippingMethodsCSV,
  importShippingMethodsCSV,
  exportShippingRatesCSV,
  importShippingRatesCSV,
} from "../controllers/shipping.controller.js";

const shippingRouter = Router();

// Logistics roles that can manage shipping. MANAGER already holds
// logistics.view/logistics.manage/shipping.view/shipping.manage in
// config/roles.js's permission set (both HQ and country-scoped MANAGER),
// but this hardcoded subRole allowlist never included it — so every
// country-scoped MANAGER got a 403 on the whole Logistics/Tracking
// module regardless of their actual permissions. Delete stays
// IT/DIRECTOR/LOGISTICS only (a deliberate, narrower list — MANAGER can
// view/manage but not permanently delete zones/methods).
const logisticsRoles = ["IT", "DIRECTOR", "LOGISTICS", "MANAGER"];
const deleteRoles = ["IT", "DIRECTOR", "LOGISTICS"];

// ===== PUBLIC ROUTES =====
shippingRouter.get("/track/:trackingNumber", getTrackingByNumber);
shippingRouter.get("/methods/public", getPublicShippingMethods);
shippingRouter.post("/calculate-checkout", calculateCheckoutShipping);
shippingRouter.post("/calculate-manual-order", calculateManualOrderShipping);

// ===== ADMIN ROUTES =====
// `countryScope` (after `auth`, before `requireRole`) is what activates
// each model's countryScopedPlugin auto-filtering for this request — a
// COUNTRY-scoped Logistics admin (e.g. assigned to Togo) then only ever
// sees/creates/edits their own country's zones and methods; IT/DIRECTOR
// (always GLOBAL — see HQ_ONLY_SUBROLES) see and manage every country's.
// `assertCountryAccess('body.countryCode')` on the write routes is
// belt-and-suspenders: it 403s outright if a COUNTRY-scoped admin sends a
// body.countryCode that isn't their own, rather than silently letting the
// model-layer stamping override it.

// Dashboard
shippingRouter.get(
  "/dashboard/stats",
  auth,
  countryScope,
  requireRole(logisticsRoles),
  getShippingDashboardStats
);

// Geo divisions (state/region + LGA/prefecture/commune) for one country —
// used by the zone-creation/edit modal to show the RIGHT country's states
// instead of hardcoding Nigeria's. Any logistics-accessible admin can call
// this for any country — it's reference geo data, not a data leak.
shippingRouter.get(
  "/geo-divisions",
  auth,
  countryScope,
  requireRole(logisticsRoles),
  getGeoDivisions
);

// Shipping Zones
shippingRouter.get(
  "/zones/all",
  auth,
  countryScope,
  requireRole(logisticsRoles),
  getAllShippingZones
);

shippingRouter.get(
  "/zones",
  auth,
  countryScope,
  requireRole(logisticsRoles),
  getShippingZones
);

shippingRouter.post(
  "/zones",
  auth,
  countryScope,
  requireRole(logisticsRoles),
  assertCountryAccess("body.countryCode"),
  createShippingZone
);

shippingRouter.put(
  "/zones/:zoneId",
  auth,
  countryScope,
  requireRole(logisticsRoles),
  assertCountryAccess("body.countryCode"),
  updateShippingZone
);

shippingRouter.get(
  "/zones/:zoneId/dependencies",
  auth,
  countryScope,
  requireRole(logisticsRoles),
  getZoneDependencies
);

shippingRouter.delete(
  "/zones/:zoneId",
  auth,
  countryScope,
  requireRole(deleteRoles),
  deleteShippingZone
);

// Shipping Zones - CSV Export/Import
shippingRouter.get(
  "/zones/export/csv",
  auth,
  countryScope,
  requireRole(logisticsRoles),
  exportShippingZonesCSV
);

shippingRouter.post(
  "/zones/import/csv",
  auth,
  countryScope,
  requireRole(logisticsRoles),
  assertCountryAccess("body.countryCode"),
  importShippingZonesCSV
);

// Shipping Methods
shippingRouter.get(
  "/methods",
  auth,
  countryScope,
  requireRole(logisticsRoles),
  getShippingMethods
);

shippingRouter.post(
  "/methods",
  auth,
  countryScope,
  requireRole(logisticsRoles),
  assertCountryAccess("body.countryCode"),
  createShippingMethod
);

shippingRouter.put(
  "/methods/:methodId",
  auth,
  countryScope,
  requireRole(logisticsRoles),
  assertCountryAccess("body.countryCode"),
  updateShippingMethod
);

shippingRouter.delete(
  "/methods/:methodId",
  auth,
  countryScope,
  requireRole(deleteRoles),
  deleteShippingMethod
);

// Shipping Methods - CSV Export/Import
shippingRouter.get(
  "/methods/export/csv",
  auth,
  countryScope,
  requireRole(logisticsRoles),
  exportShippingMethodsCSV
);

shippingRouter.post(
  "/methods/import/csv",
  auth,
  countryScope,
  requireRole(logisticsRoles),
  assertCountryAccess("body.countryCode"),
  importShippingMethodsCSV
);

// Shipping Rates (flat_rate zone costs / table_shipping weight bands / pickup locations)
// - one row per rate/location, scoped to methods that already exist
shippingRouter.get(
  "/methods/rates/export/csv",
  auth,
  countryScope,
  requireRole(logisticsRoles),
  exportShippingRatesCSV
);

shippingRouter.post(
  "/methods/rates/import/csv",
  auth,
  countryScope,
  requireRole(logisticsRoles),
  assertCountryAccess("body.countryCode"),
  importShippingRatesCSV
);

// Categories and Products for Assignment
shippingRouter.get(
  "/categories/for-assignment",
  auth,
  countryScope,
  requireRole(logisticsRoles),
  getCategoriesForAssignment
);

shippingRouter.get(
  "/products/for-assignment",
  auth,
  countryScope,
  requireRole(logisticsRoles),
  getProductsForAssignment
);

// Orders Ready for Shipping
shippingRouter.get(
  "/orders/ready-for-shipping",
  auth,
  countryScope,
  requireRole(logisticsRoles),
  getOrdersReadyForShipping
);

// Shipment Creation
shippingRouter.post(
  "/shipments",
  auth,
  countryScope,
  requireRole(logisticsRoles),
  createShipment
);

// Tracking Management
// NOTE: ShippingTrackingModel does not carry the countryScopedPlugin yet
// (tracking country-scoping is a separate, not-yet-built phase) — these
// routes still get `countryScope` for context consistency and to be ready
// for that phase, but a COUNTRY-scoped Logistics admin currently sees all
// trackings, same as before this change.
shippingRouter.get(
  "/trackings",
  auth,
  countryScope,
  requireRole(logisticsRoles),
  getAllTrackings
);

shippingRouter.put(
  "/trackings/:trackingId",
  auth,
  countryScope,
  requireRole(logisticsRoles),
  updateTracking
);

shippingRouter.get(
  "/trackings/stats",
  auth,
  countryScope,
  requireRole(logisticsRoles),
  getTrackingStats
);

export default shippingRouter;
