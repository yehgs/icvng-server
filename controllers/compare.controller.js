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

    // For guest users, return success (compare will be managed in localStorage)
    if (!userId) {
      return response.json({
        message: 'Product prepared for compare (guest mode)',
        error: false,
        success: true,
        guestMode: true,
        productData: {
          _id: product._id,
          name: product.name,
          image: product.image,
          price: product.price,
          price3weeksDelivery: product.price3weeksDelivery,
          price5weeksDelivery: product.price5weeksDelivery,
          discount: product.discount || 0,
          weight: product.weight,
          packaging: product.packaging,
          productType: product.productType,
          roastLevel: product.roastLevel,
          intensity: product.intensity,
          blend: product.blend,
          coffeeOrigin: product.coffeeOrigin,
          aromaticProfile: product.aromaticProfile,
          averageRating: product.averageRating,
          productAvailability: product.productAvailability,
          sku: product.sku,
          category: product.category,
          subCategory: product.subCategory,
          brand: product.brand,
        },
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

    // For guest users, return success (handled in frontend)
    if (!userId) {
      return response.json({
        message: 'Product removed from compare (guest mode)',
        error: false,
        success: true,
        guestMode: true,
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

    // For guest users, return empty array with guest mode flag
    if (!userId) {
      return response.json({
        message: 'Guest compare list - manage in localStorage',
        data: [],
        success: true,
        error: false,
        guestMode: true,
      });
    }

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

    // For guest users, return success with product data
    if (!userId) {
      return response.json({
        message: 'Toggle compare (guest mode)',
        error: false,
        success: true,
        guestMode: true,
        action: 'toggle', // Frontend will determine actual action
        productData: {
          _id: product._id,
          name: product.name,
          image: product.image,
          price: product.price,
          price3weeksDelivery: product.price3weeksDelivery,
          price5weeksDelivery: product.price5weeksDelivery,
          discount: product.discount || 0,
          weight: product.weight,
          packaging: product.packaging,
          productType: product.productType,
          roastLevel: product.roastLevel,
          intensity: product.intensity,
          blend: product.blend,
          coffeeOrigin: product.coffeeOrigin,
          aromaticProfile: product.aromaticProfile,
          averageRating: product.averageRating,
          productAvailability: product.productAvailability,
          sku: product.sku,
          category: product.category,
          subCategory: product.subCategory,
          brand: product.brand,
        },
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

    // For guest users, return success (handled in frontend)
    if (!userId) {
      return response.json({
        message: 'Compare list cleared (guest mode)',
        success: true,
        error: false,
        guestMode: true,
      });
    }

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

    // For guest users, return false (frontend will handle localStorage check)
    if (!userId) {
      return response.json({
        isInCompare: false,
        success: true,
        error: false,
        guestMode: true,
        message: 'Guest mode - check localStorage in frontend',
      });
    }

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

// Migrate guest compare list to user account
export const migrateGuestCompareController = async (request, response) => {
  try {
    const userId = request.userId;
    const { guestCompareItems } = request.body;

    if (!userId) {
      return response.status(401).json({
        message: 'User authentication required',
        error: true,
        success: false,
      });
    }

    if (!guestCompareItems || !Array.isArray(guestCompareItems)) {
      return response.status(400).json({
        message: 'Provide guestCompareItems array',
        error: true,
        success: false,
      });
    }

    // Check if adding guest items would exceed the limit
    const currentCount = await CompareModel.countDocuments({ userId });
    const totalAfterMigration = currentCount + guestCompareItems.length;

    if (totalAfterMigration > 4) {
      return response.status(400).json({
        message: `Cannot migrate ${guestCompareItems.length} items. Would exceed 4 item limit. Current: ${currentCount}`,
        error: true,
        success: false,
      });
    }

    let migratedCount = 0;
    let skippedCount = 0;
    let errors = [];

    for (const guestItem of guestCompareItems) {
      try {
        const productId = guestItem._id || guestItem.productId;

        if (!productId) {
          errors.push('Invalid product ID in guest compare list');
          continue;
        }

        // Verify product exists
        const product = await ProductModel.findById(productId);
        if (!product) {
          errors.push(`Product ${productId} not found`);
          continue;
        }

        // Check if item already exists in user's compare list
        const existingItem = await CompareModel.findOne({
          userId: userId,
          productId: productId,
        });

        if (existingItem) {
          skippedCount++;
          continue; // Skip if already in compare list
        }

        // Create new compare item
        const newCompareItem = new CompareModel({
          userId: userId,
          productId: productId,
        });

        await newCompareItem.save();
        migratedCount++;
      } catch (error) {
        errors.push(`Error migrating compare item: ${error.message}`);
      }
    }

    return response.json({
      message: `Successfully migrated ${migratedCount} items to compare list`,
      error: false,
      success: true,
      data: {
        migratedCount,
        skippedCount,
        totalItems: guestCompareItems.length,
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
