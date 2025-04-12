import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  AddBrandController,
  deleteBrandController,
  getBrandController,
  updateBrandController,
} from '../controllers/brand.controller.js';

const brandRouter = Router();

brandRouter.post('/add-brand', auth, AddBrandController);
brandRouter.get('/get', getBrandController);
brandRouter.put('/update', auth, updateBrandController);
brandRouter.delete('/delete', auth, deleteBrandController);

export default brandRouter;
