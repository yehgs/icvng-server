import { Router } from 'express';
import auth from '../middleware/auth.js';
import { countryScope, assertCountryAccess } from '../middleware/countryScope.js';
import {
  addBannerController,
  deleteBannerController,
  getBannerController,
  getActiveBannersController,
  updateBannerController,
} from '../controllers/banner.controller.js';

const bannerRouter = Router();

// Admin routes — countryScope activates the model's built-in per-country
// isolation (countryScopedPlugin): a COUNTRY-scoped admin (e.g. an editor
// assigned to Togo) can only see/edit Togo's banners; a GLOBAL admin sees
// everything and can target any country explicitly via body.countryCode.
bannerRouter.post('/add', auth, countryScope, assertCountryAccess('body.countryCode'), addBannerController);
bannerRouter.get('/get', auth, countryScope, getBannerController);
bannerRouter.put('/update', auth, countryScope, assertCountryAccess('body.countryCode'), updateBannerController);
bannerRouter.delete('/delete', auth, countryScope, deleteBannerController);

// Public — storefront widget. Filtered by the visited domain's country in
// the controller, with a fallback to the HQ (Nigeria) banner if that
// country hasn't set one up yet.
bannerRouter.get('/active', getActiveBannersController);

export default bannerRouter;
