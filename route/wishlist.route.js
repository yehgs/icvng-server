// routes/wishlist.route.js
import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  addToWishlistController,
  removeFromWishlistController,
  getWishlistController,
  toggleWishlistController,
  clearWishlistController,
  checkWishlistController,
} from '../controllers/wishlist.controller.js';

const wishlistRouter = Router();

// Add product to wishlist
wishlistRouter.post('/add', auth, addToWishlistController);

// Remove product from wishlist
wishlistRouter.delete('/remove', auth, removeFromWishlistController);

// Get user's wishlist
wishlistRouter.get('/get', auth, getWishlistController);

// Toggle product in wishlist
wishlistRouter.post('/toggle', auth, toggleWishlistController);

// Clear entire wishlist
wishlistRouter.delete('/clear', auth, clearWishlistController);

// Check if product is in wishlist
wishlistRouter.get('/check/:productId', auth, checkWishlistController);

export default wishlistRouter;
