import { Router } from 'express';
import auth from '../middleware/auth.js';
import { admin } from '../middleware/Admin.js';
import { countryScope } from '../middleware/countryScope.js';
import {
  addRatingController,
  updateRatingController,
  getRatingsController,
  deleteRatingController,
  getAllRatingsAdminController,
} from '../controllers/rating.controller.js';

const ratingRouter = Router();

// User routes
ratingRouter.post('/add', auth, addRatingController);
ratingRouter.put('/update', auth, updateRatingController);
ratingRouter.get('/get', getRatingsController);
ratingRouter.delete('/delete', auth, deleteRatingController);

// Admin routes
ratingRouter.get('/admin/all', auth, admin, countryScope, getAllRatingsAdminController);

export default ratingRouter;
