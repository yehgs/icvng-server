// middleware/stockSync.middleware.js - FIXED for consistent stock flow
import ProductModel from '../models/product.model.js';

// FIXED: Helper function to sync product stock from Stock model batches
const syncProductStockFromBatches = async (productId) => {
  try {
    const StockModel = (await import('../models/stock.model.js')).default;

    // Get all active stock batches for this product
    const stockBatches = await StockModel.find({
      product: productId,
      status: { $in: ['AVAILABLE', 'PARTIALLY_ALLOCATED', 'RECEIVED'] },
    });

    // FIXED: Calculate comprehensive totals from all batches
    const totals = stockBatches.reduce(
      (acc, batch) => {
        // Stock arrival and quality breakdown
        acc.stockOnArrival += batch.originalQuantity || 0;
        acc.goodQuantity += batch.goodQuantity || 0;
        acc.refurbishedQuantity += batch.refurbishedQuantity || 0;
        acc.damagedQuantity += batch.damagedQuantity || 0;
        acc.expiredQuantity += 0; // Add this field to Stock model if needed

        // Distribution
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

    // Get the product
    const product = await ProductModel.findById(productId);
    if (!product) return;

    // FIXED: Only update if warehouse manual override is NOT enabled
    if (!product.warehouseStock?.enabled) {
      const finalStock = totals.goodQuantity + totals.refurbishedQuantity;

      // FIXED: Update with complete warehouse structure
      const updateData = {
        stock: finalStock,
        stockSource: 'STOCK_BATCHES',
        updatedAt: new Date(),

        // Update warehouseStock structure but keep enabled: false
        warehouseStock: {
          enabled: false,
          stockOnArrival: totals.stockOnArrival,
          damagedQty: totals.damagedQuantity,
          expiredQty: totals.expiredQuantity,
          refurbishedQty: totals.refurbishedQuantity,
          finalStock: finalStock,
          onlineStock: totals.onlineStock,
          offlineStock: totals.offlineStock,
          notes: 'Auto-synced from stock batches',
          lastUpdated: new Date(),
          source: 'STOCK_BATCHES',
        },
      };

      await ProductModel.findByIdAndUpdate(productId, updateData);

      console.log(
        `Product ${productId} stock synced from batches: ${finalStock} units`
      );
    } else {
      console.log(
        `Product ${productId} has warehouse override enabled, skipping sync`
      );
    }
  } catch (error) {
    console.error('Error syncing product stock from batches:', error);
  }
};

// FIXED: Enhanced middleware to ensure proper sync
export const addStockSyncHooks = (stockSchema) => {
  // After creating a new stock batch
  stockSchema.post('save', async function (doc) {
    if (this.isNew && doc.product) {
      console.log(
        `New stock batch created for product ${doc.product}, syncing...`
      );
      await syncProductStockFromBatches(doc.product);
    }
  });

  // After updating a stock batch
  stockSchema.post('findOneAndUpdate', async function (doc) {
    if (doc && doc.product) {
      console.log(`Stock batch updated for product ${doc.product}, syncing...`);
      await syncProductStockFromBatches(doc.product);
    }
  });

  // After updating multiple stock batches
  stockSchema.post('updateOne', async function () {
    if (this.getQuery().product) {
      console.log(
        `Stock batch updated for product ${this.getQuery().product}, syncing...`
      );
      await syncProductStockFromBatches(this.getQuery().product);
    }
  });

  // After deleting a stock batch
  stockSchema.post('findOneAndDelete', async function (doc) {
    if (doc && doc.product) {
      console.log(`Stock batch deleted for product ${doc.product}, syncing...`);
      await syncProductStockFromBatches(doc.product);
    }
  });

  // FIXED: Handle bulk operations more carefully
  stockSchema.post('updateMany', async function (result) {
    // For bulk operations, we need to be more careful about performance
    // This could affect many products, so we log but don't auto-sync
    console.log(
      `Bulk stock batch update completed, affected: ${result.modifiedCount} batches`
    );
    // Manual sync may be required for bulk operations
  });
};

// FIXED: Product-side hooks to ensure consistency
export const addProductStockHooks = (productSchema) => {
  // Before saving product, validate warehouseStock structure
  productSchema.pre('save', function (next) {
    // FIXED: Ensure warehouseStock has proper structure when enabled
    if (this.warehouseStock && this.warehouseStock.enabled) {
      // Validate that required fields are present
      const requiredFields = [
        'stockOnArrival',
        'damagedQty',
        'expiredQty',
        'refurbishedQty',
        'finalStock',
        'onlineStock',
        'offlineStock',
      ];

      for (const field of requiredFields) {
        if (this.warehouseStock[field] === undefined) {
          this.warehouseStock[field] = 0;
        }
      }

      // Ensure lastUpdated is set
      if (!this.warehouseStock.lastUpdated) {
        this.warehouseStock.lastUpdated = new Date();
      }

      // Set source
      this.warehouseStock.source = 'WAREHOUSE_MANUAL';

      // Update main stock field to match finalStock
      this.stock = this.warehouseStock.finalStock;
      this.stockSource = 'WAREHOUSE_MANUAL';
    }

    next();
  });

  // After product update, log the change
  productSchema.post('findOneAndUpdate', function (doc) {
    if (doc && doc.warehouseStock?.enabled) {
      console.log(
        `Product ${doc._id} warehouse stock manually updated: ${doc.warehouseStock.finalStock} units`
      );
    }
  });
};

// FIXED: Utility function to force sync a product
export const forceSyncProduct = async (productId) => {
  try {
    const product = await ProductModel.findById(productId);
    if (!product) {
      throw new Error('Product not found');
    }

    if (product.warehouseStock?.enabled) {
      console.log(`Product ${productId} has manual override, skipping sync`);
      return {
        synced: false,
        reason: 'Manual override enabled',
        currentStock: product.warehouseStock.finalStock,
      };
    }

    await syncProductStockFromBatches(productId);

    const updatedProduct = await ProductModel.findById(productId);
    return {
      synced: true,
      reason: 'Synced from stock batches',
      currentStock: updatedProduct.stock,
    };
  } catch (error) {
    console.error(`Error force syncing product ${productId}:`, error);
    throw error;
  }
};

// FIXED: Utility function to disable warehouse override and sync
export const disableWarehouseOverrideAndSync = async (productId) => {
  try {
    const product = await ProductModel.findById(productId);
    if (!product) {
      throw new Error('Product not found');
    }

    // Disable warehouse override
    await ProductModel.findByIdAndUpdate(productId, {
      'warehouseStock.enabled': false,
      stockSource: 'STOCK_BATCHES',
    });

    // Force sync from stock batches
    await syncProductStockFromBatches(productId);

    const updatedProduct = await ProductModel.findById(productId);
    return {
      success: true,
      message: 'Warehouse override disabled and stock synced',
      newStock: updatedProduct.stock,
      source: updatedProduct.stockSource,
    };
  } catch (error) {
    console.error(
      `Error disabling warehouse override for product ${productId}:`,
      error
    );
    throw error;
  }
};

// FIXED: Utility function to validate stock consistency
export const validateStockConsistency = async (productId) => {
  try {
    const product = await ProductModel.findById(productId);
    if (!product) {
      throw new Error('Product not found');
    }

    const issues = [];

    if (product.warehouseStock?.enabled) {
      // Validate warehouse manual stock
      const ws = product.warehouseStock;

      // Check if quality breakdown adds up
      const totalProcessed =
        (ws.damagedQty || 0) +
        (ws.expiredQty || 0) +
        (ws.refurbishedQty || 0) +
        (ws.finalStock || 0);

      if (totalProcessed !== (ws.stockOnArrival || 0)) {
        issues.push(
          `Quality breakdown doesn't match stock on arrival: ${totalProcessed} vs ${ws.stockOnArrival}`
        );
      }

      // Check if distribution doesn't exceed final stock
      const totalDistribution = (ws.onlineStock || 0) + (ws.offlineStock || 0);
      if (totalDistribution > (ws.finalStock || 0)) {
        issues.push(
          `Distribution exceeds final stock: ${totalDistribution} vs ${ws.finalStock}`
        );
      }

      // Check if main stock field matches finalStock
      if (product.stock !== ws.finalStock) {
        issues.push(
          `Main stock field doesn't match warehouse finalStock: ${product.stock} vs ${ws.finalStock}`
        );
      }
    } else {
      // For non-manual products, check if stock matches batches
      const StockModel = (await import('../models/stock.model.js')).default;
      const stockBatches = await StockModel.find({
        product: productId,
        status: { $in: ['AVAILABLE', 'PARTIALLY_ALLOCATED', 'RECEIVED'] },
      });

      const batchTotal = stockBatches.reduce(
        (sum, batch) =>
          sum + (batch.goodQuantity || 0) + (batch.refurbishedQuantity || 0),
        0
      );

      if (Math.abs(product.stock - batchTotal) > 0) {
        issues.push(
          `Product stock doesn't match batch totals: ${product.stock} vs ${batchTotal}`
        );
      }
    }

    return {
      productId,
      isConsistent: issues.length === 0,
      issues,
      currentStock: product.stock,
      stockSource: product.stockSource,
      warehouseManaged: product.warehouseStock?.enabled || false,
    };
  } catch (error) {
    console.error(
      `Error validating stock consistency for product ${productId}:`,
      error
    );
    throw error;
  }
};

// FIXED: Batch validation function for multiple products
export const validateMultipleProductsStock = async (productIds) => {
  const results = [];

  for (const productId of productIds) {
    try {
      const validation = await validateStockConsistency(productId);
      results.push(validation);
    } catch (error) {
      results.push({
        productId,
        isConsistent: false,
        issues: [`Validation error: ${error.message}`],
        error: true,
      });
    }
  }

  return {
    totalChecked: results.length,
    consistent: results.filter((r) => r.isConsistent).length,
    inconsistent: results.filter((r) => !r.isConsistent).length,
    results: results.filter((r) => !r.isConsistent), // Only return problematic ones
  };
};

export { syncProductStockFromBatches };
