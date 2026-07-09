// route/purchaseOrder.route.js
// PHASE 4: guard() composition. HQ-only procurement module.
import { Router } from 'express';
import { guard } from '../core/guard.js';
import {
  createPurchaseOrder,
  getPurchaseOrders,
  getPurchaseOrderDetails,
  updatePurchaseOrder,
  updateOrderStatus,
  deletePurchaseOrder,
  getPurchaseOrderStats,
  getLogisticsCostAnalysis,
  getAllowedStatusUpdates,
  getStatusHistory,
} from '../controllers/purchaseOrder.controller.js';

const purchaseOrderRouter = Router();
const view = () => guard({ permissions: 'purchaseOrders.view', hqOnly: true });
const manage = () => guard({ permissions: 'purchaseOrders.manage', hqOnly: true });

purchaseOrderRouter.get('/', ...view(), getPurchaseOrders);
purchaseOrderRouter.get('/stats', ...view(), getPurchaseOrderStats);
purchaseOrderRouter.get('/logistics-analysis', ...view(), getLogisticsCostAnalysis);
purchaseOrderRouter.get('/:orderId', ...view(), getPurchaseOrderDetails);
purchaseOrderRouter.get('/:orderId/allowed-statuses', ...view(), getAllowedStatusUpdates);
purchaseOrderRouter.get('/:orderId/status-history', ...view(), getStatusHistory);
purchaseOrderRouter.post('/', ...manage(), createPurchaseOrder);
purchaseOrderRouter.put('/:orderId', ...manage(), updatePurchaseOrder);
purchaseOrderRouter.patch('/:orderId/status', ...manage(), updateOrderStatus);
purchaseOrderRouter.delete('/:orderId', ...manage(), deletePurchaseOrder);

export default purchaseOrderRouter;
