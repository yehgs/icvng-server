// server/route/fomo.route.js
import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  getFomoSettings,
  updateFomoSettings,
  addDummyUser,
  updateDummyUser,
  deleteDummyUser,
  getRecentPurchases,
} from '../controllers/fomo.controller.js';

const fomoRouter = Router();

// Public — client widget fetches this
fomoRouter.get('/settings',         getFomoSettings);
fomoRouter.get('/recent-purchases', getRecentPurchases);

// Admin — protected
fomoRouter.put('/settings',         auth, updateFomoSettings);
fomoRouter.post('/dummy-user',      auth, addDummyUser);
fomoRouter.put('/dummy-user',       auth, updateDummyUser);
fomoRouter.delete('/dummy-user',    auth, deleteDummyUser);

export default fomoRouter;
