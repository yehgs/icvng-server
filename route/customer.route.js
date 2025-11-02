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
  assignCustomerController,
  exportCustomersController,
  getAssignableUsersController,
  toggleFeaturedCustomerController,
  getFeaturedCustomersController,
} from '../controllers/customer.controller.js';

const customerRouter = Router();

// Create customer (DIRECTOR, IT, EDITOR, MANAGER, SALES)
customerRouter.post('/create', auth, admin, createCustomerController);

// Get customers list (role-based access)
customerRouter.get('/list', auth, admin, getCustomersController);

customerRouter.get('/featured', getFeaturedCustomersController);

// Get customers for order dropdown
customerRouter.get('/for-order', auth, admin, getCustomersForOrderController);

// Get assignable users (DIRECTOR, IT, MANAGER only)
customerRouter.get('/assignable-users', auth, admin, getAssignableUsersController);

// Get customer details
customerRouter.get('/:customerId', auth, admin, getCustomerDetailsController);

// Update customer
customerRouter.put('/:customerId', auth, admin, updateCustomerController);

// Toggle featured status (EDITOR, IT, DIRECTOR only)
customerRouter.patch('/:customerId/toggle-featured', auth, admin, toggleFeaturedCustomerController);

// Assign customer to users (DIRECTOR, IT, MANAGER only)
customerRouter.put('/:customerId/assign', auth, admin, assignCustomerController);

// Export customers CSV (DIRECTOR and IT only)
customerRouter.get('/export/csv', auth, admin, exportCustomersController);

export default customerRouter;