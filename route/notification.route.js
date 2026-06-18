//server
// route/notification.route.js
import { Router } from 'express';
import auth from '../middleware/auth.js';
import adminAuth from '../middleware/adminAuth.js';
import {
  getNotificationsController,
  markNotificationReadController,
  markAllNotificationsReadController,
  createNotificationController,
  deleteNotificationController,
  getUnreadCountController,
} from '../controllers/notification.controller.js';

const notificationRouter = Router();
notificationRouter.use(auth);
notificationRouter.use(adminAuth);

notificationRouter.get('/', getNotificationsController);
notificationRouter.get('/count', getUnreadCountController);
notificationRouter.post('/', createNotificationController);
notificationRouter.put('/mark-all-read', markAllNotificationsReadController);
notificationRouter.put('/:id/read', markNotificationReadController);
notificationRouter.delete('/:id', deleteNotificationController);

export default notificationRouter;
