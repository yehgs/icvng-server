// controllers/directPricing.controller.js
import DirectPricingModel from '../models/direct-pricing.model.js';
import ProductModel from '../models/product.model.js';
import mongoose from 'mongoose';

// Create or update direct pricing for a specific product
export const createOrUpdateDirectPricing = async (request, response) => {
  try {
    const { productId, prices, notes } = request.body;

    if (!['ACCOUNTANT', 'DIRECTOR', 'IT'].includes(request.user.subRole)) {
      return response.status(403).json({
        message: 'Only Accountant, Director, or IT can manage direct pricing',
        error: true,
        success: false,
      });
    }

    if (!productId) {
      return response.status(400).json({
        message: 'Product ID is required',
        error: true,
        success: false,
      });
    }

    if (!prices || typeof prices !== 'object') {
      return response.status(400).json({
        message: 'Prices object is required',
        error: true,
        success: false,
      });
    }

    // Validate that at least one price is provided and valid
    const validPriceTypes = [
      'btcPrice',
      'price3weeksDelivery',
      'price5weeksDelivery',
    ];
    const providedPrices = {};
    let hasValidPrice = false;

    validPriceTypes.forEach((priceType) => {
      if (prices[priceType] !== undefined) {
        const price = parseFloat(prices[priceType]);
        if (!isNaN(price) && price >= 0) {
          providedPrices[priceType] = price;
          if (price > 0) hasValidPrice = true;
        }
      }
    });

    if (!hasValidPrice) {
      return response.status(400).json({
        message: 'At least one valid price greater than 0 is required',
        error: true,
        success: false,
      });
    }

    const product = await ProductModel.findById(productId);
    if (!product) {
      return response.status(404).json({
        message: 'Product not found',
        error: true,
        success: false,
      });
    }

    let directPricing = await DirectPricingModel.findOrCreateForProduct(
      productId,
      request.user._id
    );

    directPricing.bulkUpdatePrices(
      providedPrices,
      request.user._id,
      notes || 'Direct price update'
    );

    if (notes) {
      directPricing.notes = notes;
    }

    await directPricing.save();

    // Update the product model with the new prices
    const productUpdateData = {
      updatedBy: request.user._id,
    };

    Object.entries(providedPrices).forEach(([priceType, value]) => {
      if (priceType === 'btcPrice') {
        productUpdateData.btcPrice = value;
      } else if (priceType === 'price3weeksDelivery') {
        productUpdateData.price3weeksDelivery = value;
      } else if (priceType === 'price5weeksDelivery') {
        productUpdateData.price5weeksDelivery = value;
      }
    });

    await ProductModel.findByIdAndUpdate(productId, productUpdateData);

    await directPricing.populate([
      { path: 'product', select: 'name sku productType' },
      { path: 'lastUpdatedBy', select: 'name email' },
      { path: 'approvedBy', select: 'name email' },
    ]);

    return response.json({
      message: 'Direct pricing updated successfully',
      data: {
        directPricing,
        updatedPrices: providedPrices,
        productName: product.name,
        productSku: product.sku,
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Create/Update direct pricing error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to update direct pricing',
      error: true,
      success: false,
    });
  }
};

// Get available products for direct pricing modal
export const getAvailableProductsForDirectPricing = async (
  request,
  response
) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      category,
      brand,
      productType,
    } = request.query;

    const productMatchConditions = {};

    if (search && search.trim() !== '') {
      productMatchConditions.$or = [
        { name: { $regex: search.trim(), $options: 'i' } },
        { sku: { $regex: search.trim(), $options: 'i' } },
      ];
    }

    if (category && category.trim() !== '') {
      try {
        productMatchConditions.category = new mongoose.Types.ObjectId(category);
      } catch (error) {
        console.error('Invalid category ID:', category);
      }
    }

    if (brand && brand.trim() !== '') {
      try {
        productMatchConditions.brand = new mongoose.Types.ObjectId(brand);
      } catch (error) {
        console.error('Invalid brand ID:', brand);
      }
    }

    if (productType && productType.trim() !== '') {
      productMatchConditions.productType = productType.trim();
    }

    const productsWithDirectPricing = await DirectPricingModel.find({
      isActive: true,
    }).distinct('product');

    productMatchConditions._id = { $nin: productsWithDirectPricing };

    const totalCount = await ProductModel.countDocuments(
      productMatchConditions
    );
    const totalPages = Math.ceil(totalCount / parseInt(limit));

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const products = await ProductModel.find(productMatchConditions)
      .populate('brand', 'name')
      .populate('category', 'name')
      .select('name sku productType image price stock brand category')
      .sort({ name: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    return response.json({
      message: 'Available products retrieved successfully',
      data: products,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalCount,
        limit: parseInt(limit),
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get available products error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to get available products',
      error: true,
      success: false,
    });
  }
};

