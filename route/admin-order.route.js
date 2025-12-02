// route/admin-order-enhanced.route.js - Enhanced with invoice preview
import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  createAdminOrderController,
  getAllOrdersController,
  updateOrderStatusController,
  generateInvoiceController,
  getOrderAnalyticsController,
  previewInvoiceController,
} from '../controllers/admin-order.controller.js';

const adminOrderRouter = Router();

// All routes require authentication
adminOrderRouter.use(auth);

// Create manual order (SALES only) - Enhanced with email & stock deduction
adminOrderRouter.post('/create', createAdminOrderController);

// Get all orders (unified - both website and manual)
adminOrderRouter.get('/list', getAllOrdersController);

// Update order status
adminOrderRouter.put('/:orderId/status', updateOrderStatusController);

// Generate invoice with email option
adminOrderRouter.post('/:orderId/invoice', generateInvoiceController);

// NEW: Preview invoice before creating order
adminOrderRouter.post('/preview-invoice', previewInvoiceController);

// Analytics
adminOrderRouter.get('/analytics', getOrderAnalyticsController);

export default adminOrderRouter;
