import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  addRatingController,
  getRatingsController,
  deleteRatingController,
} from '../controllers/rating.controller.js';

const ratingRouter = Router();

ratingRouter.post('/add', auth, addRatingController);
ratingRouter.get('/get', getRatingsController);
ratingRouter.delete('/delete', auth, deleteRatingController);

export default ratingRouter;
