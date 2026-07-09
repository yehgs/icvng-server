// route/supplier.route.js
// PHASE 4: guard() composition. HQ-only procurement module.
import { Router } from 'express';
import { guard } from '../core/guard.js';
import {
  createSupplierController,
  getSuppliersController,
  getSupplierDetailsController,
  updateSupplierController,
  deleteSupplierController,
  getSuppliersForSelection,
} from '../controllers/supplier.controller.js';

const supplierRouter = Router();
const view = () => guard({ permissions: 'suppliers.view', hqOnly: true });
const manage = () => guard({ permissions: 'suppliers.manage', hqOnly: true });

supplierRouter.get('/selection', ...view(), getSuppliersForSelection);
supplierRouter.get('/', ...manage(), getSuppliersController);
supplierRouter.get('/:supplierId', ...manage(), getSupplierDetailsController);
supplierRouter.post('/', ...manage(), createSupplierController);
supplierRouter.put('/:supplierId', ...manage(), updateSupplierController);
supplierRouter.delete('/:supplierId', ...manage(), deleteSupplierController);

export default supplierRouter;
