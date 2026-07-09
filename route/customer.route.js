// route/customer.route.js
// PHASE 4: migrated to the guard() composition. Replaces the legacy `admin`
// middleware (from Admin.js) with the standard auth→adminAuth→countryScope→
// requirePermission stack. /featured stays explicitly public (storefront reads
// featured customers/testimonials).
import { Router } from 'express';
import { guard, guardPublic } from '../core/guard.js';
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

// ── Public (storefront) ──────────────────────────────────────────────────────
customerRouter.get('/featured', ...guardPublic(), getFeaturedCustomersController);

// ── Admin ────────────────────────────────────────────────────────────────────
customerRouter.post('/create', ...guard({ permissions: 'customers.manage' }), createCustomerController);
customerRouter.get('/list', ...guard({ permissions: 'customers.view' }), getCustomersController);
customerRouter.get('/for-order', ...guard({ permissions: 'customers.view' }), getCustomersForOrderController);
customerRouter.get('/assignable-users', ...guard({ permissions: 'users.view' }), getAssignableUsersController);
customerRouter.get('/export/csv', ...guard({ permissions: 'customers.view' }), exportCustomersController);
customerRouter.get('/:customerId', ...guard({ permissions: 'customers.view' }), getCustomerDetailsController);
customerRouter.put('/:customerId', ...guard({ permissions: 'customers.manage' }), updateCustomerController);
customerRouter.patch('/:customerId/toggle-featured', ...guard({ permissions: 'customers.manage' }), toggleFeaturedCustomerController);
customerRouter.put('/:customerId/assign', ...guard({ permissions: 'customers.manage' }), assignCustomerController);

export default customerRouter;
