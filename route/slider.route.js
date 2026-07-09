import { Router } from 'express';
import auth from '../middleware/auth.js';
import { countryScope, assertCountryAccess } from '../middleware/countryScope.js';
import {
  addSliderController,
  getSlidersController,
  getActiveSlidersController,
  updateSliderController,
  deleteSliderController,
} from '../controllers/slider.controller.js';

const sliderRouter = Router();

// Admin routes (protected) — countryScope activates per-country isolation
// (countryScopedPlugin): a country-assigned editor only sees/edits their
// own market's sliders; a GLOBAL admin sees everything and can target any
// country explicitly via body.countryCode.
sliderRouter.post('/add', auth, countryScope, assertCountryAccess('body.countryCode'), addSliderController);
sliderRouter.get('/all', auth, countryScope, getSlidersController);
sliderRouter.put('/update', auth, countryScope, updateSliderController);
sliderRouter.delete('/delete', auth, countryScope, deleteSliderController);

// Public route (unprotected) — filtered by the visited domain's country in
// the controller, falling back to HQ (Nigeria) if unset for that market.
sliderRouter.get('/active', getActiveSlidersController);

export default sliderRouter;
