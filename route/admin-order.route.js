// route/admin-order.route.js
import { Router } from 'express';
import auth from '../middleware/auth.js';
import { admin } from '../middleware/Admin.js';
import {
  createAdminOrderController,
  getAdminOrdersController,
  updateOrderStatusController,
  generateInvoiceController,
  getOrderAnalyticsController,
} from '../controllers/admin-order.controller.js';

const adminOrderRouter = Router();

// Create order through admin (SALES only)
adminOrderRouter.post('/create', auth, admin, createAdminOrderController);

// Get orders list (role-based access)
adminOrderRouter.get('/list', auth, admin, getAdminOrdersController);

// Update order status
adminOrderRouter.put(
  '/:orderId/status',
  auth,
  admin,
  updateOrderStatusController
);

// Generate and send invoice (SALES only)
adminOrderRouter.post(
  '/:orderId/invoice',
  auth,
  admin,
  generateInvoiceController
);

// Get order analytics
adminOrderRouter.get('/analytics', auth, admin, getOrderAnalyticsController);

export default adminOrderRouter;
