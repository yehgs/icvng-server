import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  addBannerController,
  deleteBannerController,
  getBannerController,
  getActiveBannersController,
  updateBannerController,
} from '../controllers/banner.controller.js';

const bannerRouter = Router();

bannerRouter.post('/add', auth, addBannerController);
bannerRouter.get('/get', getBannerController);
bannerRouter.get('/active', getActiveBannersController);
bannerRouter.put('/update', auth, updateBannerController);
bannerRouter.delete('/delete', auth, deleteBannerController);

export default bannerRouter;
