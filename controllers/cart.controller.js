import CartProductModel from '../models/cartproduct.model.js';
import ProductModel from '../models/product.model.js';
import UserModel from '../models/user.model.js';

// Helper function to get effective stock
const getEffectiveStock = (product) => {
  if (
    product.warehouseStock?.enabled &&
    product.warehouseStock.onlineStock !== undefined
  ) {
    return product.warehouseStock.onlineStock;
  }
  return product.stock || 0;
};

export const addToCartItemController = async (request, response) => {
  try {
    const userId = request.userId;
    const { productId, quantity = 1, priceOption } = request.body;

    if (!productId) {
      return response.status(402).json({
        message: 'Provide productId',
        error: true,
        success: false,
      });
    }

    // Get product details with stock information
    const product = await ProductModel.findById(productId);

    if (!product) {
      return response.status(404).json({
        message: 'Product not found',
        error: true,
        success: false,
      });
    }

    // Check if product is available for production
    if (!product.productAvailability) {
      return response.status(400).json({
        message: 'This product is not available for production',
        error: true,
        success: false,
      });
    }

    // Get effective stock
    const effectiveStock = getEffectiveStock(product);

    // Check if there's existing cart item
    const checkItemCart = await CartProductModel.findOne({
      userId: userId,
      productId: productId,
    });

    if (checkItemCart) {
      // Update quantity instead of returning error
      const newQuantity = checkItemCart.quantity + quantity;

      // Validate stock for updated quantity (only for regular delivery)
      if (priceOption === 'regular' || !priceOption) {
        if (newQuantity > effectiveStock) {
          return response.status(400).json({
            message: `Cannot add ${quantity} more items. Only ${
              effectiveStock - checkItemCart.quantity
            } available`,
            error: true,
            success: false,
            availableStock: effectiveStock - checkItemCart.quantity,
          });
        }
      }

      checkItemCart.quantity = newQuantity;
      if (priceOption) {
        checkItemCart.priceOption = priceOption;
      }

      const updatedItem = await checkItemCart.save();

      return response.json({
        data: updatedItem,
        message: 'Cart updated successfully',
        error: false,
        success: true,
      });
    }

    // Validate stock for new item (only for regular delivery)
    if (priceOption === 'regular' || !priceOption) {
      if (quantity > effectiveStock) {
        return response.status(400).json({
          message: `Cannot add ${quantity} items. Only ${effectiveStock} available`,
          error: true,
          success: false,
          availableStock: effectiveStock,
        });
      }
    }

    // Create new cart item
    const cartItem = new CartProductModel({
      quantity: quantity,
      userId: userId,
      productId: productId,
      priceOption: priceOption || 'regular',
    });

    const save = await cartItem.save();

    // Update user's shopping cart
    const updateCartUser = await UserModel.updateOne(
      { _id: userId },
      {
        $push: {
          shopping_cart: productId,
        },
      }
    );

    return response.json({
      data: save,
      message: 'Item added successfully',
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

export const getCartItemController = async (request, response) => {
  try {
    const userId = request.userId;

    const cartItem = await CartProductModel.find({
      userId: userId,
    }).populate('productId');

    // Filter out cart items for products that are no longer available
    const validCartItems = cartItem.filter(
      (item) => item.productId && item.productId.productAvailability
    );

    // Remove invalid cart items from database
    const invalidItems = cartItem.filter(
      (item) => !item.productId || !item.productId.productAvailability
    );

    if (invalidItems.length > 0) {
      const invalidIds = invalidItems.map((item) => item._id);
      await CartProductModel.deleteMany({ _id: { $in: invalidIds } });

      // Update user's shopping cart
      const validProductIds = validCartItems.map((item) => item.productId._id);
      await UserModel.updateOne(
        { _id: userId },
        { shopping_cart: validProductIds }
      );
    }

    return response.json({
      data: validCartItems,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

export const updateCartItemQtyController = async (request, response) => {
  try {
    const userId = request.userId;
    const { _id, qty } = request.body;

    if (!_id || !qty) {
      return response.status(400).json({
        message: 'provide _id, qty',
        error: true,
        success: false,
      });
    }

    if (qty <= 0) {
      return response.status(400).json({
        message: 'Quantity must be greater than 0',
        error: true,
        success: false,
      });
    }

    // Get cart item with product details
    const cartItem = await CartProductModel.findOne({
      _id: _id,
      userId: userId,
    }).populate('productId');

    if (!cartItem) {
      return response.status(404).json({
        message: 'Cart item not found',
        error: true,
        success: false,
      });
    }

    if (!cartItem.productId.productAvailability) {
      return response.status(400).json({
        message: 'Product is no longer available',
        error: true,
        success: false,
      });
    }

    // Validate stock (only for regular delivery)
    if (cartItem.priceOption === 'regular' || !cartItem.priceOption) {
      const effectiveStock = getEffectiveStock(cartItem.productId);

      if (qty > effectiveStock) {
        return response.status(400).json({
          message: `Cannot update quantity to ${qty}. Only ${effectiveStock} available`,
          error: true,
          success: false,
          availableStock: effectiveStock,
        });
      }
    }

    const updateCartitem = await CartProductModel.updateOne(
      {
        _id: _id,
        userId: userId,
      },
      {
        quantity: qty,
      }
    );

    return response.json({
      message: 'Cart updated successfully',
      success: true,
      error: false,
      data: updateCartitem,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

export const deleteCartItemQtyController = async (request, response) => {
  try {
    const userId = request.userId;
    const { _id } = request.body;

    if (!_id) {
      return response.status(400).json({
        message: 'Provide _id',
        error: true,
        success: false,
      });
    }

    // Get cart item to get product ID for user cart update
    const cartItem = await CartProductModel.findOne({
      _id: _id,
      userId: userId,
    });

    if (!cartItem) {
      return response.status(404).json({
        message: 'Cart item not found',
        error: true,
        success: false,
      });
    }

    const deleteCartItem = await CartProductModel.deleteOne({
      _id: _id,
      userId: userId,
    });

    // Update user's shopping cart
    await UserModel.updateOne(
      { _id: userId },
      {
        $pull: { shopping_cart: cartItem.productId },
      }
    );

    return response.json({
      message: 'Item removed successfully',
      error: false,
      success: true,
      data: deleteCartItem,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// New controller to validate cart items stock
export const validateCartController = async (request, response) => {
  try {
    const userId = request.userId;

    const cartItems = await CartProductModel.find({
      userId: userId,
    }).populate('productId');

    const validationResults = [];
    const itemsToRemove = [];

    for (const item of cartItems) {
      if (!item.productId || !item.productId.productAvailability) {
        itemsToRemove.push(item._id);
        validationResults.push({
          cartItemId: item._id,
          productId: item.productId?._id || null,
          productName: item.productId?.name || 'Unknown Product',
          status: 'removed',
          reason: 'Product no longer available',
        });
        continue;
      }

      // Check stock only for regular delivery
      if (item.priceOption === 'regular' || !item.priceOption) {
        const effectiveStock = getEffectiveStock(item.productId);

        if (item.quantity > effectiveStock) {
          validationResults.push({
            cartItemId: item._id,
            productId: item.productId._id,
            productName: item.productId.name,
            currentQuantity: item.quantity,
            availableStock: effectiveStock,
            status: 'stock_issue',
            reason:
              effectiveStock === 0 ? 'Out of stock' : 'Insufficient stock',
          });
        } else {
          validationResults.push({
            cartItemId: item._id,
            productId: item.productId._id,
            productName: item.productId.name,
            status: 'valid',
          });
        }
      } else {
        // For non-regular delivery options, always valid
        validationResults.push({
          cartItemId: item._id,
          productId: item.productId._id,
          productName: item.productId.name,
          status: 'valid',
        });
      }
    }

    // Remove invalid items
    if (itemsToRemove.length > 0) {
      await CartProductModel.deleteMany({ _id: { $in: itemsToRemove } });

      // Update user's shopping cart
      const validItems = await CartProductModel.find({ userId }).populate(
        'productId'
      );
      const validProductIds = validItems.map((item) => item.productId._id);
      await UserModel.updateOne(
        { _id: userId },
        { shopping_cart: validProductIds }
      );
    }

    return response.json({
      message: 'Cart validation completed',
      data: validationResults,
      removedItems: itemsToRemove.length,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
