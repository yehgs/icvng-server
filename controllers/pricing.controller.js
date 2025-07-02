import PricingConfigModel from '../models/price-config.model.js';
import ProductPricingModel from '../models/product-price.model.js';
import PurchaseOrderModel from '../models/purchase-order.model.js';
import ProductModel from '../models/product.model.js';
import ExchangeRateModel from '../models/exchange-rate.model.js';

// Get current pricing configuration
export const getPricingConfig = async (request, response) => {
  try {
    const config = await PricingConfigModel.findOne({ isActive: true })
      .populate('lastUpdatedBy approvedBy', 'name email')
      .populate(
        'configHistory.updatedBy configHistory.approvedBy',
        'name email'
      );

    if (!config) {
      // Create default configuration if none exists
      const defaultConfig = new PricingConfigModel({
        lastUpdatedBy: request.user._id,
      });
      await defaultConfig.save();

      return response.json({
        message: 'Default pricing configuration created',
        data: defaultConfig,
        error: false,
        success: true,
      });
    }

    return response.json({
      message: 'Pricing configuration retrieved successfully',
      data: config,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get pricing config error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to get pricing configuration',
      error: true,
      success: false,
    });
  }
};

// **NEW: Direct price creation for accountants (independent of purchase orders)**
export const createDirectProductPricing = async (request, response) => {
  try {
    const { productId, price, notes, currency = 'NGN' } = request.body;

    // Check user role
    if (!['ACCOUNTANT', 'DIRECTOR', 'IT'].includes(request.user.subRole)) {
      return response.status(403).json({
        message: 'Only Accountant, Director, or IT can create product pricing',
        error: true,
        success: false,
      });
    }

    if (!productId || !price || parseFloat(price) <= 0) {
      return response.status(400).json({
        message: 'Product ID and valid price are required',
        error: true,
        success: false,
      });
    }

    const config = await PricingConfigModel.findOne({
      isActive: true,
      isApproved: true,
    });
    if (!config) {
      return response.status(400).json({
        message: 'No approved pricing configuration found',
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

    const subPrice = parseFloat(price);

    // Calculate all prices using the pricing configuration
    const calculatedPrices = {
      salePrice: Math.round(subPrice * (1 + config.margins.salePrice / 100)),
      btbPrice: Math.round(subPrice * (1 + config.margins.btbPrice / 100)),
      btcPrice: Math.round(subPrice * (1 + config.margins.btcPrice / 100)),
      price3weeksDelivery: Math.round(
        subPrice * (1 + config.margins.price3weeksDelivery / 100)
      ),
      price5weeksDelivery: Math.round(
        subPrice * (1 + config.margins.price5weeksDelivery / 100)
      ),
    };

    // Update product with new pricing
    const productUpdateData = {
      price: subPrice, // Use subPrice as base price
      salePrice: calculatedPrices.salePrice,
      btbPrice: calculatedPrices.btbPrice,
      btcPrice: calculatedPrices.btcPrice,
      price3weeksDelivery: calculatedPrices.price3weeksDelivery,
      price5weeksDelivery: calculatedPrices.price5weeksDelivery,
      updatedBy: request.user._id,
    };

    await ProductModel.findByIdAndUpdate(productId, productUpdateData);

    // Check if ProductPricing already exists
    let productPricing = await ProductPricingModel.findOne({
      product: productId,
    });

    if (productPricing) {
      // Save current pricing to history
      productPricing.priceHistory.push({
        calculatedPrices: productPricing.calculatedPrices,
        appliedMargins: productPricing.appliedMargins,
        calculatedAt: productPricing.calculatedAt,
        calculatedBy: productPricing.calculatedBy,
        approvedBy: productPricing.approvedBy,
        approvedAt: productPricing.approvedAt,
      });
    } else {
      // Create new ProductPricing record for direct pricing
      productPricing = new ProductPricingModel({
        product: productId,
      });
    }

    // **Create minimal cost breakdown for direct pricing**
    const directCostBreakdown = {
      unitCostInOriginalCurrency: 0, // Not applicable for direct pricing
      originalCurrency: currency,
      exchangeRate: currency === 'NGN' ? 1 : 0, // Default values
      unitCostInNaira: 0, // Not applicable for direct pricing
      freightAndClearingCostPerUnit: 0, // No logistics for direct pricing
      totalCostPerUnit: subPrice, // The input price IS the total cost
      overheadPercentage: config.overheadPercentage,
      overheadAmount: 0, // Already included in input price
      subPrice: subPrice,
    };

    // Update pricing record
    productPricing.costBreakdown = directCostBreakdown;
    productPricing.calculatedPrices = calculatedPrices;
    productPricing.appliedMargins = config.margins;
    productPricing.pricingConfig = config._id;
    productPricing.calculatedBy = request.user._id;
    productPricing.calculatedAt = new Date();
    productPricing.isApproved = true; // Auto-approved for direct entry
    productPricing.approvedBy = request.user._id;
    productPricing.approvedAt = new Date();
    productPricing.lastExchangeRateUpdate = new Date();

    await productPricing.save();

    // Update product with pricing reference
    await ProductModel.findByIdAndUpdate(productId, {
      pricing: productPricing._id,
    });

    return response.json({
      message: 'Product pricing created successfully',
      data: {
        productId,
        subPrice,
        calculatedPrices,
        appliedMargins: config.margins,
        notes: notes || '',
        pricingId: productPricing._id,
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Create direct product pricing error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to create product pricing',
      error: true,
      success: false,
    });
  }
};

// Update pricing configuration (requires approval)
export const updatePricingConfig = async (request, response) => {
  try {
    const { margins, overheadPercentage, autoUpdateOnExchangeRateChange } =
      request.body;

    // Check user role
    if (!['ACCOUNTANT', 'DIRECTOR', 'IT'].includes(request.user.subRole)) {
      return response.status(403).json({
        message:
          'Only Accountant, Director, or IT can update pricing configuration',
        error: true,
        success: false,
      });
    }

    const config = await PricingConfigModel.findOne({ isActive: true });
    if (!config) {
      return response.status(404).json({
        message: 'No active pricing configuration found',
        error: true,
        success: false,
      });
    }

    // Save current config to history
    config.configHistory.push({
      margins: config.margins,
      overheadPercentage: config.overheadPercentage,
      updatedBy: config.lastUpdatedBy,
      updatedAt: config.updatedAt,
      approvedBy: config.approvedBy,
      approvedAt: config.approvedAt,
    });

    // Update configuration
    if (margins) config.margins = margins;
    if (overheadPercentage !== undefined)
      config.overheadPercentage = overheadPercentage;
    if (autoUpdateOnExchangeRateChange !== undefined)
      config.autoUpdateOnExchangeRateChange = autoUpdateOnExchangeRateChange;

    config.lastUpdatedBy = request.user._id;
    config.isApproved = false; // Reset approval status
    config.approvedBy = undefined;
    config.approvedAt = undefined;

    await config.save();

    const populatedConfig = await PricingConfigModel.findById(
      config._id
    ).populate('lastUpdatedBy', 'name email');

    return response.json({
      message:
        'Pricing configuration updated successfully. Awaiting director approval.',
      data: populatedConfig,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Update pricing config error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to update pricing configuration',
      error: true,
      success: false,
    });
  }
};

// Approve pricing configuration (Director only)
export const approvePricingConfig = async (request, response) => {
  try {
    if (request.user.subRole !== 'DIRECTOR') {
      return response.status(403).json({
        message: 'Only Director can approve pricing configuration',
        error: true,
        success: false,
      });
    }

    const config = await PricingConfigModel.findOne({ isActive: true });
    if (!config) {
      return response.status(404).json({
        message: 'No active pricing configuration found',
        error: true,
        success: false,
      });
    }

    if (config.isApproved) {
      return response.status(400).json({
        message: 'Pricing configuration is already approved',
        error: true,
        success: false,
      });
    }

    config.isApproved = true;
    config.approvedBy = request.user._id;
    config.approvedAt = new Date();

    await config.save();

    // Update all product prices with new configuration
    await recalculateAllProductPrices(config._id, request.user._id);

    return response.json({
      message: 'Pricing configuration approved and all product prices updated',
      data: config,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Approve pricing config error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to approve pricing configuration',
      error: true,
      success: false,
    });
  }
};

// Calculate prices from purchase order
export const calculatePricesFromPurchaseOrder = async (request, response) => {
  try {
    const { purchaseOrderId } = request.params;

    const purchaseOrder = await PurchaseOrderModel.findById(purchaseOrderId)
      .populate('items.product', 'name sku productType')
      .populate('supplier', 'name');

    if (!purchaseOrder) {
      return response.status(404).json({
        message: 'Purchase order not found',
        error: true,
        success: false,
      });
    }

    const config = await PricingConfigModel.findOne({
      isActive: true,
      isApproved: true,
    });
    if (!config) {
      return response.status(400).json({
        message: 'No approved pricing configuration found',
        error: true,
        success: false,
      });
    }

    // Get current exchange rate
    const exchangeRate = await getCurrentExchangeRate(purchaseOrder.currency);

    // Calculate total logistics cost per unit
    const totalLogisticsCost =
      (purchaseOrder.logistics?.freightCost || 0) +
      (purchaseOrder.logistics?.clearanceCost || 0) +
      (purchaseOrder.logistics?.otherLogisticsCost || 0);

    const totalQuantity = purchaseOrder.items.reduce(
      (sum, item) => sum + item.quantity,
      0
    );
    const logisticsCostPerUnit =
      totalQuantity > 0 ? totalLogisticsCost / totalQuantity : 0;

    const calculatedItems = [];

    for (const item of purchaseOrder.items) {
      const calculations = calculateProductPricing({
        unitCostInOriginalCurrency: item.unitPrice,
        originalCurrency: purchaseOrder.currency,
        exchangeRate: exchangeRate,
        logisticsCostPerUnit: logisticsCostPerUnit,
        margins: config.margins,
        overheadPercentage: config.overheadPercentage,
      });

      calculatedItems.push({
        product: item.product,
        quantity: item.quantity,
        calculations: calculations,
      });
    }

    return response.json({
      message: 'Prices calculated successfully',
      data: {
        purchaseOrder: {
          _id: purchaseOrder._id,
          orderNumber: purchaseOrder.orderNumber,
          supplier: purchaseOrder.supplier,
          currency: purchaseOrder.currency,
          exchangeRate: exchangeRate,
          totalLogisticsCost: totalLogisticsCost,
          logisticsCostPerUnit: logisticsCostPerUnit,
        },
        pricingConfig: config,
        calculatedItems: calculatedItems,
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Calculate prices error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to calculate prices',
      error: true,
      success: false,
    });
  }
};

// Approve calculated prices (Director only) - FIXED TO UPDATE PRODUCT MODEL
export const approvePriceCalculations = async (request, response) => {
  try {
    if (request.user.subRole !== 'DIRECTOR') {
      return response.status(403).json({
        message: 'Only Director can approve price calculations',
        error: true,
        success: false,
      });
    }

    const { purchaseOrderId, calculatedItems } = request.body;

    const config = await PricingConfigModel.findOne({
      isActive: true,
      isApproved: true,
    });
    if (!config) {
      return response.status(400).json({
        message: 'No approved pricing configuration found',
        error: true,
        success: false,
      });
    }

    const updatedProducts = [];

    for (const item of calculatedItems) {
      // Save or update product pricing
      let productPricing = await ProductPricingModel.findOne({
        product: item.productId,
      });

      if (productPricing) {
        // Save current pricing to history
        productPricing.priceHistory.push({
          calculatedPrices: productPricing.calculatedPrices,
          appliedMargins: productPricing.appliedMargins,
          exchangeRate: productPricing.costBreakdown.exchangeRate,
          calculatedAt: productPricing.calculatedAt,
          calculatedBy: productPricing.calculatedBy,
          approvedBy: productPricing.approvedBy,
          approvedAt: productPricing.approvedAt,
        });
      } else {
        productPricing = new ProductPricingModel({
          product: item.productId,
          purchaseOrder: purchaseOrderId,
        });
      }

      // Update with new calculations
      productPricing.costBreakdown = item.calculations.costBreakdown;
      productPricing.calculatedPrices = item.calculations.calculatedPrices;
      productPricing.appliedMargins = item.calculations.appliedMargins;
      productPricing.pricingConfig = config._id;
      productPricing.calculatedBy = request.user._id;
      productPricing.calculatedAt = new Date();
      productPricing.isApproved = true;
      productPricing.approvedBy = request.user._id;
      productPricing.approvedAt = new Date();
      productPricing.lastExchangeRateUpdate = new Date();

      await productPricing.save();

      // **FIX: Update product model with new prices**
      const productUpdateData = {
        price: item.calculations.costBreakdown.subPrice, // Use subPrice as base price
        salePrice: item.calculations.calculatedPrices.salePrice,
        btbPrice: item.calculations.calculatedPrices.btbPrice,
        btcPrice: item.calculations.calculatedPrices.btcPrice,
        price3weeksDelivery:
          item.calculations.calculatedPrices.price3weeksDelivery,
        price5weeksDelivery:
          item.calculations.calculatedPrices.price5weeksDelivery,
        pricing: productPricing._id,
        updatedBy: request.user._id,
      };

      await ProductModel.findByIdAndUpdate(item.productId, productUpdateData);

      updatedProducts.push(item.productId);
    }

    return response.json({
      message: `Price calculations approved and ${updatedProducts.length} products updated`,
      data: {
        updatedProducts: updatedProducts.length,
        approvedAt: new Date(),
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Approve price calculations error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to approve price calculations',
      error: true,
      success: false,
    });
  }
};

// **NEW: Direct price update for accountants**
export const updateProductPricing = async (request, response) => {
  try {
    const { productId, price, notes } = request.body;

    // Check user role
    if (!['ACCOUNTANT', 'DIRECTOR', 'IT'].includes(request.user.subRole)) {
      return response.status(403).json({
        message: 'Only Accountant, Director, or IT can update product pricing',
        error: true,
        success: false,
      });
    }

    if (!productId || !price || parseFloat(price) <= 0) {
      return response.status(400).json({
        message: 'Product ID and valid price are required',
        error: true,
        success: false,
      });
    }

    const config = await PricingConfigModel.findOne({
      isActive: true,
      isApproved: true,
    });
    if (!config) {
      return response.status(400).json({
        message: 'No approved pricing configuration found',
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

    // Check if ProductPricing exists
    const existingPricing = await ProductPricingModel.findOne({
      product: productId,
    });

    if (!existingPricing) {
      // If no pricing record exists, use the create function instead
      return createDirectProductPricing(request, response);
    }

    const subPrice = parseFloat(price);

    // Calculate all prices using the pricing configuration
    const calculatedPrices = {
      salePrice: Math.round(subPrice * (1 + config.margins.salePrice / 100)),
      btbPrice: Math.round(subPrice * (1 + config.margins.btbPrice / 100)),
      btcPrice: Math.round(subPrice * (1 + config.margins.btcPrice / 100)),
      price3weeksDelivery: Math.round(
        subPrice * (1 + config.margins.price3weeksDelivery / 100)
      ),
      price5weeksDelivery: Math.round(
        subPrice * (1 + config.margins.price5weeksDelivery / 100)
      ),
    };

    // Update product with new pricing
    const productUpdateData = {
      price: subPrice,
      salePrice: calculatedPrices.salePrice,
      btbPrice: calculatedPrices.btbPrice,
      btcPrice: calculatedPrices.btcPrice,
      price3weeksDelivery: calculatedPrices.price3weeksDelivery,
      price5weeksDelivery: calculatedPrices.price5weeksDelivery,
      updatedBy: request.user._id,
    };

    await ProductModel.findByIdAndUpdate(productId, productUpdateData);

    // Save current pricing to history
    existingPricing.priceHistory.push({
      calculatedPrices: existingPricing.calculatedPrices,
      appliedMargins: existingPricing.appliedMargins,
      calculatedAt: existingPricing.calculatedAt,
      calculatedBy: existingPricing.calculatedBy,
    });

    // Update pricing record
    existingPricing.calculatedPrices = calculatedPrices;
    existingPricing.appliedMargins = config.margins;
    existingPricing.calculatedBy = request.user._id;
    existingPricing.calculatedAt = new Date();
    existingPricing.isApproved = true;
    existingPricing.approvedBy = request.user._id;
    existingPricing.approvedAt = new Date();

    // Update subPrice in cost breakdown
    if (existingPricing.costBreakdown) {
      existingPricing.costBreakdown.subPrice = subPrice;
      existingPricing.costBreakdown.totalCostPerUnit = subPrice;
    }

    await existingPricing.save();

    return response.json({
      message: 'Product pricing updated successfully',
      data: {
        productId,
        subPrice,
        calculatedPrices,
        appliedMargins: config.margins,
        notes: notes || '',
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Update product pricing error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to update product pricing',
      error: true,
      success: false,
    });
  }
};

// Get product pricing list with filters
export const getProductPricingList = async (request, response) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      category,
      brand,
      isApproved,
      productType,
    } = request.query;

    // Build aggregation pipeline
    const pipeline = [
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
    ];

    // Add lookups for category and brand if filtering
    if (category || brand) {
      pipeline.push(
        {
          $lookup: {
            from: 'categories',
            localField: 'productDetails.category',
            foreignField: '_id',
            as: 'categoryDetails',
          },
        },
        {
          $lookup: {
            from: 'brands',
            localField: 'productDetails.brand',
            foreignField: '_id',
            as: 'brandDetails',
          },
        }
      );
    }

    // Build match conditions
    const matchConditions = { isActive: true };

    if (search) {
      matchConditions['productDetails.name'] = {
        $regex: search,
        $options: 'i',
      };
    }

    if (category) {
      matchConditions['categoryDetails._id'] = new mongoose.Types.ObjectId(
        category
      );
    }

    if (brand) {
      matchConditions['brandDetails._id'] = new mongoose.Types.ObjectId(brand);
    }

    if (isApproved !== undefined) {
      matchConditions.isApproved = isApproved === 'true';
    }

    if (productType) {
      matchConditions['productDetails.productType'] = productType;
    }

    pipeline.push({ $match: matchConditions });

    // Add pagination
    const skip = (page - 1) * limit;
    pipeline.push(
      { $skip: skip },
      { $limit: parseInt(limit) },
      {
        $lookup: {
          from: 'users',
          localField: 'calculatedBy',
          foreignField: '_id',
          as: 'calculatedByDetails',
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'approvedBy',
          foreignField: '_id',
          as: 'approvedByDetails',
        },
      }
    );

    const [results, totalCount] = await Promise.all([
      ProductPricingModel.aggregate(pipeline),
      ProductPricingModel.countDocuments(matchConditions),
    ]);

    return response.json({
      message: 'Product pricing list retrieved successfully',
      data: results,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: parseInt(page),
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get product pricing list error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to get product pricing list',
      error: true,
      success: false,
    });
  }
};

// Utility function to calculate product pricing
const calculateProductPricing = ({
  unitCostInOriginalCurrency,
  originalCurrency,
  exchangeRate,
  logisticsCostPerUnit,
  margins,
  overheadPercentage,
}) => {
  // Convert to Naira
  const unitCostInNaira = unitCostInOriginalCurrency * exchangeRate;

  // Add logistics cost
  const totalCostPerUnit = unitCostInNaira + logisticsCostPerUnit;

  // Calculate overhead
  const overheadAmount = totalCostPerUnit * (overheadPercentage / 100);
  const subPrice = totalCostPerUnit + overheadAmount;

  // Calculate different price types
  const calculatedPrices = {
    salePrice: Math.round(subPrice * (1 + margins.salePrice / 100)),
    btbPrice: Math.round(subPrice * (1 + margins.btbPrice / 100)),
    btcPrice: Math.round(subPrice * (1 + margins.btcPrice / 100)),
    price3weeksDelivery: Math.round(
      subPrice * (1 + margins.price3weeksDelivery / 100)
    ),
    price5weeksDelivery: Math.round(
      subPrice * (1 + margins.price5weeksDelivery / 100)
    ),
  };

  return {
    costBreakdown: {
      unitCostInOriginalCurrency,
      originalCurrency,
      exchangeRate,
      unitCostInNaira,
      freightAndClearingCostPerUnit: logisticsCostPerUnit,
      totalCostPerUnit,
      overheadPercentage,
      overheadAmount,
      subPrice,
    },
    calculatedPrices,
    appliedMargins: margins,
  };
};

// Utility function to get current exchange rate using ExchangeRateModel
const getCurrentExchangeRate = async (fromCurrency) => {
  try {
    if (fromCurrency === 'NGN') return 1;

    // Use ExchangeRateModel to get rate
    const rate = await ExchangeRateModel.getRate(fromCurrency, 'NGN');
    return rate || 1; // Fallback to 1 if rate not found
  } catch (error) {
    console.error('Exchange rate fetch error:', error);
    return 1; // Fallback
  }
};

// Utility function to recalculate all product prices - FIXED TO UPDATE PRODUCT MODEL
const recalculateAllProductPrices = async (pricingConfigId, userId) => {
  try {
    const config = await PricingConfigModel.findById(pricingConfigId);
    const productPricings = await ProductPricingModel.find({
      isActive: true,
    }).populate('product', 'name sku');

    for (const pricing of productPricings) {
      // Get current exchange rate for this product
      const currentExchangeRate = await getCurrentExchangeRate(
        pricing.costBreakdown.originalCurrency
      );

      // Recalculate with new margins and current exchange rate
      const newCalculations = calculateProductPricing({
        unitCostInOriginalCurrency:
          pricing.costBreakdown.unitCostInOriginalCurrency,
        originalCurrency: pricing.costBreakdown.originalCurrency,
        exchangeRate: currentExchangeRate,
        logisticsCostPerUnit:
          pricing.costBreakdown.freightAndClearingCostPerUnit,
        margins: config.margins,
        overheadPercentage: config.overheadPercentage,
      });

      // Save to history
      pricing.priceHistory.push({
        calculatedPrices: pricing.calculatedPrices,
        appliedMargins: pricing.appliedMargins,
        exchangeRate: pricing.costBreakdown.exchangeRate,
        calculatedAt: pricing.calculatedAt,
        calculatedBy: pricing.calculatedBy,
      });

      // Update with new calculations
      pricing.costBreakdown = newCalculations.costBreakdown;
      pricing.calculatedPrices = newCalculations.calculatedPrices;
      pricing.appliedMargins = newCalculations.appliedMargins;
      pricing.pricingConfig = pricingConfigId;
      pricing.calculatedBy = userId;
      pricing.calculatedAt = new Date();
      pricing.lastExchangeRateUpdate = new Date();

      await pricing.save();

      // **FIX: Update product model**
      const productUpdateData = {
        price: newCalculations.costBreakdown.subPrice,
        salePrice: newCalculations.calculatedPrices.salePrice,
        btbPrice: newCalculations.calculatedPrices.btbPrice,
        btcPrice: newCalculations.calculatedPrices.btcPrice,
        price3weeksDelivery:
          newCalculations.calculatedPrices.price3weeksDelivery,
        price5weeksDelivery:
          newCalculations.calculatedPrices.price5weeksDelivery,
        updatedBy: userId,
      };

      await ProductModel.findByIdAndUpdate(
        pricing.product._id,
        productUpdateData
      );
    }
  } catch (error) {
    console.error('Recalculate all prices error:', error);
    throw error;
  }
};

// Update prices when exchange rates change - FIXED TO UPDATE PRODUCT MODEL
export const updatePricesOnExchangeRateChange = async (request, response) => {
  try {
    const { currency, newRate } = request.body;

    const config = await PricingConfigModel.findOne({
      isActive: true,
      isApproved: true,
    });
    if (!config || !config.autoUpdateOnExchangeRateChange) {
      return response.json({
        message: 'Auto-update is disabled or no approved config found',
        error: false,
        success: true,
      });
    }

    // Find all product pricings using this currency
    const productPricings = await ProductPricingModel.find({
      'costBreakdown.originalCurrency': currency,
      isActive: true,
    });

    let updatedCount = 0;

    for (const pricing of productPricings) {
      // Recalculate with new exchange rate
      const newCalculations = calculateProductPricing({
        unitCostInOriginalCurrency:
          pricing.costBreakdown.unitCostInOriginalCurrency,
        originalCurrency: currency,
        exchangeRate: newRate,
        logisticsCostPerUnit:
          pricing.costBreakdown.freightAndClearingCostPerUnit,
        margins: config.margins,
        overheadPercentage: config.overheadPercentage,
      });

      // Update pricing
      pricing.costBreakdown = newCalculations.costBreakdown;
      pricing.calculatedPrices = newCalculations.calculatedPrices;
      pricing.lastExchangeRateUpdate = new Date();

      await pricing.save();

      // **FIX: Update product model**
      const productUpdateData = {
        price: newCalculations.costBreakdown.subPrice,
        salePrice: newCalculations.calculatedPrices.salePrice,
        btbPrice: newCalculations.calculatedPrices.btbPrice,
        btcPrice: newCalculations.calculatedPrices.btcPrice,
        price3weeksDelivery:
          newCalculations.calculatedPrices.price3weeksDelivery,
        price5weeksDelivery:
          newCalculations.calculatedPrices.price5weeksDelivery,
      };

      await ProductModel.findByIdAndUpdate(pricing.product, productUpdateData);
      updatedCount++;
    }

    return response.json({
      message: `Updated ${updatedCount} products due to exchange rate change`,
      data: { updatedCount, currency, newRate },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Update prices on exchange rate change error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to update prices',
      error: true,
      success: false,
    });
  }
};

// Bulk recalculate prices for specific currency
export const bulkRecalculatePricesForCurrency = async (request, response) => {
  try {
    const { currency } = request.body;

    if (!currency) {
      return response.status(400).json({
        message: 'Currency is required',
        error: true,
        success: false,
      });
    }

    // Get current exchange rate
    const currentRate = await getCurrentExchangeRate(currency);

    // Trigger price update
    const result = await updatePricesOnExchangeRateChange(
      { body: { currency, newRate: currentRate } },
      { json: () => {} }
    );

    return response.json({
      message: `Bulk recalculation completed for ${currency}`,
      data: { currency, rate: currentRate },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Bulk recalculate prices error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to bulk recalculate prices',
      error: true,
      success: false,
    });
  }
};