// Update a single price type
export const updateSinglePrice = async (request, response) => {
  try {
    const { productId, priceType, price, notes } = request.body;

    if (!['ACCOUNTANT', 'DIRECTOR', 'IT'].includes(request.user.subRole)) {
      return response.status(403).json({
        message: 'Only Accountant, Director, or IT can update direct pricing',
        error: true,
        success: false,
      });
    }

    if (!productId || !priceType) {
      return response.status(400).json({
        message: 'Product ID and price type are required',
        error: true,
        success: false,
      });
    }

    const validPriceTypes = [
      'btcPrice',
      'price3weeksDelivery',
      'price5weeksDelivery',
    ];

    if (!validPriceTypes.includes(priceType)) {
      return response.status(400).json({
        message: `Invalid price type. Must be one of: ${validPriceTypes.join(
          ', '
        )}`,
        error: true,
        success: false,
      });
    }

    const numPrice = parseFloat(price);
    if (isNaN(numPrice) || numPrice < 0) {
      return response.status(400).json({
        message: 'Price must be a valid number >= 0',
        error: true,
        success: false,
      });
    }

    const product = await ProductModel.findById(productId);
    if (!product) {
      return response.status(404).json({
        message: 'Product not found',
        error: true,
        success: false,
      });
    }

    let directPricing = await DirectPricingModel.findOrCreateForProduct(
      productId,
      request.user._id
    );

    directPricing.updateSpecificPrice(
      priceType,
      numPrice,
      request.user._id,
      notes || `Updated ${priceType}`
    );

    await directPricing.save();

    const productUpdateData = {
      [priceType]: numPrice,
      updatedBy: request.user._id,
    };

    await ProductModel.findByIdAndUpdate(productId, productUpdateData);

    await directPricing.populate([
      { path: 'product', select: 'name sku productType' },
      { path: 'lastUpdatedBy', select: 'name email' },
      { path: `priceUpdatedBy.${priceType}.updatedBy`, select: 'name email' },
    ]);

    return response.json({
      message: `${priceType} updated successfully`,
      data: {
        productId,
        priceType,
        previousPrice:
          directPricing.priceHistory[directPricing.priceHistory.length - 1]
            .previousValue,
        newPrice: numPrice,
        updatedBy: request.user.name,
        updatedAt: new Date(),
        directPricing,
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Update single price error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to update price',
      error: true,
      success: false,
    });
  }
};

// Get direct pricing for a product
export const getDirectPricing = async (request, response) => {
  try {
    const { productId } = request.params;

    if (!productId) {
      return response.status(400).json({
        message: 'Product ID is required',
        error: true,
        success: false,
      });
    }

    const directPricing = await DirectPricingModel.findOne({
      product: productId,
      isActive: true,
    }).populate([
      { path: 'product', select: 'name sku productType category brand' },
      { path: 'lastUpdatedBy', select: 'name email' },
      { path: 'approvedBy', select: 'name email' },
      { path: 'priceUpdatedBy.btcPrice.updatedBy', select: 'name email' },
      {
        path: 'priceUpdatedBy.price3weeksDelivery.updatedBy',
        select: 'name email',
      },
      {
        path: 'priceUpdatedBy.price5weeksDelivery.updatedBy',
        select: 'name email',
      },
    ]);

    if (!directPricing) {
      return response.status(404).json({
        message: 'Direct pricing not found for this product',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: 'Direct pricing retrieved successfully',
      data: directPricing,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get direct pricing error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to get direct pricing',
      error: true,
      success: false,
    });
  }
};

// Get all products with direct pricing (with filters)
export const getDirectPricingList = async (request, response) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      category,
      brand,
      productType,
      updatedBy,
      sortBy = 'lastUpdatedAt',
      sortOrder = 'desc',
    } = request.query;

    const matchConditions = { isActive: true };

    const pipeline = [
      {
        $match: matchConditions,
      },
      {
        $lookup: {
          from: 'products',
          localField: 'product',
          foreignField: '_id',
          as: 'productDetails',
        },
      },
      {
        $unwind: '$productDetails',
      },
      {
        $lookup: {
          from: 'users',
          localField: 'lastUpdatedBy',
          foreignField: '_id',
          as: 'lastUpdatedByDetails',
        },
      },
    ];

    const filterConditions = [];

    if (search && search.trim() !== '') {
      filterConditions.push({
        $or: [
          { 'productDetails.name': { $regex: search.trim(), $options: 'i' } },
          { 'productDetails.sku': { $regex: search.trim(), $options: 'i' } },
        ],
      });
    }

    if (category && category.trim() !== '') {
      try {
        filterConditions.push({
          'productDetails.category': new mongoose.Types.ObjectId(category),
        });
      } catch (error) {
        console.error('Invalid category ID:', category);
      }
    }

    if (brand && brand.trim() !== '') {
      try {
        filterConditions.push({
          'productDetails.brand': {
            $in: [new mongoose.Types.ObjectId(brand)],
          },
        });
      } catch (error) {
        console.error('Invalid brand ID:', brand);
      }
    }

    if (productType && productType.trim() !== '') {
      filterConditions.push({
        'productDetails.productType': productType.trim(),
      });
    }

    if (updatedBy && updatedBy.trim() !== '') {
      try {
        filterConditions.push({
          lastUpdatedBy: new mongoose.Types.ObjectId(updatedBy),
        });
      } catch (error) {
        console.error('Invalid updatedBy ID:', updatedBy);
      }
    }

    if (filterConditions.length > 0) {
      pipeline.push({ $match: { $and: filterConditions } });
    }

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
    pipeline.push({ $sort: sort });

    const countPipeline = [...pipeline, { $count: 'total' }];
    const countResult = await DirectPricingModel.aggregate(countPipeline);
    const totalCount = countResult[0]?.total || 0;
    const totalPages = Math.ceil(totalCount / parseInt(limit));

    const skip = (parseInt(page) - 1) * parseInt(limit);
    pipeline.push({ $skip: skip }, { $limit: parseInt(limit) });

    const results = await DirectPricingModel.aggregate(pipeline);

    return response.json({
      message: 'Direct pricing list retrieved successfully',
      data: results,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalCount,
        limit: parseInt(limit),
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get direct pricing list error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to get direct pricing list',
      error: true,
      success: false,
    });
  }
};

