//server
// route/password-vault.route.js  (UPDATED)
import { Router } from 'express';
import auth from '../middleware/auth.js';
import adminAuth from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { countryScope, blockCountryScopedAdmins } from '../middleware/countryScope.js';
import {
  getVaultEntriesController,
  createVaultEntryController,
  updateVaultEntryController,
  deleteVaultEntryController,
  addProductController,
  updateProductController,
  deleteProductController,
  getExpiringProductsController,
  sendExpiryRemindersController,
} from '../controllers/password-vault.controller.js';

const passwordVaultRouter = Router();
passwordVaultRouter.use(auth);
passwordVaultRouter.use(adminAuth);
// PHASE 1 SECURITY + PHASE 2 RBAC: the vault stores third-party credentials.
// HQ-scope only, and gated on the passwordVault.* permissions (held by IT and
// DIRECTOR via wildcard) instead of a hardcoded role list.
passwordVaultRouter.use(countryScope, blockCountryScopedAdmins);
const vaultRead = requirePermission('passwordVault.view');
const vaultWrite = requirePermission('passwordVault.manage');

passwordVaultRouter.get('/expiring', vaultRead, getExpiringProductsController);
passwordVaultRouter.post('/send-reminders', vaultWrite, sendExpiryRemindersController);
passwordVaultRouter.get('/', vaultRead, getVaultEntriesController);
passwordVaultRouter.post('/', vaultWrite, createVaultEntryController);
passwordVaultRouter.put('/:id', vaultWrite, updateVaultEntryController);
passwordVaultRouter.delete('/:id', vaultWrite, deleteVaultEntryController);
passwordVaultRouter.post('/:id/products', vaultWrite, addProductController);
passwordVaultRouter.put('/:id/products/:productId', vaultWrite, updateProductController);
passwordVaultRouter.delete('/:id/products/:productId', vaultWrite, deleteProductController);

export default passwordVaultRouter;
