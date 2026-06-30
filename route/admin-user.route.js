import { Router } from 'express';
import auth from '../middleware/auth.js';
import adminAuth from '../middleware/adminAuth.js';
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

adminUserRouter.post('/create-user', createUserController);
adminUserRouter.get('/users', getAllUsersController);
adminUserRouter.put('/update-user/:userId', updateUserController);
adminUserRouter.post('/reset-password/:userId', resetUserPasswordController);
adminUserRouter.delete('/delete-user/:userId', deleteUserController);
adminUserRouter.post('/generate-recovery/:userId', generatePasswordRecoveryController);

export default adminUserRouter;
