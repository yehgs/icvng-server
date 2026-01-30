import { Router } from "express";
import auth from "../middleware/auth.js";
import {
  getPricingConfig,
  updatePricingConfig,
  approvePricingConfig,
  calculatePricesFromPurchaseOrder,
  approvePriceCalculations,
  getProductPricingList,
  updatePricesOnExchangeRateChange,
  bulkRecalculatePricesForCurrency,
  updateProductPricing,
  createDirectProductPricing,
  exportProductPricingCSV, // NEW
  exportProductPricingPDF, // NEW
  importProductPricingCSV, // NEW
  exportProductPricingCSVPLM, // FIXED
  exportProductPricingPDFPLM, // FIXED
} from "../controllers/pricing.controller.js";

const pricingRouter = Router();

// Pricing configuration routes
pricingRouter.get("/config", auth, getPricingConfig);
pricingRouter.put("/config", auth, updatePricingConfig);
pricingRouter.patch("/config/approve", auth, approvePricingConfig);

// Price calculation routes
pricingRouter.post(
  "/calculate/:purchaseOrderId",
  auth,
  calculatePricesFromPurchaseOrder,
);
pricingRouter.post("/approve", auth, approvePriceCalculations);

// Product pricing list
pricingRouter.get("/products", auth, getProductPricingList);

// Direct product price update/create for accountants
pricingRouter.put("/update-product-price", auth, updateProductPricing);
pricingRouter.post("/create-product-price", auth, createDirectProductPricing);

// NEW: Export routes
pricingRouter.get("/export/csv", auth, exportProductPricingCSV);
pricingRouter.get("/export/pdf", auth, exportProductPricingPDF);

// FIXED: Export routes
pricingRouter.get("/export/csv-plm", auth, exportProductPricingCSVPLM);
pricingRouter.get("/export/pdf-plm", auth, exportProductPricingPDFPLM);

// NEW: Import route
pricingRouter.post("/import/csv", auth, importProductPricingCSV);

// Exchange rate update webhook
pricingRouter.post(
  "/exchange-rate-update",
  auth,
  updatePricesOnExchangeRateChange,
);

pricingRouter.post("/bulk-recalculate", auth, bulkRecalculatePricesForCurrency);

export default pricingRouter;
