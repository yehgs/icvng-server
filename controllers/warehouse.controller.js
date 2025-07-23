// controllers/warehouse.controller.js - Updated to include weight functionality

import ProductModel from '../models/product.model.js';
import StockModel from '../models/stock.model.js';
import UserModel from '../models/user.model.js';
import mongoose from 'mongoose';

// System settings
let systemSettings = {
  enabled: true,
  autoSyncEnabled: true,
  lowStockThreshold: 10,
  criticalStockThreshold: 5,
};

// Activity log storage
let activityLog = [];

// Helper function to log activities
const logActivity = (user, action, target, changes = null, notes = '') => {
  const activity = {
    id: Date.now(),
    timestamp: new Date(),
    user: {
      id: user._id,
      name: user.name,
      role: user.subRole || user.role,
    },
    action,
    target,
    changes,
    notes,
  };

  activityLog.unshift(activity);
  if (activityLog.length > 1000) {
    activityLog = activityLog.slice(0, 1000);
  }
};

// Helper function to sync stock from Stock model for a product
const syncStockFromStockModel = async (productId) => {
  try {
    const stockBatches = await StockModel.find({
      product: productId,
      status: { $in: ['AVAILABLE', 'PARTIALLY_ALLOCATED', 'RECEIVED'] },
    });

    const totals = stockBatches.reduce(
      (acc, batch) => {
        acc.stockOnArrival += batch.originalQuantity || 0;
        acc.goodQuantity += batch.goodQuantity || 0;
        acc.refurbishedQuantity += batch.refurbishedQuantity || 0;
        acc.damagedQuantity += batch.damagedQuantity || 0;
        acc.expiredQuantity += 0; // Not tracked in original Stock model, can be added
        acc.onlineStock += batch.onlineStock || 0;
        acc.offlineStock += batch.offlineStock || 0;
        return acc;
      },
      {
        stockOnArrival: 0,
        goodQuantity: 0,
        refurbishedQuantity: 0,
        damagedQuantity: 0,
        expiredQuantity: 0,
        onlineStock: 0,
        offlineStock: 0,
      }
    );

    const finalStock = totals.goodQuantity + totals.refurbishedQuantity;

    return {
      stockOnArrival: totals.stockOnArrival,
      damagedQty: totals.damagedQuantity,
      expiredQty: totals.expiredQuantity,
      refurbishedQty: totals.refurbishedQuantity,
      finalStock: finalStock,
      onlineStock: totals.onlineStock,
      offlineStock: totals.offlineStock,
      source: 'STOCK_BATCHES',
      lastUpdated: new Date(),
    };
  } catch (error) {
    console.error('Error syncing stock from Stock model:', error);
    return null;
  }
};

// Helper function to get effective stock data with consistent structure
const getEffectiveStock = async (product) => {
  if (product.warehouseStock?.enabled) {
    return {
      stockOnArrival: product.warehouseStock.stockOnArrival || 0,
      damagedQty: product.warehouseStock.damagedQty || 0,
      expiredQty: product.warehouseStock.expiredQty || 0,
      refurbishedQty: product.warehouseStock.refurbishedQty || 0,
      finalStock: product.warehouseStock.finalStock || 0,
      onlineStock: product.warehouseStock.onlineStock || 0,
      offlineStock: product.warehouseStock.offlineStock || 0,
      notes: product.warehouseStock.notes || '',
      lastUpdated: product.warehouseStock.lastUpdated,
      source: 'WAREHOUSE_MANUAL',
      isManualOverride: true,
    };
  } else {
    const stockTotals = await syncStockFromStockModel(product._id);

    if (stockTotals) {
      return stockTotals;
    } else {
      return {
        stockOnArrival: product.stock || 0,
        damagedQty: 0,
        expiredQty: 0,
        refurbishedQty: 0,
        finalStock: product.stock || 0,
        onlineStock: 0,
        offlineStock: 0,
        notes: 'Default product stock',
        lastUpdated: product.updatedAt,
        source: 'PRODUCT_DEFAULT',
        isManualOverride: false,
      };
    }
  }
};

