import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  updateCompatibleSystemController,
  getCompatibleSystemStructureController,
} from '../controllers/compatible.controller.js';

const compatibleRouter = Router();

// Public — used by header nav + shop filter
compatibleRouter.get('/structure', getCompatibleSystemStructureController);

// Auth-protected — update product's compatibleSystem (legacy)
compatibleRouter.put('/update-compatible', auth, updateCompatibleSystemController);

export default compatibleRouter;
