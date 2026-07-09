import { Router } from 'express';
import auth from '../middleware/auth.js';
import adminAuth from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import {
  createUserController,
  getAllUsersController,
  updateUserController,
  resetUserPasswordController,
  deleteUserController,
  generatePasswordRecoveryController,
} from '../controllers/admin_user.controller.js';

const adminUserRouter = Router();

adminUserRouter.use(auth);
adminUserRouter.use(adminAuth);
// PHASE 1 SECURITY + PHASE 2 RBAC: previously ANY admin subRole (incl. a
// country-scoped SALES agent) could create/update/reset/delete accounts.
// Now gated on users.* permissions (IT, DIRECTOR, HR, MANAGER). Finer rules
// (HR limits, country bounds, no privilege amplification) live in the controller.
adminUserRouter.use(requirePermission('users.view'));

adminUserRouter.post('/create-user', requirePermission('users.manage'), createUserController);
adminUserRouter.get('/users', getAllUsersController);
adminUserRouter.put('/update-user/:userId', requirePermission('users.manage'), updateUserController);
adminUserRouter.post('/reset-password/:userId', requirePermission('users.manage'), resetUserPasswordController);
adminUserRouter.delete('/delete-user/:userId', requirePermission('users.manage'), deleteUserController);
adminUserRouter.post('/generate-recovery/:userId', requirePermission('users.manage'), generatePasswordRecoveryController);

export default adminUserRouter;
