import CompareModel from '../models/compare.model.js';
import ProductModel from '../models/product.model.js';

// Add product to compare list
export const addToCompareController = async (request, response) => {
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

    // Check compare list count (limit to 4 items)
    const compareCount = await CompareModel.countDocuments({ userId });
    if (compareCount >= 4) {
      return response.status(400).json({
        message: 'You can only compare up to 4 products',
        error: true,
        success: false,
      });
    }

    // Check if already in compare list
    const existingCompareItem = await CompareModel.findOne({
      userId,
      productId,
    });

    if (existingCompareItem) {
      return response.status(400).json({
        message: 'Product already in compare list',
        error: true,
        success: false,
      });
    }

    // Add to compare list
    const compareItem = new CompareModel({
      userId,
      productId,
    });

    const savedCompareItem = await compareItem.save();

    return response.json({
      message: 'Product added to compare list successfully',
      data: savedCompareItem,
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

// Remove product from compare list
export const removeFromCompareController = async (request, response) => {
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

    const deletedItem = await CompareModel.findOneAndDelete({
      userId,
      productId,
    });

    if (!deletedItem) {
      return response.status(404).json({
        message: 'Product not found in compare list',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: 'Product removed from compare list successfully',
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

// Get user's compare list
export const getCompareListController = async (request, response) => {
  try {
    const userId = request.userId;

    const compareItems = await CompareModel.find({ userId })
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
    const validCompareItems = compareItems.filter((item) => item.productId);

    return response.json({
      message: 'Compare list retrieved successfully',
      data: validCompareItems.map((item) => item.productId),
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

// Toggle product in compare list (add if not exists, remove if exists)
export const toggleCompareController = async (request, response) => {
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

    // Check if already in compare list
    const existingCompareItem = await CompareModel.findOne({
      userId,
      productId,
    });

    if (existingCompareItem) {
      // Remove from compare list
      await CompareModel.findOneAndDelete({ userId, productId });

      return response.json({
        message: 'Product removed from compare list',
        action: 'removed',
        success: true,
        error: false,
      });
    } else {
      // Check compare list count (limit to 4 items)
      const compareCount = await CompareModel.countDocuments({ userId });
      if (compareCount >= 4) {
        return response.status(400).json({
          message: 'You can only compare up to 4 products',
          error: true,
          success: false,
        });
      }

      // Add to compare list
      const compareItem = new CompareModel({
        userId,
        productId,
      });

      await compareItem.save();

      return response.json({
        message: 'Product added to compare list',
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

// Clear entire compare list
export const clearCompareListController = async (request, response) => {
  try {
    const userId = request.userId;

    const result = await CompareModel.deleteMany({ userId });

    return response.json({
      message: `Cleared ${result.deletedCount} items from compare list`,
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

// Check if product is in compare list
export const checkCompareController = async (request, response) => {
  try {
    const { productId } = request.params;
    const userId = request.userId;

    const existingCompareItem = await CompareModel.findOne({
      userId,
      productId,
    });

    return response.json({
      isInCompare: !!existingCompareItem,
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
