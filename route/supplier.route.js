// route/supplier.route.js
import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  createSupplierController,
  getSuppliersController,
  getSupplierDetailsController,
  updateSupplierController,
  deleteSupplierController,
  getSuppliersForSelection,
} from '../controllers/supplier.controller.js';

const supplierRouter = Router();

// Get suppliers for selection (dropdown)
supplierRouter.get('/selection', auth, getSuppliersForSelection);

// Get all suppliers
supplierRouter.get('/', auth, getSuppliersController);

// Get specific supplier details
supplierRouter.get('/:supplierId', auth, getSupplierDetailsController);

// Create new supplier
supplierRouter.post('/', auth, createSupplierController);

// Update supplier
supplierRouter.put('/:supplierId', auth, updateSupplierController);

// Delete supplier
supplierRouter.delete('/:supplierId', auth, deleteSupplierController);

export default supplierRouter;
