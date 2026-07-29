// server/route/activity-log.route.js
import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  getActivityLogs,
  getActivitySummary,
  getActionTypes,
} from '../controllers/activityLog.controller.js';

const activityLogRouter = Router();

// MANAGER can view the Activity Log (previously IT/DIRECTOR only), scoped
// in the controller via getScopedUserIds():
//   - MANAGER + scope GLOBAL  ("HQ Manager")      → sees HQ staff only, minus IT/DIRECTOR
//   - MANAGER + scope COUNTRY ("Foreign Manager") → sees their own country's staff only, minus IT/DIRECTOR
// IT/DIRECTOR remain unrestricted. Any other subRole is denied outright here.
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
