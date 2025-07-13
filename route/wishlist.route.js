import { Router } from 'express';
import { optionalAuth } from '../middleware/auth.js';
import {
  addToWishlistController,
  removeFromWishlistController,
  getWishlistController,
  toggleWishlistController,
  clearWishlistController,
  checkWishlistController,
  migrateGuestWishlistController,
} from '../controllers/wishlist.controller.js';

const wishlistRouter = Router();

// Add product to wishlist (optional auth for guest support)
wishlistRouter.post('/add', optionalAuth, addToWishlistController);

// Remove product from wishlist (optional auth for guest support)
wishlistRouter.delete('/remove', optionalAuth, removeFromWishlistController);

// Get user's wishlist (optional auth for guest support)
wishlistRouter.get('/get', optionalAuth, getWishlistController);

// Toggle product in wishlist (optional auth for guest support)
wishlistRouter.post('/toggle', optionalAuth, toggleWishlistController);

// Clear entire wishlist (optional auth for guest support)
wishlistRouter.delete('/clear', optionalAuth, clearWishlistController);

// Check if product is in wishlist (optional auth for guest support)
wishlistRouter.get('/check/:productId', optionalAuth, checkWishlistController);

// Migrate guest wishlist to user account (requires login)
wishlistRouter.post(
  '/migrate-guest-wishlist',
  optionalAuth,
  migrateGuestWishlistController
);

export default wishlistRouter;
