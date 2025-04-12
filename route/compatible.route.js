import { Router } from 'express';
import auth from '../middleware/auth.js';
import { updateCompatibleSystemController } from '../controllers/compatible.controller.js';

const compatibleRouter = Router();

compatibleRouter.put(
  '/update-compatible',
  auth,
  updateCompatibleSystemController
);

export default compatibleRouter;
