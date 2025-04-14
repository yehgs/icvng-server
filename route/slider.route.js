import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  addSliderController,
  getSlidersController,
  getActiveSlidersController,
  updateSliderController,
  deleteSliderController,
} from '../controllers/slider.controller.js';

const sliderRouter = Router();

// Admin routes (protected)
sliderRouter.post('/add', auth, addSliderController);
sliderRouter.get('/all', auth, getSlidersController);
sliderRouter.put('/update', auth, updateSliderController);
sliderRouter.delete('/delete', auth, deleteSliderController);

// Public route (unprotected)
sliderRouter.get('/active', getActiveSlidersController);

export default sliderRouter;
