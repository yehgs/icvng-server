// route/stock.route.js
// PHASE 4: migrated to guard() composition. HQ-only module with permission
// gating (was Phase 1 requireRole stacks). Backward compatible — the same
// principals pass, since roles map to these permissions with exact parity.
import { Router } from 'express';
import { guard } from '../core/guard.js';
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
const read = () => guard({ permissions: 'stock.view', hqOnly: true });
const write = () => guard({ permissions: 'stock.manage', hqOnly: true });
const approve = () => guard({ permissions: 'stock.approve', hqOnly: true });

stockRouter.get('/summary', ...read(), getStockSummary);
stockRouter.get('/expiring', ...read(), getExpiringBatches);
stockRouter.get('/batches', ...read(), getStockBatches);
stockRouter.get('/batches/:batchId', ...read(), getStockBatchDetails);
stockRouter.post('/batches', ...write(), createStockBatch);
stockRouter.patch('/batches/:batchId/quality-check', ...write(), performQualityCheck);
stockRouter.patch('/batches/:batchId/distribute', ...write(), distributeStock);
stockRouter.patch('/batches/:batchId/approve-distribution', ...approve(), approveDistribution);
stockRouter.patch('/purchase-orders/:purchaseOrderId/close', ...write(), closePurchaseOrder);
stockRouter.patch('/purchase-orders/:purchaseOrderId/reactivate', ...approve(), reactivatePurchaseOrder);

export default stockRouter;
