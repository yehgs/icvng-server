// routes/directPricing.route.js
// PHASE 1 SECURITY: HQ-only pricing module. Previously `auth` alone.
// Now ADMIN-only, role-restricted (mirrors the direct-pricing admin page,
// which additionally allows EDITOR), hard-blocked for country-scoped admins.
import { Router } from 'express';
import auth from '../middleware/auth.js';
import adminAuth from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { countryScope, blockCountryScopedAdmins } from '../middleware/countryScope.js';
import {
  createOrUpdateDirectPricing,
  updateSinglePrice,
  getDirectPricing,
  getDirectPricingList,
  getPriceHistory,
  deleteDirectPricing,
  getDirectPricingStats,
  getAvailableProductsForDirectPricing,
} from '../controllers/directPricing.controller.js';

const directPricingRouter = Router();

directPricingRouter.use(
  auth,
  adminAuth,
  countryScope,
  blockCountryScopedAdmins,
  requirePermission(["pricing.view", "pricing.manage"])
);

// Create or bulk update direct pricing for a product
directPricingRouter.post('/create-update', createOrUpdateDirectPricing);

// Update a single price type for a product
directPricingRouter.put('/update-single', updateSinglePrice);

// Get direct pricing for a specific product
directPricingRouter.get('/product/:productId', getDirectPricing);

// Get all products with direct pricing (with filters and pagination)
directPricingRouter.get('/list', getDirectPricingList);

// Get price history for a specific product
directPricingRouter.get('/history/:productId', getPriceHistory);

// Delete/deactivate direct pricing for a product
directPricingRouter.delete('/product/:productId', deleteDirectPricing);

// Get direct pricing statistics
directPricingRouter.get('/stats', getDirectPricingStats);

// Get available products for direct pricing modal (with filters and pagination)
directPricingRouter.get('/available-products', getAvailableProductsForDirectPricing);

export default directPricingRouter;
