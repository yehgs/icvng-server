import { Router } from 'express';
import auth from '../middleware/auth.js';
import { admin } from '../middleware/admin.js';
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

// Admin routes (protected by auth and admin)
productRequestRouter.get('/all', auth, admin, getAllProductRequestsController);
productRequestRouter.get(
  '/details/:requestId',
  auth,
  getProductRequestDetailsController
);
productRequestRouter.put(
  '/update-status',
  auth,
  admin,
  updateProductRequestStatusController
);
productRequestRouter.delete(
  '/delete',
  auth,
  admin,
  deleteProductRequestController
);

export default productRequestRouter;
