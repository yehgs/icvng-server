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
// A suppliers.view-only user (e.g. EDITOR, WAREHOUSE, an HQ Manager) may
// reach create — createSupplierController itself narrows what they're
// actually allowed to submit to a minimal PARTNER-type quick-create (see
// the isPartnerQuickCreate check there). Full supplier records still
// require suppliers.manage, enforced inside the controller.
const viewOrManage = () => guard({ permissions: ['suppliers.view', 'suppliers.manage'], mode: 'any', hqOnly: true });

supplierRouter.get('/selection', ...view(), getSuppliersForSelection);
supplierRouter.get('/', ...manage(), getSuppliersController);
supplierRouter.get('/:supplierId', ...manage(), getSupplierDetailsController);
supplierRouter.post('/', ...viewOrManage(), createSupplierController);
supplierRouter.put('/:supplierId', ...manage(), updateSupplierController);
supplierRouter.delete('/:supplierId', ...manage(), deleteSupplierController);

export default supplierRouter;
