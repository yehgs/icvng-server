// routes/compare.route.js
import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  addToCompareController,
  removeFromCompareController,
  getCompareListController,
  toggleCompareController,
  clearCompareListController,
  checkCompareController,
} from '../controllers/compare.controller.js';

const compareRouter = Router();

// Add product to compare list
compareRouter.post('/add', auth, addToCompareController);

// Remove product from compare list
compareRouter.delete('/remove', auth, removeFromCompareController);

// Get user's compare list
compareRouter.get('/get', auth, getCompareListController);

// Toggle product in compare list
compareRouter.post('/toggle', auth, toggleCompareController);

// Clear entire compare list
compareRouter.delete('/clear', auth, clearCompareListController);

// Check if product is in compare list
compareRouter.get('/check/:productId', auth, checkCompareController);

export default compareRouter;
