// routes/directPricing.route.js
import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  createOrUpdateDirectPricing,
  updateSinglePrice,
  getDirectPricing,
  getDirectPricingList,
  getPriceHistory,
  deleteDirectPricing,
  getDirectPricingStats,
} from '../controllers/directPricing.controller.js';

const directPricingRouter = Router();

// Create or bulk update direct pricing for a product
directPricingRouter.post('/create-update', auth, createOrUpdateDirectPricing);

// Update a single price type for a product
directPricingRouter.put('/update-single', auth, updateSinglePrice);

// Get direct pricing for a specific product
directPricingRouter.get('/product/:productId', auth, getDirectPricing);

// Get all products with direct pricing (with filters and pagination)
directPricingRouter.get('/list', auth, getDirectPricingList);

// Get price history for a specific product
directPricingRouter.get('/history/:productId', auth, getPriceHistory);

// Delete/deactivate direct pricing for a product
directPricingRouter.delete('/product/:productId', auth, deleteDirectPricing);

// Get direct pricing statistics
directPricingRouter.get('/stats', auth, getDirectPricingStats);

export default directPricingRouter;
