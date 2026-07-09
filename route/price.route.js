import { Router } from "express";
import auth from "../middleware/auth.js";
import adminAuth from "../middleware/adminAuth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { countryScope, blockCountryScopedAdmins } from "../middleware/countryScope.js";
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
  directImportProductPricingCSV,
} from "../controllers/pricing.controller.js";

const pricingRouter = Router();

// PHASE 1 SECURITY: HQ-only pricing module. Previously `auth` alone — any
// authenticated customer could read cost prices/margins and write prices.
// Now ADMIN-only, role-restricted (mirrors admin UI pricing pages), and
// hard-blocked for country-scoped admins.
pricingRouter.use(auth, adminAuth, countryScope, blockCountryScopedAdmins, requirePermission(["pricing.view", "pricing.manage"]));

// Pricing configuration routes
pricingRouter.get("/config", getPricingConfig);
pricingRouter.put("/config", updatePricingConfig);
pricingRouter.patch("/config/approve", approvePricingConfig);

// Price calculation routes
pricingRouter.post(
  "/calculate/:purchaseOrderId",
    calculatePricesFromPurchaseOrder,
);
pricingRouter.post("/approve", approvePriceCalculations);

// Product pricing list
pricingRouter.get("/products", getProductPricingList);

// Direct product price update/create for accountants
pricingRouter.put("/update-product-price", updateProductPricing);
pricingRouter.post("/create-product-price", createDirectProductPricing);

// NEW: Export routes
pricingRouter.get("/export/csv", exportProductPricingCSV);
pricingRouter.get("/export/pdf", exportProductPricingPDF);

// FIXED: Export routes
pricingRouter.get("/export/csv-plm", exportProductPricingCSVPLM);
pricingRouter.get("/export/pdf-plm", exportProductPricingPDFPLM);

// NEW: Import route
pricingRouter.post("/import/csv", importProductPricingCSV);

// Exchange rate update webhook
pricingRouter.post(
  "/exchange-rate-update",
    updatePricesOnExchangeRateChange,
);

pricingRouter.post("/bulk-recalculate", bulkRecalculatePricesForCurrency);

// Add after the existing import route:
pricingRouter.post("/import/csv-direct", directImportProductPricingCSV);

export default pricingRouter;
