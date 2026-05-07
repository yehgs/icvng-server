// server/route/activity-log.route.js
import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  getActivityLogs,
  getActivitySummary,
  getActionTypes,
} from '../controllers/activityLog.controller.js';

const activityLogRouter = Router();

// All routes require auth + DIRECTOR or IT only
const directorOrIT = (req, res, next) => {
  const allowed = ['DIRECTOR', 'IT'];
  if (!req.user || !allowed.includes(req.user.subRole)) {
    return res.status(403).json({
      success: false,
      error: true,
      message: 'Access denied. Director or IT only.',
    });
  }
  next();
};

activityLogRouter.get('/summary', auth, directorOrIT, getActivitySummary);
activityLogRouter.get('/actions', auth, directorOrIT, getActionTypes);
activityLogRouter.get('/', auth, directorOrIT, getActivityLogs);

export default activityLogRouter;
