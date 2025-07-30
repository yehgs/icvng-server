// route/customer.route.js
import { Router } from 'express';
import auth from '../middleware/auth.js';
import { admin } from '../middleware/Admin.js';
import {
  createCustomerController,
  getCustomersController,
  updateCustomerController,
  getCustomerDetailsController,
  getCustomersForOrderController,
  exportCustomersController,
} from '../controllers/customer.controller.js';

const customerRouter = Router();

// Create customer (SALES only)
customerRouter.post('/create', auth, admin, createCustomerController);

// Get customers list (role-based access)
customerRouter.get('/list', auth, admin, getCustomersController);

// Get customers for order dropdown (SALES, IT, MANAGER, DIRECTOR)
customerRouter.get('/for-order', auth, admin, getCustomersForOrderController);

// Get customer details
customerRouter.get('/:customerId', auth, admin, getCustomerDetailsController);

// Update customer
customerRouter.put('/:customerId', auth, admin, updateCustomerController);

// Export customers CSV (DIRECTOR only)
customerRouter.get('/export/csv', auth, admin, exportCustomersController);

export default customerRouter;

// Add to main server.js
/*
import customerRouter from './route/customer.route.js';
import adminOrderRouter from './route/admin-order.route.js';

app.use('/api/admin/customers', customerRouter);
app.use('/api/admin/orders', adminOrderRouter);
*/