// Get products for warehouse stock management
export const getProductsForStock = async (request, response) => {
  try {
    const {
      page = 1,
      limit = 100,
      search,
      category,
      brand,
      productType,
      compatibleSystem,
    } = request.query;

    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    if (category) query.category = category;
    if (brand) query.brand = { $in: [brand] };
    if (productType) query.productType = productType;
    if (compatibleSystem) query.compatibleSystem = compatibleSystem;

    const skip = (page - 1) * limit;

    const [products, totalCount] = await Promise.all([
      ProductModel.find(query)
        .populate('category', 'name')
        .populate('brand', 'name')
        .populate('compatibleSystem', 'name')
        .sort({ name: 1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      ProductModel.countDocuments(query),
    ]);

    const productsWithStock = await Promise.all(
      products.map(async (product) => {
        const effectiveStock = await getEffectiveStock(product);
        return {
          ...product,
          warehouseStock: effectiveStock,
        };
      })
    );

    return response.json({
      message: 'Products retrieved successfully',
      data: productsWithStock,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: parseInt(page),
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get products for stock error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to retrieve products',
      error: true,
      success: false,
    });
  }
};

// Update stock quantities (warehouse only)
export const updateStock = async (request, response) => {
  try {
    const {
      productId,
      stockOnArrival,
      damagedQty,
      expiredQty,
      refurbishedQty,
      finalStock,
      onlineStock,
      offlineStock,
      notes,
    } = request.body;

    if (!systemSettings.enabled) {
      return response.status(403).json({
        message: 'Warehouse stock system is disabled',
        error: true,
        success: false,
      });
    }

    const userRole = request.user.subRole || request.user.role;
    if (userRole !== 'WAREHOUSE') {
      return response.status(403).json({
        message: 'Only warehouse staff can update stock quantities',
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

    // Comprehensive validation including quality breakdown
    const validationErrors = [];

    if (stockOnArrival < 0)
      validationErrors.push('Stock on arrival cannot be negative');
    if (damagedQty < 0)
      validationErrors.push('Damaged quantity cannot be negative');
    if (expiredQty < 0)
      validationErrors.push('Expired quantity cannot be negative');
    if (refurbishedQty < 0)
      validationErrors.push('Refurbished quantity cannot be negative');
    if (onlineStock < 0)
      validationErrors.push('Online stock cannot be negative');
    if (offlineStock < 0)
      validationErrors.push('Offline stock cannot be negative');

    // Quality breakdown validation
    const totalProcessed =
      damagedQty + expiredQty + refurbishedQty + finalStock;
    if (totalProcessed !== stockOnArrival) {
      validationErrors.push(
        'Total processed quantities must equal stock on arrival'
      );
    }

    // Distribution validation
    if (onlineStock + offlineStock > finalStock) {
      validationErrors.push('Total distribution cannot exceed final stock');
    }

    if (validationErrors.length > 0) {
      return response.status(400).json({
        message: 'Validation errors',
        errors: validationErrors,
        error: true,
        success: false,
      });
    }

    const currentProduct = await ProductModel.findById(productId);
    if (!currentProduct) {
      return response.status(404).json({
        message: 'Product not found',
        error: true,
        success: false,
      });
    }

    // Get current effective stock for change tracking
    const currentEffectiveStock = await getEffectiveStock(currentProduct);

    // Track changes for activity log
    const changes = {};
    const oldStock = {
      stockOnArrival: currentEffectiveStock.stockOnArrival,
      damagedQty: currentEffectiveStock.damagedQty,
      expiredQty: currentEffectiveStock.expiredQty,
      refurbishedQty: currentEffectiveStock.refurbishedQty,
      finalStock: currentEffectiveStock.finalStock,
      onlineStock: currentEffectiveStock.onlineStock,
      offlineStock: currentEffectiveStock.offlineStock,
    };

    const newStock = {
      stockOnArrival,
      damagedQty,
      expiredQty,
      refurbishedQty,
      finalStock,
      onlineStock,
      offlineStock,
    };

    Object.keys(newStock).forEach((key) => {
      if (oldStock[key] !== newStock[key]) {
        changes[key] = {
          from: oldStock[key],
          to: newStock[key],
        };
      }
    });

    // Enable warehouse manual override and update product with complete structure
    const updateData = {
      warehouseStock: {
        enabled: true,
        stockOnArrival,
        damagedQty,
        expiredQty,
        refurbishedQty,
        finalStock,
        onlineStock,
        offlineStock,
        notes,
        lastUpdated: new Date(),
        updatedBy: request.user._id,
      },
      stock: finalStock,
      stockSource: 'WAREHOUSE_MANUAL',
      updatedBy: request.user._id,
    };

    const updatedProduct = await ProductModel.findByIdAndUpdate(
      productId,
      updateData,
      { new: true, runValidators: true }
    ).populate('category brand compatibleSystem', 'name');

    // Log activity
    logActivity(
      request.user,
      'STOCK_UPDATE',
      {
        type: 'PRODUCT',
        id: productId,
        name: updatedProduct.name,
        sku: updatedProduct.sku,
      },
      changes,
      notes
    );

    return response.json({
      message: 'Stock updated successfully (manual override enabled)',
      data: {
        ...updatedProduct.toObject(),
        warehouseStock: {
          stockOnArrival,
          damagedQty,
          expiredQty,
          refurbishedQty,
          finalStock,
          onlineStock,
          offlineStock,
          notes,
          lastUpdated: updateData.warehouseStock.lastUpdated,
          source: 'WAREHOUSE_MANUAL',
          isManualOverride: true,
        },
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Update stock error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to update stock',
      error: true,
      success: false,
    });
  }
};

// NEW: Update product weight (warehouse only, no approval required)
export const updateWeight = async (request, response) => {
  try {
    const { productId, weight } = request.body;

    const userRole = request.user.subRole || request.user.role;
    if (userRole !== 'WAREHOUSE') {
      return response.status(403).json({
        message: 'Only warehouse staff can update product weight',
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

    // Weight validation
    if (weight < 0) {
      return response.status(400).json({
        message: 'Weight cannot be negative',
        error: true,
        success: false,
      });
    }

    const currentProduct = await ProductModel.findById(productId);
    if (!currentProduct) {
      return response.status(404).json({
        message: 'Product not found',
        error: true,
        success: false,
      });
    }

    // Track changes for activity log
    const changes = {};
    if (currentProduct.weight !== weight) {
      changes.weight = {
        from: currentProduct.weight || 0,
        to: weight,
      };
    }

    // Update product weight
    const updateData = {
      weight,
      updatedBy: request.user._id,
    };

    const updatedProduct = await ProductModel.findByIdAndUpdate(
      productId,
      updateData,
      { new: true, runValidators: true }
    ).populate('category brand compatibleSystem', 'name');

    // Log activity
    logActivity(
      request.user,
      'WEIGHT_UPDATE',
      {
        type: 'PRODUCT',
        id: productId,
        name: updatedProduct.name,
        sku: updatedProduct.sku,
      },
      changes,
      'Product weight updated'
    );

    return response.json({
      message: 'Product weight updated successfully',
      data: updatedProduct,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Update weight error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to update product weight',
      error: true,
      success: false,
    });
  }
};

// Rest of the existing functions remain the same...
export const disableWarehouseOverride = async (request, response) => {
  try {
    const { productId } = request.params;

    const userRole = request.user.subRole || request.user.role;
    if (!['DIRECTOR', 'IT', 'WAREHOUSE'].includes(userRole)) {
      return response.status(403).json({
        message: 'Insufficient permissions',
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

    const stockTotals = await syncStockFromStockModel(productId);
    const newStock = stockTotals ? stockTotals.finalStock : product.stock || 0;

    const updateData = {
      'warehouseStock.enabled': false,
      stock: newStock,
      stockSource: stockTotals ? 'STOCK_BATCHES' : 'PRODUCT_DEFAULT',
      updatedBy: request.user._id,
    };

    const updatedProduct = await ProductModel.findByIdAndUpdate(
      productId,
      updateData,
      { new: true, runValidators: true }
    );

    logActivity(
      request.user,
      'WAREHOUSE_OVERRIDE_DISABLED',
      {
        type: 'PRODUCT',
        id: productId,
        name: updatedProduct.name,
        sku: updatedProduct.sku,
      },
      null,
      'Warehouse manual override disabled, synced from stock batches'
    );

    return response.json({
      message: 'Warehouse override disabled, stock synced from batches',
      data: updatedProduct,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Disable warehouse override error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to disable warehouse override',
      error: true,
      success: false,
    });
  }
};

export const syncAllFromStockModel = async (request, response) => {
  try {
    const userRole = request.user.subRole || request.user.role;
    if (!['DIRECTOR', 'IT'].includes(userRole)) {
      return response.status(403).json({
        message: 'Only Director or IT can perform bulk sync',
        error: true,
        success: false,
      });
    }

    const products = await ProductModel.find({
      $or: [
        { 'warehouseStock.enabled': { $ne: true } },
        { warehouseStock: { $exists: false } },
      ],
    });

    let syncedCount = 0;
    let errorCount = 0;

    for (const product of products) {
      try {
        const stockTotals = await syncStockFromStockModel(product._id);

        if (stockTotals) {
          await ProductModel.findByIdAndUpdate(product._id, {
            stock: stockTotals.finalStock,
            stockSource: 'STOCK_BATCHES',
            updatedBy: request.user._id,
          });
          syncedCount++;
        }
      } catch (error) {
        console.error(`Error syncing product ${product._id}:`, error);
        errorCount++;
      }
    }

    logActivity(
      request.user,
      'BULK_STOCK_SYNC',
      {
        type: 'SYSTEM',
        name: 'Stock Synchronization',
      },
      null,
      `Synced ${syncedCount} products, ${errorCount} errors`
    );

    return response.json({
      message: 'Bulk stock sync completed',
      data: {
        totalProducts: products.length,
        syncedCount,
        errorCount,
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Bulk sync error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to perform bulk sync',
      error: true,
      success: false,
    });
  }
};

export const getStockSummary = async (request, response) => {
  try {
    const products = await ProductModel.find({}).lean();

    let stats = {
      totalProducts: 0,
      totalStock: 0,
      onlineStock: 0,
      offlineStock: 0,
      lowStockItems: 0,
      outOfStockItems: 0,
      damagedItems: 0,
      refurbishedItems: 0,
      expiredItems: 0,
      manualOverrideCount: 0,
      stockBatchCount: 0,
    };

    for (const product of products) {
      const effectiveStock = await getEffectiveStock(product);

      stats.totalProducts += 1;
      stats.totalStock += effectiveStock.finalStock;
      stats.onlineStock += effectiveStock.onlineStock;
      stats.offlineStock += effectiveStock.offlineStock;
      stats.damagedItems += effectiveStock.damagedQty;
      stats.refurbishedItems += effectiveStock.refurbishedQty;
      stats.expiredItems += effectiveStock.expiredQty;

      if (effectiveStock.source === 'WAREHOUSE_MANUAL') {
        stats.manualOverrideCount += 1;
      } else if (effectiveStock.source === 'STOCK_BATCHES') {
        stats.stockBatchCount += 1;
      }

      const finalStock = effectiveStock.finalStock;
      if (finalStock === 0) {
        stats.outOfStockItems += 1;
      } else if (finalStock <= systemSettings.lowStockThreshold) {
        stats.lowStockItems += 1;
      }
    }

    return response.json({
      message: 'Stock summary retrieved successfully',
      data: stats,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get stock summary error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to retrieve stock summary',
      error: true,
      success: false,
    });
  }
};

// Rest of the existing functions remain the same...
export const getSystemStatus = async (request, response) => {
  try {
    return response.json({
      message: 'System status retrieved successfully',
      data: {
        enabled: systemSettings.enabled,
        settings: systemSettings,
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get system status error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to retrieve system status',
      error: true,
      success: false,
    });
  }
};

export const enableSystem = async (request, response) => {
  try {
    const userRole = request.user.subRole || request.user.role;
    if (!['DIRECTOR', 'IT'].includes(userRole)) {
      return response.status(403).json({
        message: 'Only Director or IT can enable the warehouse system',
        error: true,
        success: false,
      });
    }

    systemSettings.enabled = true;

    logActivity(
      request.user,
      'SYSTEM_ENABLED',
      {
        type: 'SYSTEM',
        name: 'Warehouse Stock Management',
      },
      null,
      'Enabled manual stock management for warehouse team'
    );

    return response.json({
      message: 'Warehouse system enabled successfully',
      data: { enabled: true },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Enable system error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to enable system',
      error: true,
      success: false,
    });
  }
};

export const disableSystem = async (request, response) => {
  try {
    const userRole = request.user.subRole || request.user.role;
    if (!['DIRECTOR', 'IT'].includes(userRole)) {
      return response.status(403).json({
        message: 'Only Director or IT can disable the warehouse system',
        error: true,
        success: false,
      });
    }

    systemSettings.enabled = false;

    logActivity(
      request.user,
      'SYSTEM_DISABLED',
      {
        type: 'SYSTEM',
        name: 'Warehouse Stock Management',
      },
      null,
      'Disabled manual stock management'
    );

    return response.json({
      message: 'Warehouse system disabled successfully',
      data: { enabled: false },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Disable system error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to disable system',
      error: true,
      success: false,
    });
  }
};

export const updateSystemSettings = async (request, response) => {
  try {
    const userRole = request.user.subRole || request.user.role;
    if (!['DIRECTOR', 'IT'].includes(userRole)) {
      return response.status(403).json({
        message: 'Only Director or IT can update system settings',
        error: true,
        success: false,
      });
    }

    const { autoSyncEnabled, lowStockThreshold, criticalStockThreshold } =
      request.body;

    if (
      lowStockThreshold &&
      (lowStockThreshold < 1 || lowStockThreshold > 100)
    ) {
      return response.status(400).json({
        message: 'Low stock threshold must be between 1 and 100',
        error: true,
        success: false,
      });
    }

    if (
      criticalStockThreshold &&
      (criticalStockThreshold < 1 || criticalStockThreshold > lowStockThreshold)
    ) {
      return response.status(400).json({
        message:
          'Critical stock threshold must be between 1 and low stock threshold',
        error: true,
        success: false,
      });
    }

    if (autoSyncEnabled !== undefined) {
      systemSettings.autoSyncEnabled = autoSyncEnabled;
    }
    if (lowStockThreshold !== undefined) {
      systemSettings.lowStockThreshold = lowStockThreshold;
    }
    if (criticalStockThreshold !== undefined) {
      systemSettings.criticalStockThreshold = criticalStockThreshold;
    }

    return response.json({
      message: 'System settings updated successfully',
      data: systemSettings,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Update system settings error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to update system settings',
      error: true,
      success: false,
    });
  }
};

export const getSystemSettings = async (request, response) => {
  try {
    return response.json({
      message: 'System settings retrieved successfully',
      data: systemSettings,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get system settings error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to retrieve system settings',
      error: true,
      success: false,
    });
  }
};

export const getActivityLog = async (request, response) => {
  try {
    const { page = 1, limit = 50, dateRange, action, user } = request.query;

    let filteredActivities = [...activityLog];

    if (dateRange && dateRange !== 'all') {
      const daysAgo = parseInt(dateRange);
      const cutoffDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
      filteredActivities = filteredActivities.filter(
        (activity) => new Date(activity.timestamp) >= cutoffDate
      );
    }

    if (action) {
      filteredActivities = filteredActivities.filter(
        (activity) => activity.action === action
      );
    }

    if (user) {
      filteredActivities = filteredActivities.filter((activity) =>
        activity.user.name.includes(user)
      );
    }

    const skip = (page - 1) * limit;
    const paginatedActivities = filteredActivities.slice(
      skip,
      skip + parseInt(limit)
    );

    return response.json({
      message: 'Activity log retrieved successfully',
      data: paginatedActivities,
      totalCount: filteredActivities.length,
      totalPages: Math.ceil(filteredActivities.length / limit),
      currentPage: parseInt(page),
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get activity log error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to retrieve activity log',
      error: true,
      success: false,
    });
  }
};

export const getLowStockAlerts = async (request, response) => {
  try {
    const lowStockProducts = await ProductModel.find({
      $and: [
        {
          $expr: {
            $lte: [
              { $ifNull: ['$finalStock', '$stock'] },
              systemSettings.lowStockThreshold,
            ],
          },
        },
        { $expr: { $gt: [{ $ifNull: ['$finalStock', '$stock'] }, 0] } },
      ],
    })
      .populate('category brand', 'name')
      .select(
        'name sku finalStock stock onlineStock offlineStock category brand'
      )
      .sort({ finalStock: 1 });

    const criticalStockProducts = await ProductModel.find({
      $expr: {
        $lte: [
          { $ifNull: ['$finalStock', '$stock'] },
          systemSettings.criticalStockThreshold,
        ],
      },
    })
      .populate('category brand', 'name')
      .select(
        'name sku finalStock stock onlineStock offlineStock category brand'
      )
      .sort({ finalStock: 1 });

    const outOfStockProducts = await ProductModel.find({
      $expr: { $eq: [{ $ifNull: ['$finalStock', '$stock'] }, 0] },
    })
      .populate('category brand', 'name')
      .select(
        'name sku finalStock stock onlineStock offlineStock category brand'
      )
      .sort({ name: 1 });

    return response.json({
      message: 'Stock alerts retrieved successfully',
      data: {
        lowStock: lowStockProducts,
        criticalStock: criticalStockProducts,
        outOfStock: outOfStockProducts,
        thresholds: {
          low: systemSettings.lowStockThreshold,
          critical: systemSettings.criticalStockThreshold,
        },
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get low stock alerts error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to retrieve stock alerts',
      error: true,
      success: false,
    });
  }
};

export const bulkUpdateStock = async (request, response) => {
  try {
    if (!systemSettings.enabled) {
      return response.status(403).json({
        message: 'Warehouse stock system is disabled',
        error: true,
        success: false,
      });
    }

    const userRole = request.user.subRole || request.user.role;
    if (userRole !== 'WAREHOUSE') {
      return response.status(403).json({
        message: 'Only warehouse staff can update stock quantities',
        error: true,
        success: false,
      });
    }

    const { updates } = request.body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return response.status(400).json({
        message: 'Updates array is required',
        error: true,
        success: false,
      });
    }

    const results = [];
    const errors = [];

    for (const update of updates) {
      try {
        const product = await ProductModel.findById(update.productId);
        if (!product) {
          errors.push(`Product not found: ${update.productId}`);
          continue;
        }

        const updateData = {
          stockOnArrival: update.stockOnArrival,
          damagedQty: update.damagedQty,
          expiredQty: update.expiredQty,
          refurbishedQty: update.refurbishedQty,
          finalStock: update.finalStock,
          stock: update.finalStock,
          onlineStock: update.onlineStock,
          offlineStock: update.offlineStock,
          warehouseNotes: update.notes,
          stockLastUpdated: new Date(),
          updatedBy: request.user._id,
        };

        await ProductModel.findByIdAndUpdate(update.productId, updateData, {
          new: true,
          runValidators: true,
        });

        results.push({
          productId: update.productId,
          success: true,
        });

        logActivity(
          request.user,
          'BULK_STOCK_UPDATE',
          {
            type: 'PRODUCT',
            id: update.productId,
            name: product.name,
            sku: product.sku,
          },
          null,
          `Bulk update: ${update.notes || 'No notes'}`
        );
      } catch (error) {
        errors.push(`Error updating ${update.productId}: ${error.message}`);
        results.push({
          productId: update.productId,
          success: false,
          error: error.message,
        });
      }
    }

    return response.json({
      message: 'Bulk update completed',
      data: {
        successful: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        results,
        errors,
      },
      error: errors.length > 0,
      success: true,
    });
  } catch (error) {
    console.error('Bulk update stock error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to perform bulk update',
      error: true,
      success: false,
    });
  }
};

export const reconcileStock = async (request, response) => {
  try {
    const { productId, actualCount } = request.body;

    if (!productId || actualCount === undefined) {
      return response.status(400).json({
        message: 'Product ID and actual count are required',
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

    const currentStock = product.finalStock || product.stock || 0;
    const difference = actualCount - currentStock;

    await ProductModel.findByIdAndUpdate(productId, {
      finalStock: actualCount,
      stock: actualCount,
      stockLastUpdated: new Date(),
      updatedBy: request.user._id,
    });

    logActivity(
      request.user,
      'STOCK_RECONCILIATION',
      {
        type: 'PRODUCT',
        id: productId,
        name: product.name,
        sku: product.sku,
      },
      {
        finalStock: {
          from: currentStock,
          to: actualCount,
        },
      },
      `Stock reconciliation: ${difference > 0 ? '+' : ''}${difference} units`
    );

    return response.json({
      message: 'Stock reconciled successfully',
      data: {
        productId,
        previousStock: currentStock,
        newStock: actualCount,
        difference,
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Reconcile stock error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to reconcile stock',
      error: true,
      success: false,
    });
  }
};

export const exportStockData = async (request, response) => {
  try {
    const { category, brand, productType, compatibleSystem } = request.query;

    const query = {};

    if (category) query.category = category;
    if (brand) query.brand = { $in: [brand] };
    if (productType) query.productType = productType;
    if (compatibleSystem) query.compatibleSystem = compatibleSystem;

    const products = await ProductModel.find(query)
      .populate('category brand compatibleSystem', 'name')
      .sort({ name: 1 });

    const csvHeaders = [
      'Product Name',
      'SKU',
      'Category',
      'Brand',
      'Product Type',
      'Weight',
      'Stock on Arrival',
      'Damaged Qty',
      'Expired Qty',
      'Refurbished Qty',
      'Final Stock',
      'Online Stock',
      'Offline Stock',
      'Last Updated',
      'Notes',
    ];

    const csvRows = products.map((product) => [
      product.name || '',
      product.sku || '',
      product.category?.name || '',
      product.brand?.map((b) => b.name).join(', ') || '',
      product.productType || '',
      product.weight || 0,
      product.stockOnArrival || 0,
      product.damagedQty || 0,
      product.expiredQty || 0,
      product.refurbishedQty || 0,
      product.finalStock || product.stock || 0,
      product.onlineStock || 0,
      product.offlineStock || 0,
      product.stockLastUpdated
        ? new Date(product.stockLastUpdated).toLocaleDateString()
        : '',
      product.warehouseNotes || '',
    ]);

    const csvContent = [csvHeaders, ...csvRows]
      .map((row) => row.map((field) => `"${field}"`).join(','))
      .join('\n');

    response.setHeader('Content-Type', 'text/csv');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="warehouse-stock-export.csv"'
    );
    return response.send(csvContent);
  } catch (error) {
    console.error('Export stock data error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to export stock data',
      error: true,
      success: false,
    });
  }
};

export const exportActivityLog = async (request, response) => {
  try {
    const { dateRange, action, user } = request.query;

    let filteredActivities = [...activityLog];

    if (dateRange && dateRange !== 'all') {
      const daysAgo = parseInt(dateRange);
      const cutoffDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
      filteredActivities = filteredActivities.filter(
        (activity) => new Date(activity.timestamp) >= cutoffDate
      );
    }

    if (action) {
      filteredActivities = filteredActivities.filter(
        (activity) => activity.action === action
      );
    }

    if (user) {
      filteredActivities = filteredActivities.filter((activity) =>
        activity.user.name.includes(user)
      );
    }

    const csvHeaders = [
      'Timestamp',
      'User',
      'Role',
      'Action',
      'Target Type',
      'Target Name',
      'Target SKU',
      'Changes',
      'Notes',
    ];

    const csvRows = filteredActivities.map((activity) => [
      new Date(activity.timestamp).toISOString(),
      activity.user.name,
      activity.user.role,
      activity.action,
      activity.target.type,
      activity.target.name,
      activity.target.sku || '',
      activity.changes ? JSON.stringify(activity.changes) : '',
      activity.notes || '',
    ]);

    const csvContent = [csvHeaders, ...csvRows]
      .map((row) => row.map((field) => `"${field}"`).join(','))
      .join('\n');

    response.setHeader('Content-Type', 'text/csv');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="warehouse-activity-log.csv"'
    );
    return response.send(csvContent);
  } catch (error) {
    console.error('Export activity log error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to export activity log',
      error: true,
      success: false,
    });
  }
};
