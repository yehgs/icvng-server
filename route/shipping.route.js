// route/shipping.route.js - Updated with category/product endpoints
import { Router } from 'express';
import auth from '../middleware/auth.js';
import { requireRole } from '../middleware/roleAuth.js';
import {
  createShippingZone,
  getShippingZones,
  updateShippingZone,
  deleteShippingZone,
  createShippingMethod,
  getShippingMethods,
  updateShippingMethod,
  deleteShippingMethod,
  calculateCheckoutShipping,
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
  debugPickupMethod,
  calculateCheckoutShippingDebug,
  testSpecificPickupMethod,
} from '../controllers/shipping.controller.js';

const shippingRouter = Router();

// ===== PUBLIC ROUTES =====
shippingRouter.get('/track/:trackingNumber', getTrackingByNumber);
shippingRouter.get('/methods/public', getPublicShippingMethods);
shippingRouter.post('/calculate-checkout', calculateCheckoutShipping);

// ===== ADMIN ROUTES WITH ROLE PROTECTION =====
const logisticsRoles = ['IT', 'DIRECTOR', 'LOGISTICS'];

// Dashboard stats
shippingRouter.get(
  '/dashboard/stats',
  auth,
  requireRole(logisticsRoles),
  getShippingDashboardStats
);

// Shipping zones
shippingRouter.get(
  '/zones',
  auth,
  requireRole(logisticsRoles),
  getShippingZones
);
shippingRouter.post(
  '/zones',
  auth,
  requireRole(logisticsRoles),
  createShippingZone
);
shippingRouter.put(
  '/zones/:zoneId',
  auth,
  requireRole(logisticsRoles),
  updateShippingZone
);
shippingRouter.delete(
  '/zones/:zoneId',
  auth,
  requireRole(['IT', 'DIRECTOR']), // Only IT and DIRECTOR can delete
  deleteShippingZone
);

// Shipping methods
shippingRouter.get(
  '/methods',
  auth,
  requireRole(logisticsRoles),
  getShippingMethods
);
shippingRouter.post(
  '/methods',
  auth,
  requireRole(logisticsRoles),
  createShippingMethod
);
shippingRouter.put(
  '/methods/:methodId',
  auth,
  requireRole(logisticsRoles),
  updateShippingMethod
);
shippingRouter.delete(
  '/methods/:methodId',
  auth,
  requireRole(['IT', 'DIRECTOR']), // Only IT and DIRECTOR can delete
  deleteShippingMethod
);

// NEW: Categories and Products for assignment
shippingRouter.get(
  '/categories/for-assignment',
  auth,
  requireRole(logisticsRoles),
  getCategoriesForAssignment
);
shippingRouter.get(
  '/products/for-assignment',
  auth,
  requireRole(logisticsRoles),
  getProductsForAssignment
);

// Orders ready for shipping
shippingRouter.get(
  '/orders/ready-for-shipping',
  auth,
  requireRole(logisticsRoles),
  getOrdersReadyForShipping
);

// Shipment creation
shippingRouter.post(
  '/shipments',
  auth,
  requireRole(logisticsRoles),
  createShipment
);

// Tracking management
shippingRouter.get(
  '/trackings',
  auth,
  requireRole(logisticsRoles),
  getAllTrackings
);
shippingRouter.put(
  '/trackings/:trackingId',
  auth,
  requireRole(logisticsRoles),
  updateTracking
);
shippingRouter.get(
  '/trackings/stats',
  auth,
  requireRole(logisticsRoles),
  getTrackingStats
);

shippingRouter.post('/debug-pickup-method', debugPickupMethod);
shippingRouter.post(
  '/debug-calculate-checkout',
  calculateCheckoutShippingDebug
);
shippingRouter.get('/test-specific-pickup', testSpecificPickupMethod);

export default shippingRouter;
