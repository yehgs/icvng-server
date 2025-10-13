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
    const userId = request.userId; // This can be null for guest users
    const { productId, quantity = 1, priceOption } = request.body;

    if (!productId) {
      return response.status(400).json({
        message: 'Provide productId',
        error: true,
        success: false,
      });
    }

    // Get product details
    const product = await ProductModel.findById(productId);

    if (!product) {
      return response.status(404).json({
        message: 'Product not found',
        error: true,
        success: false,
      });
    }

    // Only check productAvailability - users can order even if stock is 0
    if (!product.productAvailability) {
      return response.status(400).json({
        message: 'This product is not available for production',
        error: true,
        success: false,
      });
    }

    // For guest users, just return success (cart will be managed in localStorage)
    if (!userId) {
      return response.json({
        message: 'Item prepared for cart (guest mode)',
        error: false,
        success: true,
        guestMode: true,
        productData: {
          productId: product._id,
          quantity: quantity,
          priceOption: priceOption || 'regular',
          price: product.btcPrice,
          discount: product.discount || 0,
          name: product.name,
          image: product.image,
          stock: getEffectiveStock(product),
          productAvailability: product.productAvailability,
        },
      });
    }

    // Check if there's existing cart item for logged-in users
    const checkItemCart = await CartProductModel.findOne({
      userId: userId,
      productId: productId,
      priceOption: priceOption || 'regular', // Include priceOption in uniqueness check
    });

    if (checkItemCart) {
      // Update quantity
      const newQuantity = checkItemCart.quantity + quantity;
      checkItemCart.quantity = newQuantity;

      // Update selected price based on current product pricing
      await checkItemCart.updatePriceFromProduct();

      const updatedItem = await checkItemCart.save();

      return response.json({
        data: updatedItem,
        message: 'Cart updated successfully',
        error: false,
        success: true,
      });
    }

    // Create new cart item for logged-in users
    const cartItem = new CartProductModel({
      quantity: quantity,
      userId: userId,
      productId: productId,
      priceOption: priceOption || 'regular',
    });

    // Update selected price from product
    await cartItem.updatePriceFromProduct();

    const save = await cartItem.save();

    // Update user's shopping cart (only if not already present)
    const user = await UserModel.findById(userId);
    if (!user.shopping_cart.includes(productId)) {
      await UserModel.updateOne(
        { _id: userId },
        {
          $addToSet: {
            shopping_cart: productId,
          },
        }
      );
    }

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

    // For guest users, return empty cart with guest mode flag
    if (!userId) {
      return response.json({
        data: [],
        error: false,
        success: true,
        guestMode: true,
        message: 'Guest cart - manage in localStorage',
      });
    }

    const cartItems = await CartProductModel.find({
      userId: userId,
    }).populate('productId');

    // Filter out cart items for products that are no longer available for production
    const validCartItems = cartItems.filter(
      (item) => item.productId && item.productId.productAvailability
    );

    // Remove invalid cart items from database
    const invalidItems = cartItems.filter(
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

    // Update prices for all cart items to reflect current product pricing
    for (const item of validCartItems) {
      try {
        await item.updatePriceFromProduct();
      } catch (error) {
        console.error('Error updating cart item price:', error);
      }
    }

    return response.json({
      data: validCartItems,
      error: false,
      success: true,
      message: validCartItems.length ? 'Cart items retrieved' : 'Cart is empty',
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

    if (!userId) {
      return response.status(401).json({
        message: 'Login required to update cart',
        error: true,
        success: false,
      });
    }

    if (!_id || qty === undefined || qty === null) {
      return response.status(400).json({
        message: 'Provide _id and qty',
        error: true,
        success: false,
      });
    }

    if (qty < 0) {
      return response.status(400).json({
        message: 'Quantity cannot be negative',
        error: true,
        success: false,
      });
    }

    // If quantity is 0, delete the item
    if (qty === 0) {
      const deletedItem = await CartProductModel.findOneAndDelete({
        _id: _id,
        userId: userId,
      });

      if (!deletedItem) {
        return response.status(404).json({
          message: 'Cart item not found',
          error: true,
          success: false,
        });
      }

      // Update user's shopping cart
      await UserModel.updateOne(
        { _id: userId },
        {
          $pull: { shopping_cart: deletedItem.productId },
        }
      );

      return response.json({
        message: 'Item removed from cart',
        success: true,
        error: false,
        data: { deleted: true, _id: _id },
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

    // Only check productAvailability
    if (!cartItem.productId.productAvailability) {
      return response.status(400).json({
        message: 'Product is no longer available for production',
        error: true,
        success: false,
      });
    }

    // Update quantity and price
    cartItem.quantity = qty;
    await cartItem.updatePriceFromProduct();
    const updatedItem = await cartItem.save();

    return response.json({
      message: 'Cart updated successfully',
      success: true,
      error: false,
      data: updatedItem,
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

    if (!userId) {
      return response.status(401).json({
        message: 'Login required to delete cart item',
        error: true,
        success: false,
      });
    }

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

    // Check if this was the last item of this product in cart
    const remainingItems = await CartProductModel.countDocuments({
      userId: userId,
      productId: cartItem.productId,
    });

    // Only remove from user's shopping cart if no more items of this product exist
    if (remainingItems === 0) {
      await UserModel.updateOne(
        { _id: userId },
        {
          $pull: { shopping_cart: cartItem.productId },
        }
      );
    }

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

// Updated validate cart controller - only checks productAvailability
export const validateCartController = async (request, response) => {
  try {
    const userId = request.userId;

    if (!userId) {
      return response.json({
        message: 'Guest mode - cart validation handled in frontend',
        data: [],
        removedItems: 0,
        error: false,
        success: true,
        guestMode: true,
      });
    }

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
          reason: 'Product no longer available for production',
        });
        continue;
      }

      // Update price to reflect current pricing
      try {
        await item.updatePriceFromProduct();
        await item.save();
      } catch (error) {
        console.error('Error updating item price during validation:', error);
      }

      // All items with productAvailability = true are valid
      validationResults.push({
        cartItemId: item._id,
        productId: item.productId._id,
        productName: item.productId.name,
        status: 'valid',
        currentPrice: item.selectedPrice,
        quantity: item.quantity,
      });
    }

    // Remove invalid items
    if (itemsToRemove.length > 0) {
      await CartProductModel.deleteMany({ _id: { $in: itemsToRemove } });

      // Update user's shopping cart
      const validItems = await CartProductModel.find({ userId }).populate(
        'productId'
      );
      const validProductIds = [
        ...new Set(validItems.map((item) => item.productId._id)),
      ];
      await UserModel.updateOne(
        { _id: userId },
        { shopping_cart: validProductIds }
      );
    }

    return response.json({
      message: 'Cart validation completed',
      data: validationResults,
      removedItems: itemsToRemove.length,
      updatedItems: validationResults.filter((item) => item.status === 'valid')
        .length,
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

// New function to migrate guest cart to user cart
export const migrateGuestCartController = async (request, response) => {
  try {
    const userId = request.userId;
    const { guestCartItems } = request.body;

    if (!userId) {
      return response.status(401).json({
        message: 'User authentication required',
        error: true,
        success: false,
      });
    }

    if (!guestCartItems || !Array.isArray(guestCartItems)) {
      return response.status(400).json({
        message: 'Provide guestCartItems array',
        error: true,
        success: false,
      });
    }

    let migratedCount = 0;
    let errors = [];

    for (const guestItem of guestCartItems) {
      try {
        const { productId, quantity, priceOption = 'regular' } = guestItem;

        // Verify product exists and is available
        const product = await ProductModel.findById(productId);
        if (!product || !product.productAvailability) {
          errors.push(`Product ${productId} not available for migration`);
          continue;
        }

        // Check if item already exists in user's cart with SAME priceOption
        const existingItem = await CartProductModel.findOne({
          userId: userId,
          productId: productId,
          priceOption: priceOption, // This now matches the unique index
        });

        if (existingItem) {
          // Update quantity
          existingItem.quantity += quantity;
          await existingItem.updatePriceFromProduct();
          await existingItem.save();
        } else {
          // Create new cart item
          const newCartItem = new CartProductModel({
            userId: userId,
            productId: productId,
            quantity: quantity,
            priceOption: priceOption,
          });

          await newCartItem.updatePriceFromProduct();
          await newCartItem.save();

          // Add to user's shopping cart
          await UserModel.updateOne(
            { _id: userId },
            { $addToSet: { shopping_cart: productId } }
          );
        }

        migratedCount++;
      } catch (error) {
        errors.push(
          `Error migrating item ${guestItem.productId}: ${error.message}`
        );
      }
    }

    return response.json({
      message: `Successfully migrated ${migratedCount} items to cart`,
      error: false,
      success: true,
      data: {
        migratedCount,
        totalItems: guestCartItems.length,
        errors: errors.length > 0 ? errors : undefined,
      },
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
