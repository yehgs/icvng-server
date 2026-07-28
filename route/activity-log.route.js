// server/route/activity-log.route.js
import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  getActivityLogs,
  getActivitySummary,
  getActionTypes,
} from '../controllers/activityLog.controller.js';

const activityLogRouter = Router();

// Item #4: MANAGER can now view the Activity Log (previously IT/DIRECTOR
// only) — but only their own country's entries, enforced in the controller
// via getCountryScopedUserIds(). IT/DIRECTOR remain unrestricted (GLOBAL
// scope). Any other subRole is still denied outright here.
const allowedRoles = (req, res, next) => {
  const allowed = ['DIRECTOR', 'IT', 'MANAGER'];
  if (!req.user || !allowed.includes(req.user.subRole)) {
    return res.status(403).json({
      success: false,
      error: true,
      message: 'Access denied. Director, IT, or Manager only.',
    });
  }
  next();
};

activityLogRouter.get('/summary', auth, allowedRoles, getActivitySummary);
activityLogRouter.get('/actions', auth, allowedRoles, getActionTypes);
activityLogRouter.get('/', auth, allowedRoles, getActivityLogs);

export default activityLogRouter;
