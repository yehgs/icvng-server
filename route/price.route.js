import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  getPricingConfig,
  updatePricingConfig,
  approvePricingConfig,
  calculatePricesFromPurchaseOrder,
  approvePriceCalculations,
  getProductPricingList,
  updatePricesOnExchangeRateChange,
  bulkRecalculatePricesForCurrency,
  updateProductPricing, // Direct price update
  createDirectProductPricing, // NEW: Direct price creation
} from '../controllers/pricing.controller.js';

const pricingRouter = Router();

// Pricing configuration routes
pricingRouter.get('/config', auth, getPricingConfig);
pricingRouter.put('/config', auth, updatePricingConfig);
pricingRouter.patch('/config/approve', auth, approvePricingConfig);

// Price calculation routes
pricingRouter.post(
  '/calculate/:purchaseOrderId',
  auth,
  calculatePricesFromPurchaseOrder
);
pricingRouter.post('/approve', auth, approvePriceCalculations);

// Product pricing list
pricingRouter.get('/products', auth, getProductPricingList);

// NEW: Direct product price update/create for accountants
pricingRouter.put('/update-product-price', auth, updateProductPricing);
pricingRouter.post('/create-product-price', auth, createDirectProductPricing);

// Exchange rate update webhook
pricingRouter.post(
  '/exchange-rate-update',
  auth,
  updatePricesOnExchangeRateChange
);

pricingRouter.post('/bulk-recalculate', auth, bulkRecalculatePricesForCurrency);

export default pricingRouter;
