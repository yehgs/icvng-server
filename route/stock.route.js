import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  createStockBatch,
  getStockBatches,
  performQualityCheck,
  distributeStock,
  approveDistribution,
  getStockBatchDetails,
  getExpiringBatches,
  getStockSummary,
  closePurchaseOrder,
  reactivatePurchaseOrder,
} from '../controllers/stock.controller.js';

const stockRouter = Router();

// Get stock summary by product
stockRouter.get('/summary', auth, getStockSummary);

// Get expiring batches
stockRouter.get('/expiring', auth, getExpiringBatches);

// Get all stock batches
stockRouter.get('/batches', auth, getStockBatches);

// Get specific stock batch details
stockRouter.get('/batches/:batchId', auth, getStockBatchDetails);

// Create new stock batch (Warehouse, Director, IT, Manager only)
stockRouter.post('/batches', auth, createStockBatch);

// Perform quality check on batch
stockRouter.patch('/batches/:batchId/quality-check', auth, performQualityCheck);

// Submit stock distribution for approval
stockRouter.patch('/batches/:batchId/distribute', auth, distributeStock);

// Approve/reject distribution (Director, IT, Manager only)
stockRouter.patch(
  '/batches/:batchId/approve-distribution',
  auth,
  approveDistribution
);

// Purchase order management
stockRouter.patch(
  '/purchase-orders/:purchaseOrderId/close',
  auth,
  closePurchaseOrder
);
stockRouter.patch(
  '/purchase-orders/:purchaseOrderId/reactivate',
  auth,
  reactivatePurchaseOrder
);

export default stockRouter;
