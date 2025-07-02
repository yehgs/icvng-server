import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  createColorController,
  getColorsController,
  updateColorController,
  deleteColorController,
} from '../controllers/color.controller.js';

const colorRouter = Router();

colorRouter.post('/create', auth, createColorController);
colorRouter.get('/get', getColorsController);
colorRouter.put('/update', auth, updateColorController);
colorRouter.delete('/delete', auth, deleteColorController);

export default colorRouter;
