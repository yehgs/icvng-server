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
