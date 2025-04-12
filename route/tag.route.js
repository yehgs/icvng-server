import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  addTagController,
  getTagsController,
  updateTagController,
  deleteTagController,
} from '../controllers/tag.controller.js';

const tagRouter = Router();

tagRouter.post('/add', auth, addTagController);
tagRouter.get('/get', getTagsController);
tagRouter.put('/update', auth, updateTagController);
tagRouter.delete('/delete', auth, deleteTagController);

export default tagRouter;
