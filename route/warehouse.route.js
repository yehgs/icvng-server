// routes/warehouse.route.js - UPDATED WITH IMPORT/EXPORT
import { Router } from "express";
import auth from "../middleware/auth.js";
import {
  getProductsForStock,
  updateStock,
  updateWeight,
  disableWarehouseOverride,
  syncAllFromStockModel,
  getStockSummary,
  getSystemStatus,
  enableSystem,
  disableSystem,
  updateSystemSettings,
  getSystemSettings,
  getActivityLog,
  getLowStockAlerts,
  bulkUpdateStock,
  reconcileStock,
  exportStockCSV, // UPDATED
  exportActivityLog,
  exportStockPDF,
  getWarehouseUsers,
  importStockCSV, // NEW
  getSuppliers,
} from "../controllers/warehouse.controller.js";

const warehouseRouter = Router();

// Product stock management routes
warehouseRouter.get("/products", auth, getProductsForStock);
warehouseRouter.put("/update-stock", auth, updateStock);
warehouseRouter.put("/update-weight", auth, updateWeight);
warehouseRouter.put("/bulk-update-stock", auth, bulkUpdateStock);
warehouseRouter.post("/reconcile-stock", auth, reconcileStock);

// Warehouse override management
warehouseRouter.patch(
  "/products/:productId/disable-override",
  auth,
  disableWarehouseOverride,
);
warehouseRouter.post("/sync-all-from-stock-model", auth, syncAllFromStockModel);

// Stock summary and alerts
warehouseRouter.get("/stock-summary", auth, getStockSummary);
warehouseRouter.get("/low-stock-alerts", auth, getLowStockAlerts);

// System control routes (Director/IT only)
warehouseRouter.get("/system-status", auth, getSystemStatus);
warehouseRouter.post("/enable-system", auth, enableSystem);
warehouseRouter.post("/disable-system", auth, disableSystem);
warehouseRouter.get("/system-settings", auth, getSystemSettings);
warehouseRouter.put("/system-settings", auth, updateSystemSettings);

// Activity log
warehouseRouter.get("/activity-log", auth, getActivityLog);
warehouseRouter.get("/warehouse-users", auth, getWarehouseUsers);

// Export routes (UPDATED with column selection)
warehouseRouter.get("/export-stock-csv", auth, exportStockCSV);
warehouseRouter.get("/export-stock-pdf", auth, exportStockPDF);
warehouseRouter.get("/export-activity", auth, exportActivityLog);

// NEW: Import route
warehouseRouter.post("/import-stock-csv", auth, importStockCSV);
warehouseRouter.get("/suppliers", auth, getSuppliers);

export default warehouseRouter;
