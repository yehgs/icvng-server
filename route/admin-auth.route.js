import { Router } from 'express';
import {
  adminLoginController,
  getAdminStatsController,
} from '../controllers/admin_auth.controller.js';
import auth from '../middleware/auth.js';
import adminAuth from '../middleware/adminAuth.js';

const adminAuthRouter = Router();

// Public admin auth routes
adminAuthRouter.post('/login', adminLoginController);

// Protected admin routes
adminAuthRouter.get('/stats', auth, adminAuth, getAdminStatsController);

export default adminAuthRouter;
