// route/purchaseOrder.route.js
import { Router } from 'express';
import auth from '../middleware/auth.js';
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

// Get all purchase orders
purchaseOrderRouter.get('/', auth, getPurchaseOrders);

// Get purchase order statistics
purchaseOrderRouter.get('/stats', auth, getPurchaseOrderStats);

// Get logistics cost analysis
purchaseOrderRouter.get('/logistics-analysis', auth, getLogisticsCostAnalysis);

// Get specific purchase order details
purchaseOrderRouter.get('/:orderId', auth, getPurchaseOrderDetails);

// Get allowed status updates for a specific order
purchaseOrderRouter.get(
  '/:orderId/allowed-statuses',
  auth,
  getAllowedStatusUpdates
);

// Get status history for a specific order
purchaseOrderRouter.get('/:orderId/status-history', auth, getStatusHistory);

// Create new purchase order
purchaseOrderRouter.post('/', auth, createPurchaseOrder);

// Update purchase order
purchaseOrderRouter.put('/:orderId', auth, updatePurchaseOrder);

// Update purchase order status
purchaseOrderRouter.patch('/:orderId/status', auth, updateOrderStatus);

// Delete purchase order
purchaseOrderRouter.delete('/:orderId', auth, deletePurchaseOrder);

export default purchaseOrderRouter;
