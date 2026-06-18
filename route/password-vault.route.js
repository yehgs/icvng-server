//server
// route/password-vault.route.js  (UPDATED)
import { Router } from 'express';
import auth from '../middleware/auth.js';
import adminAuth from '../middleware/adminAuth.js';
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

passwordVaultRouter.get('/expiring', getExpiringProductsController);
passwordVaultRouter.post('/send-reminders', sendExpiryRemindersController);
passwordVaultRouter.get('/', getVaultEntriesController);
passwordVaultRouter.post('/', createVaultEntryController);
passwordVaultRouter.put('/:id', updateVaultEntryController);
passwordVaultRouter.delete('/:id', deleteVaultEntryController);
passwordVaultRouter.post('/:id/products', addProductController);
passwordVaultRouter.put('/:id/products/:productId', updateProductController);
passwordVaultRouter.delete('/:id/products/:productId', deleteProductController);

export default passwordVaultRouter;