// Get price history for a product
export const getPriceHistory = async (request, response) => {
  try {
    const { productId } = request.params;
    const { limit = 50 } = request.query;

    if (!productId) {
      return response.status(400).json({
        message: 'Product ID is required',
        error: true,
        success: false,
      });
    }

    const directPricing = await DirectPricingModel.findOne({
      product: productId,
      isActive: true,
    }).populate([
      { path: 'product', select: 'name sku' },
      { path: 'priceHistory.updatedBy', select: 'name email' },
    ]);

    if (!directPricing) {
      return response.status(404).json({
        message: 'Direct pricing not found for this product',
        error: true,
        success: false,
      });
    }

    const history = directPricing.priceHistory
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, parseInt(limit));

    return response.json({
      message: 'Price history retrieved successfully',
      data: {
        product: directPricing.product,
        currentPrices: directPricing.directPrices,
        history,
        totalHistoryEntries: directPricing.priceHistory.length,
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get price history error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to get price history',
      error: true,
      success: false,
    });
  }
};

// Delete/deactivate direct pricing
export const deleteDirectPricing = async (request, response) => {
  try {
    const { productId } = request.params;

    if (!['DIRECTOR', 'IT'].includes(request.user.subRole)) {
      return response.status(403).json({
        message: 'Only Director or IT can delete direct pricing',
        error: true,
        success: false,
      });
    }

    if (!productId) {
      return response.status(400).json({
        message: 'Product ID is required',
        error: true,
        success: false,
      });
    }

    const directPricing = await DirectPricingModel.findOne({
      product: productId,
      isActive: true,
    });

    if (!directPricing) {
      return response.status(404).json({
        message: 'Direct pricing not found for this product',
        error: true,
        success: false,
      });
    }

    directPricing.isActive = false;
    directPricing.lastUpdatedBy = request.user._id;
    directPricing.lastUpdatedAt = new Date();

    directPricing.priceHistory.push({
      prices: { ...directPricing.directPrices },
      priceType: 'bulk',
      updatedBy: request.user._id,
      updatedAt: new Date(),
      notes: 'Direct pricing deactivated',
      updateSource: 'ADMIN_OVERRIDE',
    });

    await directPricing.save();

    return response.json({
      message: 'Direct pricing deleted successfully',
      data: {
        productId,
        deletedAt: new Date(),
        deletedBy: request.user.name,
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Delete direct pricing error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to delete direct pricing',
      error: true,
      success: false,
    });
  }
};

// Get direct pricing statistics
export const getDirectPricingStats = async (request, response) => {
  try {
    const stats = await DirectPricingModel.aggregate([
      {
        $match: { isActive: true },
      },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          averageBtcPrice: { $avg: '$directPrices.btcPrice' },
          average3WeeksPrice: { $avg: '$directPrices.price3weeksDelivery' },
          average5WeeksPrice: { $avg: '$directPrices.price5weeksDelivery' },
          totalUpdatesToday: {
            $sum: {
              $cond: [
                {
                  $gte: [
                    '$lastUpdatedAt',
                    new Date(new Date().setHours(0, 0, 0, 0)),
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const result = stats[0] || {
      totalProducts: 0,
      averageBtcPrice: 0,
      average3WeeksPrice: 0,
      average5WeeksPrice: 0,
      totalUpdatesToday: 0,
    };

    const recentActivity = await DirectPricingModel.find({ isActive: true })
      .sort({ lastUpdatedAt: -1 })
      .limit(10)
      .populate([
        { path: 'product', select: 'name sku' },
        { path: 'lastUpdatedBy', select: 'name' },
      ]);

    return response.json({
      message: 'Direct pricing statistics retrieved successfully',
      data: {
        stats: result,
        recentActivity,
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get direct pricing stats error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to get direct pricing statistics',
      error: true,
      success: false,
    });
  }
};
