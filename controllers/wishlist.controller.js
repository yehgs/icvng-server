import WishlistModel from '../models/wishlist.model.js';
import ProductModel from '../models/product.model.js';

// Add product to wishlist
export const addToWishlistController = async (request, response) => {
  try {
    const { productId } = request.body;
    const userId = request.userId; // from auth middleware

    if (!productId) {
      return response.status(400).json({
        message: 'Product ID is required',
        error: true,
        success: false,
      });
    }

    // Check if product exists
    const product = await ProductModel.findById(productId);
    if (!product) {
      return response.status(404).json({
        message: 'Product not found',
        error: true,
        success: false,
      });
    }

    // For guest users, return success (wishlist will be managed in localStorage)
    if (!userId) {
      return response.json({
        message: 'Product prepared for wishlist (guest mode)',
        error: false,
        success: true,
        guestMode: true,
        productData: {
          _id: product._id,
          name: product.name,
          image: product.image,
          price: product.price,
          discount: product.discount || 0,
          productAvailability: product.productAvailability,
          sku: product.sku,
          productType: product.productType,
        },
      });
    }

    // Check if already in wishlist
    const existingWishlistItem = await WishlistModel.findOne({
      userId,
      productId,
    });

    if (existingWishlistItem) {
      return response.status(400).json({
        message: 'Product already in wishlist',
        error: true,
        success: false,
      });
    }

    // Add to wishlist
    const wishlistItem = new WishlistModel({
      userId,
      productId,
    });

    const savedWishlistItem = await wishlistItem.save();

    return response.json({
      message: 'Product added to wishlist successfully',
      data: savedWishlistItem,
      success: true,
      error: false,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// Remove product from wishlist
export const removeFromWishlistController = async (request, response) => {
  try {
    const { productId } = request.body;
    const userId = request.userId;

    if (!productId) {
      return response.status(400).json({
        message: 'Product ID is required',
        error: true,
        success: false,
      });
    }

    // For guest users, return success (handled in frontend)
    if (!userId) {
      return response.json({
        message: 'Product removed from wishlist (guest mode)',
        error: false,
        success: true,
        guestMode: true,
      });
    }

    const deletedItem = await WishlistModel.findOneAndDelete({
      userId,
      productId,
    });

    if (!deletedItem) {
      return response.status(404).json({
        message: 'Product not found in wishlist',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: 'Product removed from wishlist successfully',
      success: true,
      error: false,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// Get user's wishlist
export const getWishlistController = async (request, response) => {
  try {
    const userId = request.userId;

    // For guest users, return empty array with guest mode flag
    if (!userId) {
      return response.json({
        message: 'Guest wishlist - manage in localStorage',
        data: [],
        success: true,
        error: false,
        guestMode: true,
      });
    }

    const wishlistItems = await WishlistModel.find({ userId })
      .populate({
        path: 'productId',
        populate: [
          {
            path: 'category',
            select: 'name',
          },
          {
            path: 'subCategory',
            select: 'name',
          },
          {
            path: 'brand',
            select: 'name image',
          },
        ],
      })
      .sort({ createdAt: -1 });

    // Filter out any items where product might have been deleted
    const validWishlistItems = wishlistItems.filter((item) => item.productId);

    return response.json({
      message: 'Wishlist retrieved successfully',
      data: validWishlistItems.map((item) => item.productId),
      success: true,
      error: false,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// Toggle product in wishlist (add if not exists, remove if exists)
export const toggleWishlistController = async (request, response) => {
  try {
    const { productId } = request.body;
    const userId = request.userId;

    if (!productId) {
      return response.status(400).json({
        message: 'Product ID is required',
        error: true,
        success: false,
      });
    }

    // Check if product exists
    const product = await ProductModel.findById(productId);
    if (!product) {
      return response.status(404).json({
        message: 'Product not found',
        error: true,
        success: false,
      });
    }

    // For guest users, return success with product data
    if (!userId) {
      return response.json({
        message: 'Toggle wishlist (guest mode)',
        error: false,
        success: true,
        guestMode: true,
        action: 'toggle', // Frontend will determine actual action
        productData: {
          _id: product._id,
          name: product.name,
          image: product.image,
          price: product.price,
          discount: product.discount || 0,
          productAvailability: product.productAvailability,
          sku: product.sku,
          productType: product.productType,
        },
      });
    }

    // Check if already in wishlist
    const existingWishlistItem = await WishlistModel.findOne({
      userId,
      productId,
    });

    if (existingWishlistItem) {
      // Remove from wishlist
      await WishlistModel.findOneAndDelete({ userId, productId });

      return response.json({
        message: 'Product removed from wishlist',
        action: 'removed',
        success: true,
        error: false,
      });
    } else {
      // Add to wishlist
      const wishlistItem = new WishlistModel({
        userId,
        productId,
      });

      await wishlistItem.save();

      return response.json({
        message: 'Product added to wishlist',
        action: 'added',
        success: true,
        error: false,
      });
    }
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// Clear entire wishlist
export const clearWishlistController = async (request, response) => {
  try {
    const userId = request.userId;

    // For guest users, return success (handled in frontend)
    if (!userId) {
      return response.json({
        message: 'Wishlist cleared (guest mode)',
        success: true,
        error: false,
        guestMode: true,
      });
    }

    const result = await WishlistModel.deleteMany({ userId });

    return response.json({
      message: `Cleared ${result.deletedCount} items from wishlist`,
      success: true,
      error: false,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// Check if product is in wishlist
export const checkWishlistController = async (request, response) => {
  try {
    const { productId } = request.params;
    const userId = request.userId;

    // For guest users, return false (frontend will handle localStorage check)
    if (!userId) {
      return response.json({
        isInWishlist: false,
        success: true,
        error: false,
        guestMode: true,
        message: 'Guest mode - check localStorage in frontend',
      });
    }

    const existingWishlistItem = await WishlistModel.findOne({
      userId,
      productId,
    });

    return response.json({
      isInWishlist: !!existingWishlistItem,
      success: true,
      error: false,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// Migrate guest wishlist to user account
export const migrateGuestWishlistController = async (request, response) => {
  try {
    const userId = request.userId;
    const { guestWishlistItems } = request.body;

    if (!userId) {
      return response.status(401).json({
        message: 'User authentication required',
        error: true,
        success: false,
      });
    }

    if (!guestWishlistItems || !Array.isArray(guestWishlistItems)) {
      return response.status(400).json({
        message: 'Provide guestWishlistItems array',
        error: true,
        success: false,
      });
    }

    let migratedCount = 0;
    let skippedCount = 0;
    let errors = [];

    for (const guestItem of guestWishlistItems) {
      try {
        const productId = guestItem._id || guestItem.productId;

        if (!productId) {
          errors.push('Invalid product ID in guest wishlist');
          continue;
        }

        // Verify product exists
        const product = await ProductModel.findById(productId);
        if (!product) {
          errors.push(`Product ${productId} not found`);
          continue;
        }

        // Check if item already exists in user's wishlist
        const existingItem = await WishlistModel.findOne({
          userId: userId,
          productId: productId,
        });

        if (existingItem) {
          skippedCount++;
          continue; // Skip if already in wishlist
        }

        // Create new wishlist item
        const newWishlistItem = new WishlistModel({
          userId: userId,
          productId: productId,
        });

        await newWishlistItem.save();
        migratedCount++;
      } catch (error) {
        errors.push(`Error migrating wishlist item: ${error.message}`);
      }
    }

    return response.json({
      message: `Successfully migrated ${migratedCount} items to wishlist`,
      error: false,
      success: true,
      data: {
        migratedCount,
        skippedCount,
        totalItems: guestWishlistItems.length,
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
