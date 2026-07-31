import { Router } from 'express';
import auth from '../middleware/auth.js';
import { admin } from '../middleware/Admin.js';
import { countryScope } from '../middleware/countryScope.js';
import { requireRole } from '../middleware/roleAuth.js';
import {
  createProductRequestController,
  getAllProductRequestsController,
  getUserProductRequestsController,
  getProductRequestDetailsController,
  updateProductRequestStatusController,
  deleteProductRequestController,
} from '../controllers/productRequest.controller.js';

const productRequestRouter = Router();

// User routes (protected by auth)
productRequestRouter.post('/create', auth, createProductRequestController);
productRequestRouter.get('/user', auth, getUserProductRequestsController);

// Admin routes — country-scoped in the controller (MANAGER limited to their
// own country; IT/DIRECTOR unrestricted). SALES/SALES_MANAGER kept for
// backward compatibility with existing sales workflows.
const productRequestRoles = requireRole(['SALES', 'SALES_MANAGER', 'MANAGER', 'IT', 'DIRECTOR']);

productRequestRouter.get('/all', auth, admin, countryScope, productRequestRoles, getAllProductRequestsController);
// /details/:requestId is used by BOTH customers (viewing their own request)
// and admins (viewing any, subject to country scope) — ownership/scope is
// enforced inside the controller, not via route-level admin/role gates.
productRequestRouter.get(
  '/details/:requestId',
  auth,
  countryScope,
  getProductRequestDetailsController
);
productRequestRouter.put(
  '/update-status',
  auth,
  admin,
  countryScope,
  productRequestRoles,
  updateProductRequestStatusController
);
productRequestRouter.delete(
  '/delete',
  auth,
  admin,
  countryScope,
  productRequestRoles,
  deleteProductRequestController
);

export default productRequestRouter;
