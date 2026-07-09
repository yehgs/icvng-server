// server/route/fomo.route.js
import { Router } from 'express';
import auth from '../middleware/auth.js';
import { countryScope } from '../middleware/countryScope.js';
import {
  getFomoSettings,
  updateFomoSettings,
  addDummyUser,
  updateDummyUser,
  deleteDummyUser,
  getRecentPurchases,
} from '../controllers/fomo.controller.js';

const fomoRouter = Router();

// Public — client widget fetches this, scoped to the visited domain's
// country (falls back to HQ/Nigeria if that market hasn't configured FOMO).
fomoRouter.get('/settings',         getFomoSettings);
fomoRouter.get('/recent-purchases', getRecentPurchases);

// Admin — protected. countryScope activates the model's built-in
// per-country isolation: a country-assigned editor (e.g. an editor tagged
// to Togo) only ever sees/edits Togo's FOMO settings and dummy users; a
// GLOBAL admin can target any country explicitly via ?countryCode=.
fomoRouter.get('/admin/settings',   auth, countryScope, getFomoSettings);
fomoRouter.put('/settings',         auth, countryScope, updateFomoSettings);
fomoRouter.post('/dummy-user',      auth, countryScope, addDummyUser);
fomoRouter.put('/dummy-user',       auth, countryScope, updateDummyUser);
fomoRouter.delete('/dummy-user',    auth, countryScope, deleteDummyUser);

export default fomoRouter;
