import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  addToCartItemController,
  getCartItemController,
  updateCartItemQtyController,
  deleteCartItemQtyController,
  validateCartController,
} from '../controllers/cart.controller.js';

const cartRouter = Router();

// Add item to cart
cartRouter.post('/create', auth, addToCartItemController);

// Get cart items
cartRouter.get('/get', auth, getCartItemController);

// Update cart item quantity
cartRouter.put('/update-qty', auth, updateCartItemQtyController);

// Delete cart item
cartRouter.delete('/delete-cart-item', auth, deleteCartItemQtyController);

// Validate cart items (check stock, availability)
cartRouter.get('/validate', auth, validateCartController);

export default cartRouter;
