// route/admin-order.route.js - Manual orders
import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  createAdminOrderController,
  getAllOrdersController,
  updateOrderStatusController,
  generateInvoiceController,
  getOrderAnalyticsController,
} from '../controllers/admin-order.controller.js';

const adminOrderRouter = Router();

// All routes require authentication
adminOrderRouter.use(auth);

// Create manual order (SALES only)
adminOrderRouter.post('/create', createAdminOrderController);

// Get all orders (unified - both website and manual)
adminOrderRouter.get('/list', getAllOrdersController);

// Update order status
adminOrderRouter.put('/:orderId/status', updateOrderStatusController);

// Generate invoice
adminOrderRouter.post('/:orderId/invoice', generateInvoiceController);

// Analytics
adminOrderRouter.get('/analytics', getOrderAnalyticsController);

export default adminOrderRouter;
