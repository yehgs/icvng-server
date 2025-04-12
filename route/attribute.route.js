import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  addAttributeController,
  getAttributesController,
  updateAttributeController,
  deleteAttributeController,
} from '../controllers/attribute.controller.js';

const attributeRouter = Router();

attributeRouter.post('/add', auth, addAttributeController);
attributeRouter.get('/get', getAttributesController);
attributeRouter.put('/update', auth, updateAttributeController);
attributeRouter.delete('/delete', auth, deleteAttributeController);

export default attributeRouter;
