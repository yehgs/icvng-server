import PricingConfigModel from "../models/price-config.model.js";
import ProductPricingModel from "../models/product-price.model.js";
import PurchaseOrderModel from "../models/purchase-order.model.js";
import ProductModel from "../models/product.model.js";
import ExchangeRateModel from "../models/exchange-rate.model.js";
import csv from "csv-parser";
import { Readable } from "stream";
import PDFDocument from "pdfkit";

// ==========================================
// CONFIGURATION MANAGEMENT
// ==========================================

// Get current pricing configuration
export const getPricingConfig = async (request, response) => {
  try {
    const config = await PricingConfigModel.findOne({ isActive: true })
      .populate("lastUpdatedBy approvedBy", "name email")
      .populate(
        "configHistory.updatedBy configHistory.approvedBy",
        "name email",
      );

    if (!config) {
      // Create default configuration if none exists
      const defaultConfig = new PricingConfigModel({
        lastUpdatedBy: request.user._id,
        taxPercentage: 7.5, // Default tax
      });
      await defaultConfig.save();

      return response.json({
        message: "Default pricing configuration created",
        data: defaultConfig,
        error: false,
        success: true,
      });
    }

    return response.json({
      message: "Pricing configuration retrieved successfully",
      data: config,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Get pricing config error:", error);
    return response.status(500).json({
      message: error.message || "Failed to get pricing configuration",
      error: true,
      success: false,
    });
  }
};

// Update pricing configuration (requires approval)
export const updatePricingConfig = async (request, response) => {
  try {
    const {
      margins,
      overheadPercentage,
      taxPercentage,
      autoUpdateOnExchangeRateChange,
    } = request.body;

    // Check user role
    if (!["ACCOUNTANT", "DIRECTOR", "IT"].includes(request.user.subRole)) {
      return response.status(403).json({
        message:
          "Only Accountant, Director, or IT can update pricing configuration",
        error: true,
        success: false,
      });
    }

    const config = await PricingConfigModel.findOne({ isActive: true });
    if (!config) {
      return response.status(404).json({
        message: "No active pricing configuration found",
        error: true,
        success: false,
      });
    }

    // Save current config to history
    config.configHistory.push({
      margins: config.margins,
      overheadPercentage: config.overheadPercentage,
      taxPercentage: config.taxPercentage, // NEW
      updatedBy: config.lastUpdatedBy,
      updatedAt: config.updatedAt,
      approvedBy: config.approvedBy,
      approvedAt: config.approvedAt,
    });

    // Update configuration
    if (margins) config.margins = margins;
    if (overheadPercentage !== undefined)
      config.overheadPercentage = overheadPercentage;
    if (taxPercentage !== undefined) config.taxPercentage = taxPercentage; // NEW
    if (autoUpdateOnExchangeRateChange !== undefined)
      config.autoUpdateOnExchangeRateChange = autoUpdateOnExchangeRateChange;

    config.lastUpdatedBy = request.user._id;
    config.isApproved = false; // Reset approval status
    config.approvedBy = undefined;
    config.approvedAt = undefined;

    await config.save();

    const populatedConfig = await PricingConfigModel.findById(
      config._id,
    ).populate("lastUpdatedBy", "name email");

    return response.json({
      message:
        "Pricing configuration updated successfully. Awaiting director approval.",
      data: populatedConfig,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Update pricing config error:", error);
    return response.status(500).json({
      message: error.message || "Failed to update pricing configuration",
      error: true,
      success: false,
    });
  }
};

// Approve pricing configuration (Director only)
export const approvePricingConfig = async (request, response) => {
  try {
    if (request.user.subRole !== "DIRECTOR") {
      return response.status(403).json({
        message: "Only Director can approve pricing configuration",
        error: true,
        success: false,
      });
    }

    const config = await PricingConfigModel.findOne({ isActive: true });
    if (!config) {
      return response.status(404).json({
        message: "No active pricing configuration found",
        error: true,
        success: false,
      });
    }

    if (config.isApproved) {
      return response.status(400).json({
        message: "Pricing configuration is already approved",
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
      message: "Pricing configuration approved and all product prices updated",
      data: config,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Approve pricing config error:", error);
    return response.status(500).json({
      message: error.message || "Failed to approve pricing configuration",
      error: true,
      success: false,
    });
  }
};

// ==========================================
// PRICE CALCULATION
// ==========================================

// Calculate prices from purchase order
export const calculatePricesFromPurchaseOrder = async (request, response) => {
  try {
    const { purchaseOrderId } = request.params;

    const purchaseOrder = await PurchaseOrderModel.findById(purchaseOrderId)
      .populate("items.product", "name sku productType")
      .populate("supplier", "name");

    if (!purchaseOrder) {
      return response.status(404).json({
        message: "Purchase order not found",
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
        message: "No approved pricing configuration found",
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
      0,
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
        taxPercentage: config.taxPercentage, // NEW
      });

      calculatedItems.push({
        product: item.product,
        quantity: item.quantity,
        calculations: calculations,
      });
    }

    return response.json({
      message: "Prices calculated successfully",
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
    console.error("Calculate prices error:", error);
    return response.status(500).json({
      message: error.message || "Failed to calculate prices",
      error: true,
      success: false,
    });
  }
};

// Approve calculated prices (Director only)
export const approvePriceCalculations = async (request, response) => {
  try {
    if (request.user.subRole !== "DIRECTOR") {
      return response.status(403).json({
        message: "Only Director can approve price calculations",
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
        message: "No approved pricing configuration found",
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
          calculatedPricesBeforeTax: productPricing.calculatedPricesBeforeTax,
          calculatedPrices: productPricing.calculatedPrices,
          appliedMargins: productPricing.appliedMargins,
          appliedTaxPercentage: productPricing.appliedTaxPercentage,
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
      productPricing.calculatedPricesBeforeTax =
        item.calculations.calculatedPricesBeforeTax;
      productPricing.calculatedPrices = item.calculations.calculatedPrices;
      productPricing.appliedMargins = item.calculations.appliedMargins;
      productPricing.appliedTaxPercentage =
        item.calculations.appliedTaxPercentage;
      productPricing.pricingConfig = config._id;
      productPricing.calculatedBy = request.user._id;
      productPricing.calculatedAt = new Date();
      productPricing.isApproved = true;
      productPricing.approvedBy = request.user._id;
      productPricing.approvedAt = new Date();
      productPricing.lastExchangeRateUpdate = new Date();

      await productPricing.save();

      // Update product model with new prices
      const productUpdateData = {
        price: item.calculations.costBreakdown.subPrice,
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
    console.error("Approve price calculations error:", error);
    return response.status(500).json({
      message: error.message || "Failed to approve price calculations",
      error: true,
      success: false,
    });
  }
};

// ==========================================
// DIRECT PRICE MANAGEMENT
// ==========================================

// Create direct product pricing
export const createDirectProductPricing = async (request, response) => {
  try {
    const { productId, price, notes, currency = "NGN" } = request.body;

    // Check user role
    if (!["ACCOUNTANT", "DIRECTOR", "IT"].includes(request.user.subRole)) {
      return response.status(403).json({
        message: "Only Accountant, Director, or IT can create product pricing",
        error: true,
        success: false,
      });
    }

    if (!productId || !price || parseFloat(price) <= 0) {
      return response.status(400).json({
        message: "Product ID and valid price are required",
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
        message: "No approved pricing configuration found",
        error: true,
        success: false,
      });
    }

    const product = await ProductModel.findById(productId);
    if (!product) {
      return response.status(404).json({
        message: "Product not found",
        error: true,
        success: false,
      });
    }

    const subPrice = parseFloat(price);

    // Calculate all prices using the pricing configuration
    const calculatedPricesBeforeTax = {
      salePrice: Math.round(subPrice * (1 + config.margins.salePrice / 100)),
      btbPrice: Math.round(subPrice * (1 + config.margins.btbPrice / 100)),
      btcPrice: Math.round(subPrice * (1 + config.margins.btcPrice / 100)),
      price3weeksDelivery: Math.round(
        subPrice * (1 + config.margins.price3weeksDelivery / 100),
      ),
      price5weeksDelivery: Math.round(
        subPrice * (1 + config.margins.price5weeksDelivery / 100),
      ),
    };

    // NEW: Apply tax to all prices
    const calculatedPrices = {
      salePrice: Math.round(
        calculatedPricesBeforeTax.salePrice * (1 + config.taxPercentage / 100),
      ),
      btbPrice: Math.round(
        calculatedPricesBeforeTax.btbPrice * (1 + config.taxPercentage / 100),
      ),
      btcPrice: Math.round(
        calculatedPricesBeforeTax.btcPrice * (1 + config.taxPercentage / 100),
      ),
      price3weeksDelivery: Math.round(
        calculatedPricesBeforeTax.price3weeksDelivery *
          (1 + config.taxPercentage / 100),
      ),
      price5weeksDelivery: Math.round(
        calculatedPricesBeforeTax.price5weeksDelivery *
          (1 + config.taxPercentage / 100),
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

    // Check if ProductPricing already exists
    let productPricing = await ProductPricingModel.findOne({
      product: productId,
    });

    if (productPricing) {
      // Save current pricing to history
      productPricing.priceHistory.push({
        calculatedPricesBeforeTax: productPricing.calculatedPricesBeforeTax,
        calculatedPrices: productPricing.calculatedPrices,
        appliedMargins: productPricing.appliedMargins,
        appliedTaxPercentage: productPricing.appliedTaxPercentage,
        calculatedAt: productPricing.calculatedAt,
        calculatedBy: productPricing.calculatedBy,
        approvedBy: productPricing.approvedBy,
        approvedAt: productPricing.approvedAt,
      });
    } else {
      // Create new ProductPricing record
      productPricing = new ProductPricingModel({
        product: productId,
      });
    }

    // Create minimal cost breakdown for direct pricing
    const directCostBreakdown = {
      unitCostInOriginalCurrency: 0,
      originalCurrency: currency,
      exchangeRate: currency === "NGN" ? 1 : 0,
      unitCostInNaira: 0,
      freightAndClearingCostPerUnit: 0,
      totalCostPerUnit: subPrice,
      overheadPercentage: config.overheadPercentage,
      overheadAmount: 0,
      subPrice: subPrice,
    };

    // Update pricing record
    productPricing.costBreakdown = directCostBreakdown;
    productPricing.calculatedPricesBeforeTax = calculatedPricesBeforeTax;
    productPricing.calculatedPrices = calculatedPrices;
    productPricing.appliedMargins = config.margins;
    productPricing.appliedTaxPercentage = config.taxPercentage;
    productPricing.pricingConfig = config._id;
    productPricing.calculatedBy = request.user._id;
    productPricing.calculatedAt = new Date();
    productPricing.isApproved = true;
    productPricing.approvedBy = request.user._id;
    productPricing.approvedAt = new Date();
    productPricing.lastExchangeRateUpdate = new Date();

    await productPricing.save();

    // Update product with pricing reference
    await ProductModel.findByIdAndUpdate(productId, {
      pricing: productPricing._id,
    });

    return response.json({
      message: "Product pricing created successfully",
      data: {
        productId,
        subPrice,
        calculatedPricesBeforeTax,
        calculatedPrices,
        appliedMargins: config.margins,
        appliedTaxPercentage: config.taxPercentage,
        notes: notes || "",
        pricingId: productPricing._id,
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Create direct product pricing error:", error);
    return response.status(500).json({
      message: error.message || "Failed to create product pricing",
      error: true,
      success: false,
    });
  }
};

// Update product pricing
export const updateProductPricing = async (request, response) => {
  try {
    const { productId, price, notes } = request.body;

    // Check user role
    if (!["ACCOUNTANT", "DIRECTOR", "IT"].includes(request.user.subRole)) {
      return response.status(403).json({
        message: "Only Accountant, Director, or IT can update product pricing",
        error: true,
        success: false,
      });
    }

    if (!productId || !price || parseFloat(price) <= 0) {
      return response.status(400).json({
        message: "Product ID and valid price are required",
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
        message: "No approved pricing configuration found",
        error: true,
        success: false,
      });
    }

    const product = await ProductModel.findById(productId);
    if (!product) {
      return response.status(404).json({
        message: "Product not found",
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
    const calculatedPricesBeforeTax = {
      salePrice: Math.round(subPrice * (1 + config.margins.salePrice / 100)),
      btbPrice: Math.round(subPrice * (1 + config.margins.btbPrice / 100)),
      btcPrice: Math.round(subPrice * (1 + config.margins.btcPrice / 100)),
      price3weeksDelivery: Math.round(
        subPrice * (1 + config.margins.price3weeksDelivery / 100),
      ),
      price5weeksDelivery: Math.round(
        subPrice * (1 + config.margins.price5weeksDelivery / 100),
      ),
    };

    // NEW: Apply tax to all prices
    const calculatedPrices = {
      salePrice: Math.round(
        calculatedPricesBeforeTax.salePrice * (1 + config.taxPercentage / 100),
      ),
      btbPrice: Math.round(
        calculatedPricesBeforeTax.btbPrice * (1 + config.taxPercentage / 100),
      ),
      btcPrice: Math.round(
        calculatedPricesBeforeTax.btcPrice * (1 + config.taxPercentage / 100),
      ),
      price3weeksDelivery: Math.round(
        calculatedPricesBeforeTax.price3weeksDelivery *
          (1 + config.taxPercentage / 100),
      ),
      price5weeksDelivery: Math.round(
        calculatedPricesBeforeTax.price5weeksDelivery *
          (1 + config.taxPercentage / 100),
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
      calculatedPricesBeforeTax: existingPricing.calculatedPricesBeforeTax,
      calculatedPrices: existingPricing.calculatedPrices,
      appliedMargins: existingPricing.appliedMargins,
      appliedTaxPercentage: existingPricing.appliedTaxPercentage,
      calculatedAt: existingPricing.calculatedAt,
      calculatedBy: existingPricing.calculatedBy,
    });

    // Update pricing record
    existingPricing.calculatedPricesBeforeTax = calculatedPricesBeforeTax;
    existingPricing.calculatedPrices = calculatedPrices;
    existingPricing.appliedMargins = config.margins;
    existingPricing.appliedTaxPercentage = config.taxPercentage;
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
      message: "Product pricing updated successfully",
      data: {
        productId,
        subPrice,
        calculatedPricesBeforeTax,
        calculatedPrices,
        appliedMargins: config.margins,
        appliedTaxPercentage: config.taxPercentage,
        notes: notes || "",
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Update product pricing error:", error);
    return response.status(500).json({
      message: error.message || "Failed to update product pricing",
      error: true,
      success: false,
    });
  }
};

// ==========================================
// EXPORT FUNCTIONALITY (CSV & PDF)
// ==========================================

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
      allProducts = false, // NEW: Get all products option
    } = request.query;

    // Build aggregation pipeline
    const pipeline = [
      {
        $lookup: {
          from: "products",
          localField: "product",
          foreignField: "_id",
          as: "productDetails",
        },
      },
      {
        $unwind: "$productDetails",
      },
    ];

    // Add lookups for category and brand if filtering
    if (category || brand) {
      pipeline.push(
        {
          $lookup: {
            from: "categories",
            localField: "productDetails.category",
            foreignField: "_id",
            as: "categoryDetails",
          },
        },
        {
          $lookup: {
            from: "brands",
            localField: "productDetails.brand",
            foreignField: "_id",
            as: "brandDetails",
          },
        },
      );
    }

    // Build match conditions
    const matchConditions = { isActive: true };

    if (search) {
      matchConditions["productDetails.name"] = {
        $regex: search,
        $options: "i",
      };
    }

    if (category) {
      matchConditions["categoryDetails._id"] = new mongoose.Types.ObjectId(
        category,
      );
    }

    if (brand) {
      matchConditions["brandDetails._id"] = new mongoose.Types.ObjectId(brand);
    }

    if (isApproved !== undefined) {
      matchConditions.isApproved = isApproved === "true";
    }

    if (productType) {
      matchConditions["productDetails.productType"] = productType;
    }

    pipeline.push({ $match: matchConditions });

    // Add pagination (skip if allProducts is true)
    if (!allProducts || allProducts === "false") {
      const skip = (page - 1) * limit;
      pipeline.push({ $skip: skip }, { $limit: parseInt(limit) });
    }

    // Add user details lookup
    pipeline.push(
      {
        $lookup: {
          from: "users",
          localField: "calculatedBy",
          foreignField: "_id",
          as: "calculatedByDetails",
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "approvedBy",
          foreignField: "_id",
          as: "approvedByDetails",
        },
      },
    );

    const [results, totalCount] = await Promise.all([
      ProductPricingModel.aggregate(pipeline),
      ProductPricingModel.countDocuments(matchConditions),
    ]);

    return response.json({
      message: "Product pricing list retrieved successfully",
      data: results,
      totalCount,
      totalPages: allProducts === "true" ? 1 : Math.ceil(totalCount / limit),
      currentPage: parseInt(page),
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Get product pricing list error:", error);
    return response.status(500).json({
      message: error.message || "Failed to get product pricing list",
      error: true,
      success: false,
    });
  }
};

// NEW: Export product pricing to CSV
export const exportProductPricingCSV = async (request, response) => {
  try {
    const {
      search,
      category,
      brand,
      productType,
      columns = "all", // 'all', 'basePrice', 'salePrice', 'btbPrice', etc.
      allProducts = false,
      limit = 20,
    } = request.query;

    // Build aggregation pipeline (similar to getProductPricingList)
    const pipeline = [
      {
        $lookup: {
          from: "products",
          localField: "product",
          foreignField: "_id",
          as: "productDetails",
        },
      },
      {
        $unwind: "$productDetails",
      },
    ];

    // Build match conditions
    const matchConditions = { isActive: true };

    if (search) {
      matchConditions["productDetails.name"] = {
        $regex: search,
        $options: "i",
      };
    }

    if (category) {
      pipeline.push({
        $lookup: {
          from: "categories",
          localField: "productDetails.category",
          foreignField: "_id",
          as: "categoryDetails",
        },
      });
      matchConditions["categoryDetails._id"] = new mongoose.Types.ObjectId(
        category,
      );
    }

    if (brand) {
      pipeline.push({
        $lookup: {
          from: "brands",
          localField: "productDetails.brand",
          foreignField: "_id",
          as: "brandDetails",
        },
      });
      matchConditions["brandDetails._id"] = new mongoose.Types.ObjectId(brand);
    }

    if (productType) {
      matchConditions["productDetails.productType"] = productType;
    }

    pipeline.push({ $match: matchConditions });

    // Apply limit if not exporting all products
    if (!allProducts || allProducts === "false") {
      pipeline.push({ $limit: parseInt(limit) });
    }

    const products = await ProductPricingModel.aggregate(pipeline);

    // Build CSV based on selected columns
    const selectedColumns = columns.split(",");

    const headers = ["Product Name", "SKU", "Product Type"];

    if (columns === "all" || selectedColumns.includes("basePrice")) {
      headers.push("Base Price (Sub Price)");
    }
    if (columns === "all" || selectedColumns.includes("salePrice")) {
      headers.push("Sale Price (With Tax)");
    }
    if (columns === "all" || selectedColumns.includes("btbPrice")) {
      headers.push("BTB Price (With Tax)");
    }
    if (columns === "all" || selectedColumns.includes("btcPrice")) {
      headers.push("BTC Price (With Tax)");
    }
    if (columns === "all" || selectedColumns.includes("price3weeks")) {
      headers.push("3 Weeks Delivery (With Tax)");
    }
    if (columns === "all" || selectedColumns.includes("price5weeks")) {
      headers.push("5 Weeks Delivery (With Tax)");
    }
    if (columns === "all") {
      headers.push("Tax %", "Stock", "Status");
    }

    const csvData = products.map((product) => {
      const row = [
        product.productDetails.name || "",
        product.productDetails.sku || "",
        product.productDetails.productType || "",
      ];

      if (columns === "all" || selectedColumns.includes("basePrice")) {
        row.push(product.costBreakdown?.subPrice || 0);
      }
      if (columns === "all" || selectedColumns.includes("salePrice")) {
        row.push(product.calculatedPrices?.salePrice || 0);
      }
      if (columns === "all" || selectedColumns.includes("btbPrice")) {
        row.push(product.calculatedPrices?.btbPrice || 0);
      }
      if (columns === "all" || selectedColumns.includes("btcPrice")) {
        row.push(product.calculatedPrices?.btcPrice || 0);
      }
      if (columns === "all" || selectedColumns.includes("price3weeks")) {
        row.push(product.calculatedPrices?.price3weeksDelivery || 0);
      }
      if (columns === "all" || selectedColumns.includes("price5weeks")) {
        row.push(product.calculatedPrices?.price5weeksDelivery || 0);
      }
      if (columns === "all") {
        row.push(
          product.appliedTaxPercentage || 0,
          product.productDetails.stock || 0,
          product.productDetails.productAvailability
            ? "Available"
            : "Unavailable",
        );
      }

      return row;
    });

    const csvContent = [headers, ...csvData]
      .map((row) => row.map((field) => `"${field}"`).join(","))
      .join("\n");

    const filename = `product_pricing_${
      new Date().toISOString().split("T")[0]
    }.csv`;

    response.setHeader("Content-Type", "text/csv");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );

    return response.send(csvContent);
  } catch (error) {
    console.error("Export CSV error:", error);
    return response.status(500).json({
      message: error.message || "Failed to export CSV",
      error: true,
      success: false,
    });
  }
};

// NEW: Export product pricing to PDF
export const exportProductPricingPDF = async (request, response) => {
  try {
    const {
      search,
      category,
      brand,
      productType,
      columns = "all",
      allProducts = false,
      limit = 20,
    } = request.query;

    // Build aggregation pipeline (similar to CSV export)
    const pipeline = [
      {
        $lookup: {
          from: "products",
          localField: "product",
          foreignField: "_id",
          as: "productDetails",
        },
      },
      {
        $unwind: "$productDetails",
      },
    ];

    // Build match conditions
    const matchConditions = { isActive: true };

    if (search) {
      matchConditions["productDetails.name"] = {
        $regex: search,
        $options: "i",
      };
    }

    if (category) {
      pipeline.push({
        $lookup: {
          from: "categories",
          localField: "productDetails.category",
          foreignField: "_id",
          as: "categoryDetails",
        },
      });
      matchConditions["categoryDetails._id"] = new mongoose.Types.ObjectId(
        category,
      );
    }

    if (brand) {
      pipeline.push({
        $lookup: {
          from: "brands",
          localField: "productDetails.brand",
          foreignField: "_id",
          as: "brandDetails",
        },
      });
      matchConditions["brandDetails._id"] = new mongoose.Types.ObjectId(brand);
    }

    if (productType) {
      matchConditions["productDetails.productType"] = productType;
    }

    pipeline.push({ $match: matchConditions });

    // Apply limit if not exporting all products
    if (!allProducts || allProducts === "false") {
      pipeline.push({ $limit: parseInt(limit) });
    }

    const products = await ProductPricingModel.aggregate(pipeline);

    // Create PDF document
    const doc = new PDFDocument({
      margin: 30,
      size: "A4",
      layout: "landscape",
    });

    const filename = `product_pricing_${
      new Date().toISOString().split("T")[0]
    }.pdf`;

    response.setHeader("Content-Type", "application/pdf");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );

    doc.pipe(response);

    // Add title
    doc.fontSize(18).text("Product Pricing Report", { align: "center" });
    doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`, {
      align: "center",
    });
    doc.moveDown();

    const selectedColumns = columns.split(",");

    // Define table structure
    const tableTop = 150;
    const itemHeight = 20;
    let currentY = tableTop;

    // Column widths (adjust based on selected columns)
    const columnWidths = {
      name: 120,
      sku: 80,
      type: 60,
      basePrice: 70,
      salePrice: 70,
      btbPrice: 70,
      btcPrice: 70,
      price3weeks: 70,
      price5weeks: 70,
      tax: 40,
      stock: 40,
    };

    // Draw table headers
    doc.fontSize(9).font("Helvetica-Bold");
    let currentX = 50;

    const drawHeader = (text, width) => {
      doc.text(text, currentX, currentY, { width, align: "left" });
      currentX += width;
    };

    drawHeader("Product Name", columnWidths.name);
    drawHeader("SKU", columnWidths.sku);
    drawHeader("Type", columnWidths.type);

    if (columns === "all" || selectedColumns.includes("basePrice")) {
      drawHeader("Base Price", columnWidths.basePrice);
    }
    if (columns === "all" || selectedColumns.includes("salePrice")) {
      drawHeader("Sale Price", columnWidths.salePrice);
    }
    if (columns === "all" || selectedColumns.includes("btbPrice")) {
      drawHeader("BTB Price", columnWidths.btbPrice);
    }
    if (columns === "all" || selectedColumns.includes("btcPrice")) {
      drawHeader("BTC Price", columnWidths.btcPrice);
    }
    if (columns === "all" || selectedColumns.includes("price3weeks")) {
      drawHeader("3 Weeks", columnWidths.price3weeks);
    }
    if (columns === "all" || selectedColumns.includes("price5weeks")) {
      drawHeader("5 Weeks", columnWidths.price5weeks);
    }
    if (columns === "all") {
      drawHeader("Tax%", columnWidths.tax);
      drawHeader("Stock", columnWidths.stock);
    }

    currentY += itemHeight;

    // Draw horizontal line after headers
    doc.moveTo(50, currentY).lineTo(800, currentY).stroke();

    currentY += 5;

    // Draw table rows
    doc.font("Helvetica").fontSize(8);

    for (const product of products) {
      // Check if we need a new page
      if (currentY > 550) {
        doc.addPage();
        currentY = 50;
      }

      currentX = 50;

      const drawCell = (text, width) => {
        doc.text(String(text), currentX, currentY, { width, align: "left" });
        currentX += width;
      };

      drawCell(
        product.productDetails.name?.substring(0, 30) || "",
        columnWidths.name,
      );
      drawCell(product.productDetails.sku || "", columnWidths.sku);
      drawCell(product.productDetails.productType || "", columnWidths.type);

      const formatPrice = (price) => `₦${Number(price || 0).toLocaleString()}`;

      if (columns === "all" || selectedColumns.includes("basePrice")) {
        drawCell(
          formatPrice(product.costBreakdown?.subPrice),
          columnWidths.basePrice,
        );
      }
      if (columns === "all" || selectedColumns.includes("salePrice")) {
        drawCell(
          formatPrice(product.calculatedPrices?.salePrice),
          columnWidths.salePrice,
        );
      }
      if (columns === "all" || selectedColumns.includes("btbPrice")) {
        drawCell(
          formatPrice(product.calculatedPrices?.btbPrice),
          columnWidths.btbPrice,
        );
      }
      if (columns === "all" || selectedColumns.includes("btcPrice")) {
        drawCell(
          formatPrice(product.calculatedPrices?.btcPrice),
          columnWidths.btcPrice,
        );
      }
      if (columns === "all" || selectedColumns.includes("price3weeks")) {
        drawCell(
          formatPrice(product.calculatedPrices?.price3weeksDelivery),
          columnWidths.price3weeks,
        );
      }
      if (columns === "all" || selectedColumns.includes("price5weeks")) {
        drawCell(
          formatPrice(product.calculatedPrices?.price5weeksDelivery),
          columnWidths.price5weeks,
        );
      }
      if (columns === "all") {
        drawCell(`${product.appliedTaxPercentage || 0}%`, columnWidths.tax);
        drawCell(product.productDetails.stock || 0, columnWidths.stock);
      }

      currentY += itemHeight;
    }

    // Add footer
    doc
      .fontSize(8)
      .text(`Total Products: ${products.length}`, 50, doc.page.height - 50, {
        align: "center",
      });

    doc.end();
  } catch (error) {
    console.error("Export PDF error:", error);
    return response.status(500).json({
      message: error.message || "Failed to export PDF",
      error: true,
      success: false,
    });
  }
};

// ==========================================
// IMPORT FUNCTIONALITY
// ==========================================

// NEW: Import pricing from CSV
export const importProductPricingCSV = async (request, response) => {
  try {
    // Check user role
    if (!["ACCOUNTANT", "DIRECTOR", "IT"].includes(request.user.subRole)) {
      return response.status(403).json({
        message: "Only Accountant, Director, or IT can import pricing",
        error: true,
        success: false,
      });
    }

    const { csvData, updateMode = "basePrice" } = request.body;
    // updateMode: 'basePrice' (only product + base price columns) or 'fullPrices' (all price columns)

    if (!csvData) {
      return response.status(400).json({
        message: "CSV data is required",
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
        message: "No approved pricing configuration found",
        error: true,
        success: false,
      });
    }

    // Parse CSV data
    const rows = [];
    const stream = Readable.from([csvData]);

    await new Promise((resolve, reject) => {
      stream
        .pipe(csv())
        .on("data", (row) => rows.push(row))
        .on("end", resolve)
        .on("error", reject);
    });

    const results = {
      successful: [],
      failed: [],
      totalProcessed: 0,
    };

    for (const row of rows) {
      try {
        results.totalProcessed++;

        // Find product by SKU
        const product = await ProductModel.findOne({ sku: row["SKU"] });

        if (!product) {
          results.failed.push({
            sku: row["SKU"],
            reason: "Product not found",
          });
          continue;
        }

        if (updateMode === "basePrice") {
          // Mode 1: Only base price column - calculate other prices from config
          const basePrice = parseFloat(row["Base Price (Sub Price)"]);

          if (!basePrice || isNaN(basePrice) || basePrice <= 0) {
            results.failed.push({
              sku: row["SKU"],
              reason: "Invalid base price",
            });
            continue;
          }

          // Calculate all prices using config
          const calculatedPricesBeforeTax = {
            salePrice: Math.round(
              basePrice * (1 + config.margins.salePrice / 100),
            ),
            btbPrice: Math.round(
              basePrice * (1 + config.margins.btbPrice / 100),
            ),
            btcPrice: Math.round(
              basePrice * (1 + config.margins.btcPrice / 100),
            ),
            price3weeksDelivery: Math.round(
              basePrice * (1 + config.margins.price3weeksDelivery / 100),
            ),
            price5weeksDelivery: Math.round(
              basePrice * (1 + config.margins.price5weeksDelivery / 100),
            ),
          };

          // Apply tax
          const calculatedPrices = {
            salePrice: Math.round(
              calculatedPricesBeforeTax.salePrice *
                (1 + config.taxPercentage / 100),
            ),
            btbPrice: Math.round(
              calculatedPricesBeforeTax.btbPrice *
                (1 + config.taxPercentage / 100),
            ),
            btcPrice: Math.round(
              calculatedPricesBeforeTax.btcPrice *
                (1 + config.taxPercentage / 100),
            ),
            price3weeksDelivery: Math.round(
              calculatedPricesBeforeTax.price3weeksDelivery *
                (1 + config.taxPercentage / 100),
            ),
            price5weeksDelivery: Math.round(
              calculatedPricesBeforeTax.price5weeksDelivery *
                (1 + config.taxPercentage / 100),
            ),
          };

          // Update product
          await ProductModel.findByIdAndUpdate(product._id, {
            price: basePrice,
            salePrice: calculatedPrices.salePrice,
            btbPrice: calculatedPrices.btbPrice,
            btcPrice: calculatedPrices.btcPrice,
            price3weeksDelivery: calculatedPrices.price3weeksDelivery,
            price5weeksDelivery: calculatedPrices.price5weeksDelivery,
            updatedBy: request.user._id,
          });

          // Update ProductPricing record
          let productPricing = await ProductPricingModel.findOne({
            product: product._id,
          });

          if (productPricing) {
            productPricing.priceHistory.push({
              calculatedPricesBeforeTax:
                productPricing.calculatedPricesBeforeTax,
              calculatedPrices: productPricing.calculatedPrices,
              appliedMargins: productPricing.appliedMargins,
              appliedTaxPercentage: productPricing.appliedTaxPercentage,
              calculatedAt: productPricing.calculatedAt,
              calculatedBy: productPricing.calculatedBy,
            });
          } else {
            productPricing = new ProductPricingModel({
              product: product._id,
              costBreakdown: {
                unitCostInOriginalCurrency: 0,
                originalCurrency: "NGN",
                exchangeRate: 1,
                unitCostInNaira: 0,
                freightAndClearingCostPerUnit: 0,
                totalCostPerUnit: basePrice,
                overheadPercentage: config.overheadPercentage,
                overheadAmount: 0,
                subPrice: basePrice,
              },
            });
          }

          productPricing.calculatedPricesBeforeTax = calculatedPricesBeforeTax;
          productPricing.calculatedPrices = calculatedPrices;
          productPricing.appliedMargins = config.margins;
          productPricing.appliedTaxPercentage = config.taxPercentage;
          productPricing.pricingConfig = config._id;
          productPricing.calculatedBy = request.user._id;
          productPricing.calculatedAt = new Date();
          productPricing.isApproved = true;
          productPricing.approvedBy = request.user._id;
          productPricing.approvedAt = new Date();

          await productPricing.save();

          results.successful.push({
            sku: row["SKU"],
            name: product.name,
            basePrice,
            calculatedPrices,
          });
        } else if (updateMode === "fullPrices") {
          // Mode 2: All price columns provided - use them directly
          const basePrice = parseFloat(row["Base Price (Sub Price)"]);
          const salePrice = parseFloat(row["Sale Price (With Tax)"]);
          const btbPrice = parseFloat(row["BTB Price (With Tax)"]);
          const btcPrice = parseFloat(row["BTC Price (With Tax)"]);
          const price3weeks = parseFloat(row["3 Weeks Delivery (With Tax)"]);
          const price5weeks = parseFloat(row["5 Weeks Delivery (With Tax)"]);

          // Validate all prices
          if (
            !basePrice ||
            !salePrice ||
            !btbPrice ||
            !btcPrice ||
            !price3weeks ||
            !price5weeks ||
            isNaN(basePrice) ||
            isNaN(salePrice)
          ) {
            results.failed.push({
              sku: row["SKU"],
              reason: "Invalid or missing price columns",
            });
            continue;
          }

          const calculatedPrices = {
            salePrice: Math.round(salePrice),
            btbPrice: Math.round(btbPrice),
            btcPrice: Math.round(btcPrice),
            price3weeksDelivery: Math.round(price3weeks),
            price5weeksDelivery: Math.round(price5weeks),
          };

          // Calculate prices before tax (reverse calculation)
          const calculatedPricesBeforeTax = {
            salePrice: Math.round(
              calculatedPrices.salePrice / (1 + config.taxPercentage / 100),
            ),
            btbPrice: Math.round(
              calculatedPrices.btbPrice / (1 + config.taxPercentage / 100),
            ),
            btcPrice: Math.round(
              calculatedPrices.btcPrice / (1 + config.taxPercentage / 100),
            ),
            price3weeksDelivery: Math.round(
              calculatedPrices.price3weeksDelivery /
                (1 + config.taxPercentage / 100),
            ),
            price5weeksDelivery: Math.round(
              calculatedPrices.price5weeksDelivery /
                (1 + config.taxPercentage / 100),
            ),
          };

          // Update product
          await ProductModel.findByIdAndUpdate(product._id, {
            price: basePrice,
            salePrice: calculatedPrices.salePrice,
            btbPrice: calculatedPrices.btbPrice,
            btcPrice: calculatedPrices.btcPrice,
            price3weeksDelivery: calculatedPrices.price3weeksDelivery,
            price5weeksDelivery: calculatedPrices.price5weeksDelivery,
            updatedBy: request.user._id,
          });

          // Update ProductPricing record
          let productPricing = await ProductPricingModel.findOne({
            product: product._id,
          });

          if (productPricing) {
            productPricing.priceHistory.push({
              calculatedPricesBeforeTax:
                productPricing.calculatedPricesBeforeTax,
              calculatedPrices: productPricing.calculatedPrices,
              appliedMargins: productPricing.appliedMargins,
              appliedTaxPercentage: productPricing.appliedTaxPercentage,
              calculatedAt: productPricing.calculatedAt,
              calculatedBy: productPricing.calculatedBy,
            });
          } else {
            productPricing = new ProductPricingModel({
              product: product._id,
              costBreakdown: {
                unitCostInOriginalCurrency: 0,
                originalCurrency: "NGN",
                exchangeRate: 1,
                unitCostInNaira: 0,
                freightAndClearingCostPerUnit: 0,
                totalCostPerUnit: basePrice,
                overheadPercentage: config.overheadPercentage,
                overheadAmount: 0,
                subPrice: basePrice,
              },
            });
          }

          productPricing.calculatedPricesBeforeTax = calculatedPricesBeforeTax;
          productPricing.calculatedPrices = calculatedPrices;
          productPricing.appliedMargins = config.margins;
          productPricing.appliedTaxPercentage = config.taxPercentage;
          productPricing.pricingConfig = config._id;
          productPricing.calculatedBy = request.user._id;
          productPricing.calculatedAt = new Date();
          productPricing.isApproved = true;
          productPricing.approvedBy = request.user._id;
          productPricing.approvedAt = new Date();

          await productPricing.save();

          results.successful.push({
            sku: row["SKU"],
            name: product.name,
            basePrice,
            calculatedPrices,
          });
        }
      } catch (error) {
        results.failed.push({
          sku: row["SKU"],
          reason: error.message,
        });
      }
    }

    return response.json({
      message: `Import completed: ${results.successful.length} successful, ${results.failed.length} failed`,
      data: results,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Import CSV error:", error);
    return response.status(500).json({
      message: error.message || "Failed to import CSV",
      error: true,
      success: false,
    });
  }
};

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

// Utility function to calculate product pricing (UPDATED WITH TAX)
const calculateProductPricing = ({
  unitCostInOriginalCurrency,
  originalCurrency,
  exchangeRate,
  logisticsCostPerUnit,
  margins,
  overheadPercentage,
  taxPercentage, // NEW
}) => {
  // Convert to Naira
  const unitCostInNaira = unitCostInOriginalCurrency * exchangeRate;

  // Add logistics cost
  const totalCostPerUnit = unitCostInNaira + logisticsCostPerUnit;

  // Calculate overhead
  const overheadAmount = totalCostPerUnit * (overheadPercentage / 100);
  const subPrice = totalCostPerUnit + overheadAmount;

  // Calculate different price types (BEFORE TAX)
  const calculatedPricesBeforeTax = {
    salePrice: Math.round(subPrice * (1 + margins.salePrice / 100)),
    btbPrice: Math.round(subPrice * (1 + margins.btbPrice / 100)),
    btcPrice: Math.round(subPrice * (1 + margins.btcPrice / 100)),
    price3weeksDelivery: Math.round(
      subPrice * (1 + margins.price3weeksDelivery / 100),
    ),
    price5weeksDelivery: Math.round(
      subPrice * (1 + margins.price5weeksDelivery / 100),
    ),
  };

  // NEW: Apply tax to all prices
  const calculatedPrices = {
    salePrice: Math.round(
      calculatedPricesBeforeTax.salePrice * (1 + taxPercentage / 100),
    ),
    btbPrice: Math.round(
      calculatedPricesBeforeTax.btbPrice * (1 + taxPercentage / 100),
    ),
    btcPrice: Math.round(
      calculatedPricesBeforeTax.btcPrice * (1 + taxPercentage / 100),
    ),
    price3weeksDelivery: Math.round(
      calculatedPricesBeforeTax.price3weeksDelivery * (1 + taxPercentage / 100),
    ),
    price5weeksDelivery: Math.round(
      calculatedPricesBeforeTax.price5weeksDelivery * (1 + taxPercentage / 100),
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
    calculatedPricesBeforeTax,
    calculatedPrices,
    appliedMargins: margins,
    appliedTaxPercentage: taxPercentage,
  };
};

// Utility function to get current exchange rate
const getCurrentExchangeRate = async (fromCurrency) => {
  try {
    if (fromCurrency === "NGN") return 1;

    const rate = await ExchangeRateModel.getRate(fromCurrency, "NGN");
    return rate || 1;
  } catch (error) {
    console.error("Exchange rate fetch error:", error);
    return 1;
  }
};

// Utility function to recalculate all product prices
const recalculateAllProductPrices = async (pricingConfigId, userId) => {
  try {
    const config = await PricingConfigModel.findById(pricingConfigId);
    const productPricings = await ProductPricingModel.find({
      isActive: true,
    }).populate("product", "name sku");

    for (const pricing of productPricings) {
      const currentExchangeRate = await getCurrentExchangeRate(
        pricing.costBreakdown.originalCurrency,
      );

      const newCalculations = calculateProductPricing({
        unitCostInOriginalCurrency:
          pricing.costBreakdown.unitCostInOriginalCurrency,
        originalCurrency: pricing.costBreakdown.originalCurrency,
        exchangeRate: currentExchangeRate,
        logisticsCostPerUnit:
          pricing.costBreakdown.freightAndClearingCostPerUnit,
        margins: config.margins,
        overheadPercentage: config.overheadPercentage,
        taxPercentage: config.taxPercentage, // NEW
      });

      // Save to history
      pricing.priceHistory.push({
        calculatedPricesBeforeTax: pricing.calculatedPricesBeforeTax,
        calculatedPrices: pricing.calculatedPrices,
        appliedMargins: pricing.appliedMargins,
        appliedTaxPercentage: pricing.appliedTaxPercentage,
        exchangeRate: pricing.costBreakdown.exchangeRate,
        calculatedAt: pricing.calculatedAt,
        calculatedBy: pricing.calculatedBy,
      });

      // Update with new calculations
      pricing.costBreakdown = newCalculations.costBreakdown;
      pricing.calculatedPricesBeforeTax =
        newCalculations.calculatedPricesBeforeTax;
      pricing.calculatedPrices = newCalculations.calculatedPrices;
      pricing.appliedMargins = newCalculations.appliedMargins;
      pricing.appliedTaxPercentage = newCalculations.appliedTaxPercentage;
      pricing.pricingConfig = pricingConfigId;
      pricing.calculatedBy = userId;
      pricing.calculatedAt = new Date();
      pricing.lastExchangeRateUpdate = new Date();

      await pricing.save();

      // Update product model
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
        productUpdateData,
      );
    }
  } catch (error) {
    console.error("Recalculate all prices error:", error);
    throw error;
  }
};

// Update prices when exchange rates change
export const updatePricesOnExchangeRateChange = async (request, response) => {
  try {
    const { currency, newRate } = request.body;

    const config = await PricingConfigModel.findOne({
      isActive: true,
      isApproved: true,
    });
    if (!config || !config.autoUpdateOnExchangeRateChange) {
      return response.json({
        message: "Auto-update is disabled or no approved config found",
        error: false,
        success: true,
      });
    }

    const productPricings = await ProductPricingModel.find({
      "costBreakdown.originalCurrency": currency,
      isActive: true,
    });

    let updatedCount = 0;

    for (const pricing of productPricings) {
      const newCalculations = calculateProductPricing({
        unitCostInOriginalCurrency:
          pricing.costBreakdown.unitCostInOriginalCurrency,
        originalCurrency: currency,
        exchangeRate: newRate,
        logisticsCostPerUnit:
          pricing.costBreakdown.freightAndClearingCostPerUnit,
        margins: config.margins,
        overheadPercentage: config.overheadPercentage,
        taxPercentage: config.taxPercentage, // NEW
      });

      pricing.costBreakdown = newCalculations.costBreakdown;
      pricing.calculatedPricesBeforeTax =
        newCalculations.calculatedPricesBeforeTax;
      pricing.calculatedPrices = newCalculations.calculatedPrices;
      pricing.appliedTaxPercentage = newCalculations.appliedTaxPercentage;
      pricing.lastExchangeRateUpdate = new Date();

      await pricing.save();

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
    console.error("Update prices on exchange rate change error:", error);
    return response.status(500).json({
      message: error.message || "Failed to update prices",
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
        message: "Currency is required",
        error: true,
        success: false,
      });
    }

    const currentRate = await getCurrentExchangeRate(currency);

    const result = await updatePricesOnExchangeRateChange(
      { body: { currency, newRate: currentRate } },
      { json: () => {} },
    );

    return response.json({
      message: `Bulk recalculation completed for ${currency}`,
      data: { currency, rate: currentRate },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Bulk recalculate prices error:", error);
    return response.status(500).json({
      message: error.message || "Failed to bulk recalculate prices",
      error: true,
      success: false,
    });
  }
};
// FIXED: Export product pricing to CSV for price listing system management component
export const exportProductPricingCSVPLM = async (request, response) => {
  try {
    const {
      search,
      category,
      brand,
      productType,
      columns = "all",
      allProducts = false,
      limit = 20,
    } = request.query;

    // Build query for Product model (NOT ProductPricing)
    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { sku: { $regex: search, $options: "i" } },
      ];
    }

    if (category) {
      query.category = category;
    }

    if (brand) {
      query.brand = { $in: [brand] };
    }

    if (productType) {
      query.productType = productType;
    }

    // Get products with proper limit
    let productsQuery = ProductModel.find(query)
      .populate("brand", "name")
      .populate("category", "name")
      .sort({ createdAt: -1 });

    // Apply limit if not exporting all products
    if (!allProducts || allProducts === "false") {
      productsQuery = productsQuery.limit(parseInt(limit));
    }

    const products = await productsQuery;

    // Build CSV based on selected columns
    const selectedColumns = columns.split(",");

    const headers = ["Product Name", "SKU", "Product Type"];

    if (columns === "all" || selectedColumns.includes("basePrice")) {
      headers.push("Base Price (Sub Price)");
    }
    if (columns === "all" || selectedColumns.includes("salePrice")) {
      headers.push("Sale Price (With Tax)");
    }
    if (columns === "all" || selectedColumns.includes("btbPrice")) {
      headers.push("BTB Price (With Tax)");
    }
    if (columns === "all" || selectedColumns.includes("btcPrice")) {
      headers.push("BTC Price (With Tax)");
    }
    if (columns === "all" || selectedColumns.includes("price3weeks")) {
      headers.push("3 Weeks Delivery (With Tax)");
    }
    if (columns === "all" || selectedColumns.includes("price5weeks")) {
      headers.push("5 Weeks Delivery (With Tax)");
    }
    if (columns === "all") {
      headers.push("Stock", "Status");
    }

    const csvData = products.map((product) => {
      const row = [
        product.name || "",
        product.sku || "",
        product.productType || "",
      ];

      if (columns === "all" || selectedColumns.includes("basePrice")) {
        row.push(product.price || 0);
      }
      if (columns === "all" || selectedColumns.includes("salePrice")) {
        row.push(product.salePrice || 0);
      }
      if (columns === "all" || selectedColumns.includes("btbPrice")) {
        row.push(product.btbPrice || 0);
      }
      if (columns === "all" || selectedColumns.includes("btcPrice")) {
        row.push(product.btcPrice || 0);
      }
      if (columns === "all" || selectedColumns.includes("price3weeks")) {
        row.push(product.price3weeksDelivery || 0);
      }
      if (columns === "all" || selectedColumns.includes("price5weeks")) {
        row.push(product.price5weeksDelivery || 0);
      }
      if (columns === "all") {
        row.push(
          product.stock || 0,
          product.productAvailability ? "Available" : "Unavailable",
        );
      }

      return row;
    });

    const csvContent = [headers, ...csvData]
      .map((row) => row.map((field) => `"${field}"`).join(","))
      .join("\n");

    const filename = `product_pricing_${
      new Date().toISOString().split("T")[0]
    }.csv`;

    response.setHeader("Content-Type", "text/csv");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );

    return response.send(csvContent);
  } catch (error) {
    console.error("Export CSV error:", error);
    return response.status(500).json({
      message: error.message || "Failed to export CSV",
      error: true,
      success: false,
    });
  }
};

// FIXED: Export product pricing to PDF
export const exportProductPricingPDFPLM = async (request, response) => {
  try {
    const {
      search,
      category,
      brand,
      productType,
      columns = "all",
      allProducts = false,
      limit = 20,
    } = request.query;

    // Build query for Product model (NOT ProductPricing)
    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { sku: { $regex: search, $options: "i" } },
      ];
    }

    if (category) {
      query.category = category;
    }

    if (brand) {
      query.brand = { $in: [brand] };
    }

    if (productType) {
      query.productType = productType;
    }

    // Get products with proper limit
    let productsQuery = ProductModel.find(query)
      .populate("brand", "name")
      .populate("category", "name")
      .sort({ createdAt: -1 });

    // Apply limit if not exporting all products
    if (!allProducts || allProducts === "false") {
      productsQuery = productsQuery.limit(parseInt(limit));
    }

    const products = await productsQuery;

    // Create PDF document
    const doc = new PDFDocument({
      margin: 30,
      size: "A4",
      layout: "landscape",
    });

    const filename = `product_pricing_${
      new Date().toISOString().split("T")[0]
    }.pdf`;

    response.setHeader("Content-Type", "application/pdf");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );

    doc.pipe(response);

    // Add title
    doc.fontSize(18).text("Product Pricing Report", { align: "center" });
    doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`, {
      align: "center",
    });
    doc.moveDown();

    const selectedColumns = columns.split(",");

    // Define table structure
    const tableTop = 150;
    const itemHeight = 20;
    let currentY = tableTop;

    // Column widths (adjust based on selected columns)
    const columnWidths = {
      name: 150,
      sku: 100,
      type: 80,
      basePrice: 70,
      salePrice: 70,
      btbPrice: 70,
      btcPrice: 70,
      price3weeks: 70,
      price5weeks: 70,
      stock: 50,
    };

    // Draw table headers
    doc.fontSize(9).font("Helvetica-Bold");
    let currentX = 50;

    const drawHeader = (text, width) => {
      doc.text(text, currentX, currentY, { width, align: "left" });
      currentX += width;
    };

    drawHeader("Product Name", columnWidths.name);
    drawHeader("SKU", columnWidths.sku);
    drawHeader("Type", columnWidths.type);

    if (columns === "all" || selectedColumns.includes("basePrice")) {
      drawHeader("Base Price", columnWidths.basePrice);
    }
    if (columns === "all" || selectedColumns.includes("salePrice")) {
      drawHeader("Sale Price", columnWidths.salePrice);
    }
    if (columns === "all" || selectedColumns.includes("btbPrice")) {
      drawHeader("BTB Price", columnWidths.btbPrice);
    }
    if (columns === "all" || selectedColumns.includes("btcPrice")) {
      drawHeader("BTC Price", columnWidths.btcPrice);
    }
    if (columns === "all" || selectedColumns.includes("price3weeks")) {
      drawHeader("3 Weeks", columnWidths.price3weeks);
    }
    if (columns === "all" || selectedColumns.includes("price5weeks")) {
      drawHeader("5 Weeks", columnWidths.price5weeks);
    }
    if (columns === "all") {
      drawHeader("Stock", columnWidths.stock);
    }

    currentY += itemHeight;

    // Draw horizontal line after headers
    doc.moveTo(50, currentY).lineTo(800, currentY).stroke();

    currentY += 5;

    // Draw table rows
    doc.font("Helvetica").fontSize(8);

    for (const product of products) {
      // Check if we need a new page
      if (currentY > 550) {
        doc.addPage();
        currentY = 50;
      }

      currentX = 50;

      const drawCell = (text, width) => {
        doc.text(String(text), currentX, currentY, { width, align: "left" });
        currentX += width;
      };

      drawCell(product.name?.substring(0, 40) || "", columnWidths.name);
      drawCell(product.sku || "", columnWidths.sku);
      drawCell(product.productType || "", columnWidths.type);

      const formatPrice = (price) => `₦${Number(price || 0).toLocaleString()}`;

      if (columns === "all" || selectedColumns.includes("basePrice")) {
        drawCell(formatPrice(product.price), columnWidths.basePrice);
      }
      if (columns === "all" || selectedColumns.includes("salePrice")) {
        drawCell(formatPrice(product.salePrice), columnWidths.salePrice);
      }
      if (columns === "all" || selectedColumns.includes("btbPrice")) {
        drawCell(formatPrice(product.btbPrice), columnWidths.btbPrice);
      }
      if (columns === "all" || selectedColumns.includes("btcPrice")) {
        drawCell(formatPrice(product.btcPrice), columnWidths.btcPrice);
      }
      if (columns === "all" || selectedColumns.includes("price3weeks")) {
        drawCell(
          formatPrice(product.price3weeksDelivery),
          columnWidths.price3weeks,
        );
      }
      if (columns === "all" || selectedColumns.includes("price5weeks")) {
        drawCell(
          formatPrice(product.price5weeksDelivery),
          columnWidths.price5weeks,
        );
      }
      if (columns === "all") {
        drawCell(product.stock || 0, columnWidths.stock);
      }

      currentY += itemHeight;
    }

    // Add footer
    doc
      .fontSize(8)
      .text(`Total Products: ${products.length}`, 50, doc.page.height - 50, {
        align: "center",
      });

    doc.end();
  } catch (error) {
    console.error("Export PDF error:", error);
    return response.status(500).json({
      message: error.message || "Failed to export PDF",
      error: true,
      success: false,
    });
  }
};
