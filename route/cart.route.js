import { Router } from 'express';
import auth, { optionalAuth } from '../middleware/auth.js';
import {
  addToCartItemController,
  getCartItemController,
  updateCartItemQtyController,
  deleteCartItemQtyController,
  validateCartController,
  migrateGuestCartController,
} from '../controllers/cart.controller.js';

const cartRouter = Router();

// Add item to cart (guests can add to localStorage, logged-in users to DB)
cartRouter.post('/create', optionalAuth, addToCartItemController);

// Get cart items (guests get empty array, logged-in users get DB data)
cartRouter.get('/get', optionalAuth, getCartItemController);

// Update cart item quantity (requires login)
cartRouter.put('/update-qty', auth, updateCartItemQtyController);

// Delete cart item (requires login)
cartRouter.delete('/delete-cart-item', auth, deleteCartItemQtyController);

// Validate cart items (optional auth)
cartRouter.get('/validate', optionalAuth, validateCartController);

// Migrate guest cart to user account (requires login)
cartRouter.post('/migrate-guest-cart', auth, migrateGuestCartController);

export default cartRouter;
