import { StockModel } from '../models/stock.model.js';
import ProductModel from '../models/product.model.js';

export const createBatchController = async (request, response) => {
  try {
    const {
      productId,
      batchNumber,
      manufactureDate,
      expirationDate,
      quantity,
      location = 'INCOMING',
      supplier,
      purchaseOrderReference,
    } = request.body;

    if (
      !productId ||
      !batchNumber ||
      !manufactureDate ||
      !expirationDate ||
      !quantity
    ) {
      return response.status(400).json({
        message:
          'Product ID, batch number, manufacture date, expiration date, and quantity are required',
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

    if (!product.isPerishable) {
      return response.status(400).json({
        message: 'This product type does not support batch tracking',
        error: true,
        success: false,
      });
    }

    // Get or create stock record
    let stock = await StockModel.findOne({ product: productId });
    if (!stock) {
      stock = new StockModel({
        product: productId,
        updatedBy: request.user._id,
      });
    }

    // Check if batch number already exists
    const existingBatch = stock.batches.find(
      (b) => b.batchNumber === batchNumber
    );
    if (existingBatch) {
      return response.status(400).json({
        message: 'Batch number already exists',
        error: true,
        success: false,
      });
    }

    // Create new batch
    const newBatch = {
      batchNumber,
      manufactureDate: new Date(manufactureDate),
      expirationDate: new Date(expirationDate),
      quantity: parseInt(quantity),
      location,
      supplier,
      purchaseOrderReference,
    };

    stock.batches.push(newBatch);

    // Update stock quantities
    if (location === 'INCOMING') {
      stock.incoming.arrivedQuantity += parseInt(quantity);
      stock.processing.quantityReceived += parseInt(quantity);
    } else if (location === 'ONLINE') {
      stock.distribution.onlineStock += parseInt(quantity);
      stock.processing.quantitySalable += parseInt(quantity);
    } else if (location === 'OFFLINE') {
      stock.distribution.offlineStock += parseInt(quantity);
      stock.processing.quantitySalable += parseInt(quantity);
    }

    stock.updatedBy = request.user._id;
    const savedStock = await stock.save();

    // Update product's current stock
    await ProductModel.findByIdAndUpdate(productId, {
      currentStock: stock.distribution.onlineStock,
    });

    // Record movement
    const movement = {
      type: 'BATCH_IN',
      toLocation: location,
      quantity: parseInt(quantity),
      reason: `New batch: ${batchNumber}`,
      reference: `Batch: ${batchNumber}, Exp: ${new Date(
        expirationDate
      ).toLocaleDateString()}`,
      performedBy: request.user._id,
      batchNumber,
    };
    savedStock.movements.push(movement);
    await savedStock.save();

    await savedStock.populate('product', 'name sku');

    return response.json({
      message: 'Batch created successfully',
      data: savedStock,
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

export const getBatchesController = async (request, response) => {
  try {
    const { productId } = request.params;
    let { status, location, nearExpiry } = request.query;

    const stock = await StockModel.findOne({ product: productId })
      .populate('product', 'name sku isPerishable shelfLifeDays')
      .populate('batches.supplier', 'name');

    if (!stock) {
      return response.status(404).json({
        message: 'Stock record not found',
        error: true,
        success: false,
      });
    }

    let batches = stock.batches || [];

    // Filter by status
    if (status) {
      batches = batches.filter((b) => b.status === status);
    }

    // Filter by location
    if (location) {
      batches = batches.filter((b) => b.location === location);
    }

    // Filter near expiry
    if (nearExpiry === 'true') {
      const warningDate = new Date();
      warningDate.setDate(warningDate.getDate() + 30);
      batches = batches.filter(
        (b) => b.expirationDate <= warningDate && b.status !== 'EXPIRED'
      );
    }

    // Sort by expiration date (earliest first)
    batches.sort(
      (a, b) => new Date(a.expirationDate) - new Date(b.expirationDate)
    );

    return response.json({
      message: 'Batches retrieved successfully',
      data: {
        product: stock.product,
        batches,
        expirationSummary: stock.expiration,
      },
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

export const transferBatchController = async (request, response) => {
  try {
    const {
      productId,
      batchNumber,
      fromLocation,
      toLocation,
      quantity,
      reason,
    } = request.body;

    if (
      !productId ||
      !batchNumber ||
      !fromLocation ||
      !toLocation ||
      !quantity
    ) {
      return response.status(400).json({
        message: 'All fields are required',
        error: true,
        success: false,
      });
    }

    const stock = await StockModel.findOne({ product: productId });
    if (!stock) {
      return response.status(404).json({
        message: 'Stock record not found',
        error: true,
        success: false,
      });
    }

    const batch = stock.batches.find((b) => b.batchNumber === batchNumber);
    if (!batch) {
      return response.status(404).json({
        message: 'Batch not found',
        error: true,
        success: false,
      });
    }

    if (batch.location !== fromLocation) {
      return response.status(400).json({
        message: `Batch is not in ${fromLocation} location`,
        error: true,
        success: false,
      });
    }

    if (batch.quantity < quantity) {
      return response.status(400).json({
        message: 'Insufficient quantity in batch',
        error: true,
        success: false,
      });
    }

    // Handle FIFO for partial transfers
    if (batch.quantity > quantity) {
      // Create new batch for remaining quantity
      const remainingBatch = {
        ...batch.toObject(),
        _id: new mongoose.Types.ObjectId(),
        quantity: batch.quantity - quantity,
      };
      stock.batches.push(remainingBatch);
    }

    // Update batch
    batch.quantity = quantity;
    batch.location = toLocation;

    // Update stock quantities
    updateStockQuantities(stock, fromLocation, toLocation, quantity);

    // Record movement
    const movement = {
      type: 'BATCH_TRANSFER',
      fromLocation,
      toLocation,
      quantity,
      reason: reason || `Batch transfer: ${batchNumber}`,
      reference: `Batch: ${batchNumber}`,
      performedBy: request.user._id,
      batchNumber,
    };
    stock.movements.push(movement);
    stock.updatedBy = request.user._id;

    const savedStock = await stock.save();

    // Update product's current stock
    await ProductModel.findByIdAndUpdate(productId, {
      currentStock: stock.distribution.onlineStock,
    });

    return response.json({
      message: 'Batch transferred successfully',
      data: savedStock,
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

export const markBatchExpiredController = async (request, response) => {
  try {
    const { productId, batchNumber, action = 'EXPIRE' } = request.body;
    // action can be 'EXPIRE' or 'DISPOSE'

    const stock = await StockModel.findOne({ product: productId });
    if (!stock) {
      return response.status(404).json({
        message: 'Stock record not found',
        error: true,
        success: false,
      });
    }

    const batch = stock.batches.find((b) => b.batchNumber === batchNumber);
    if (!batch) {
      return response.status(404).json({
        message: 'Batch not found',
        error: true,
        success: false,
      });
    }

    const originalLocation = batch.location;
    const quantity = batch.quantity;

    if (action === 'EXPIRE') {
      batch.status = 'EXPIRED';
      batch.location = 'EXPIRED';
    } else if (action === 'DISPOSE') {
      // Remove batch entirely
      stock.batches = stock.batches.filter(
        (b) => b.batchNumber !== batchNumber
      );
    }

    // Update stock quantities
    if (originalLocation === 'ONLINE') {
      stock.distribution.onlineStock -= quantity;
      stock.processing.quantitySalable -= quantity;
    } else if (originalLocation === 'OFFLINE') {
      stock.distribution.offlineStock -= quantity;
      stock.processing.quantitySalable -= quantity;
    }

    if (action === 'EXPIRE') {
      stock.expiration.totalExpired += quantity;
    }

    // Record movement
    const movement = {
      type: action === 'EXPIRE' ? 'BATCH_EXPIRED' : 'BATCH_DISPOSED',
      fromLocation: originalLocation,
      toLocation: action === 'EXPIRE' ? 'EXPIRED' : 'DISPOSED',
      quantity,
      reason: `Batch ${action.toLowerCase()}: ${batchNumber}`,
      reference: `Batch: ${batchNumber}`,
      performedBy: request.user._id,
      batchNumber,
    };
    stock.movements.push(movement);
    stock.updatedBy = request.user._id;

    const savedStock = await stock.save();

    // Update product's current stock
    await ProductModel.findByIdAndUpdate(productId, {
      currentStock: stock.distribution.onlineStock,
    });

    return response.json({
      message: `Batch ${action.toLowerCase()} successfully`,
      data: savedStock,
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

export const getExpirationAlertsController = async (request, response) => {
  try {
    let { days = 30 } = request.query;
    days = parseInt(days);

    const warningDate = new Date();
    warningDate.setDate(warningDate.getDate() + days);

    const stocks = await StockModel.find({
      'batches.expirationDate': { $lte: warningDate },
      'batches.status': { $in: ['ACTIVE', 'NEAR_EXPIRY'] },
    }).populate('product', 'name sku productType');

    const alerts = {
      expiringSoon: [],
      expired: [],
      totalValue: 0,
    };

    const now = new Date();

    stocks.forEach((stock) => {
      stock.batches.forEach((batch) => {
        if (batch.expirationDate <= now && batch.status !== 'EXPIRED') {
          alerts.expired.push({
            product: stock.product,
            batch: batch,
            daysOverdue: Math.floor(
              (now - batch.expirationDate) / (1000 * 60 * 60 * 24)
            ),
          });
        } else if (
          batch.expirationDate <= warningDate &&
          batch.expirationDate > now
        ) {
          alerts.expiringSoon.push({
            product: stock.product,
            batch: batch,
            daysUntilExpiry: Math.floor(
              (batch.expirationDate - now) / (1000 * 60 * 60 * 24)
            ),
          });
        }
      });
    });

    // Sort by urgency
    alerts.expiringSoon.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
    alerts.expired.sort((a, b) => b.daysOverdue - a.daysOverdue);

    return response.json({
      message: 'Expiration alerts retrieved successfully',
      data: alerts,
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

export const getFIFORecommendationController = async (request, response) => {
  try {
    const { productId, requestedQuantity } = request.query;

    if (!productId || !requestedQuantity) {
      return response.status(400).json({
        message: 'Product ID and requested quantity are required',
        error: true,
        success: false,
      });
    }

    const stock = await StockModel.findOne({ product: productId }).populate(
      'product',
      'name sku'
    );

    if (!stock) {
      return response.status(404).json({
        message: 'Stock record not found',
        error: true,
        success: false,
      });
    }

    // Get active batches sorted by expiration date (FIFO)
    const activeBatches = stock.batches
      .filter(
        (b) =>
          b.status === 'ACTIVE' &&
          (b.location === 'ONLINE' || b.location === 'OFFLINE')
      )
      .sort((a, b) => new Date(a.expirationDate) - new Date(b.expirationDate));

    const recommendation = [];
    let remainingQuantity = parseInt(requestedQuantity);

    for (const batch of activeBatches) {
      if (remainingQuantity <= 0) break;

      const quantityFromBatch = Math.min(batch.quantity, remainingQuantity);
      recommendation.push({
        batchNumber: batch.batchNumber,
        quantity: quantityFromBatch,
        expirationDate: batch.expirationDate,
        location: batch.location,
        daysUntilExpiry: Math.floor(
          (batch.expirationDate - new Date()) / (1000 * 60 * 60 * 24)
        ),
      });

      remainingQuantity -= quantityFromBatch;
    }

    return response.json({
      message: 'FIFO recommendation generated successfully',
      data: {
        product: stock.product,
        requestedQuantity: parseInt(requestedQuantity),
        availableQuantity: parseInt(requestedQuantity) - remainingQuantity,
        shortfall: remainingQuantity > 0 ? remainingQuantity : 0,
        recommendation,
      },
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

// ============= HELPER FUNCTIONS =============
// Place all helper functions here, after the exported controllers

/**
 * Updates stock quantities when moving between locations
 * @param {Object} stock - The stock document
 * @param {string} fromLocation - Source location (null for new stock)
 * @param {string} toLocation - Destination location
 * @param {number} quantity - Amount to move
 */
function updateStockQuantities(stock, fromLocation, toLocation, quantity) {
  // Remove from source location (if specified)
  if (fromLocation) {
    switch (fromLocation) {
      case 'ONLINE':
        stock.distribution.onlineStock = Math.max(
          0,
          (stock.distribution.onlineStock || 0) - quantity
        );
        stock.processing.quantitySalable = Math.max(
          0,
          (stock.processing.quantitySalable || 0) - quantity
        );
        break;
      case 'OFFLINE':
        stock.distribution.offlineStock = Math.max(
          0,
          (stock.distribution.offlineStock || 0) - quantity
        );
        stock.processing.quantitySalable = Math.max(
          0,
          (stock.processing.quantitySalable || 0) - quantity
        );
        break;
      case 'INCOMING':
        stock.processing.quantityReceived = Math.max(
          0,
          (stock.processing.quantityReceived || 0) - quantity
        );
        break;
      case 'DAMAGED':
        stock.processing.quantityDamaged = Math.max(
          0,
          (stock.processing.quantityDamaged || 0) - quantity
        );
        break;
      case 'REFURBISHED':
        stock.processing.quantityRefurbished = Math.max(
          0,
          (stock.processing.quantityRefurbished || 0) - quantity
        );
        break;
    }
  }

  // Add to destination location
  if (toLocation) {
    switch (toLocation) {
      case 'INCOMING':
        stock.incoming = stock.incoming || {};
        stock.processing = stock.processing || {};
        stock.incoming.arrivedQuantity =
          (stock.incoming.arrivedQuantity || 0) + quantity;
        stock.processing.quantityReceived =
          (stock.processing.quantityReceived || 0) + quantity;
        break;
      case 'ONLINE':
        stock.distribution = stock.distribution || {};
        stock.processing = stock.processing || {};
        stock.distribution.onlineStock =
          (stock.distribution.onlineStock || 0) + quantity;
        stock.processing.quantitySalable =
          (stock.processing.quantitySalable || 0) + quantity;
        break;
      case 'OFFLINE':
        stock.distribution = stock.distribution || {};
        stock.processing = stock.processing || {};
        stock.distribution.offlineStock =
          (stock.distribution.offlineStock || 0) + quantity;
        stock.processing.quantitySalable =
          (stock.processing.quantitySalable || 0) + quantity;
        break;
      case 'DAMAGED':
        stock.processing = stock.processing || {};
        stock.processing.quantityDamaged =
          (stock.processing.quantityDamaged || 0) + quantity;
        break;
      case 'REFURBISHED':
        stock.processing = stock.processing || {};
        stock.processing.quantityRefurbished =
          (stock.processing.quantityRefurbished || 0) + quantity;
        stock.processing.quantitySalable =
          (stock.processing.quantitySalable || 0) + quantity;
        break;
      case 'EXPIRED':
        stock.expiration = stock.expiration || {};
        stock.expiration.totalExpired =
          (stock.expiration.totalExpired || 0) + quantity;
        break;
    }
  }
}

/**
 * Gets available stock quantity for a specific location
 * @param {Object} stock - The stock document
 * @param {string} location - Location to check
 * @returns {number} Available quantity
 */
function getAvailableStockByLocation(stock, location) {
  switch (location) {
    case 'ONLINE':
      return stock.distribution?.onlineStock || 0;
    case 'OFFLINE':
      return stock.distribution?.offlineStock || 0;
    case 'INCOMING':
      return stock.processing?.quantityReceived || 0;
    case 'DAMAGED':
      return stock.processing?.quantityDamaged || 0;
    case 'REFURBISHED':
      return stock.processing?.quantityRefurbished || 0;
    default:
      return 0;
  }
}

/**
 * Ensures all stock values are non-negative
 * @param {Object} stock - The stock document to validate
 */
function ensureNonNegativeValues(stock) {
  // Ensure all stock values are non-negative
  if (stock.incoming) {
    stock.incoming.expectedQuantity = Math.max(
      0,
      stock.incoming.expectedQuantity || 0
    );
    stock.incoming.arrivedQuantity = Math.max(
      0,
      stock.incoming.arrivedQuantity || 0
    );
  }

  if (stock.processing) {
    stock.processing.quantityReceived = Math.max(
      0,
      stock.processing.quantityReceived || 0
    );
    stock.processing.quantityDamaged = Math.max(
      0,
      stock.processing.quantityDamaged || 0
    );
    stock.processing.quantityRefurbished = Math.max(
      0,
      stock.processing.quantityRefurbished || 0
    );
    stock.processing.quantitySalable = Math.max(
      0,
      stock.processing.quantitySalable || 0
    );
  }

  if (stock.distribution) {
    stock.distribution.onlineStock = Math.max(
      0,
      stock.distribution.onlineStock || 0
    );
    stock.distribution.offlineStock = Math.max(
      0,
      stock.distribution.offlineStock || 0
    );
  }

  if (stock.expiration) {
    stock.expiration.totalExpired = Math.max(
      0,
      stock.expiration.totalExpired || 0
    );
    stock.expiration.nearExpiryQuantity = Math.max(
      0,
      stock.expiration.nearExpiryQuantity || 0
    );
  }
}

/**
 * Validates if a movement is allowed based on current stock levels
 * @param {Object} stock - The stock document
 * @param {string} type - Movement type
 * @param {string} fromLocation - Source location
 * @param {number} quantity - Quantity to move
 * @returns {Object} Validation result with isValid and message
 */
function validateMovement(stock, type, fromLocation, quantity) {
  if (['OUT', 'TRANSFER', 'DAMAGE'].includes(type)) {
    const availableStock = getAvailableStockByLocation(stock, fromLocation);
    if (availableStock < quantity) {
      return {
        isValid: false,
        message: `Insufficient stock in ${fromLocation}. Available: ${availableStock}, Requested: ${quantity}`,
      };
    }
  }

  return { isValid: true, message: 'Valid movement' };
}

/**
 * Calculates total salable stock across all locations
 * @param {Object} stock - The stock document
 * @returns {number} Total salable quantity
 */
function getTotalSalableStock(stock) {
  const onlineStock = stock.distribution?.onlineStock || 0;
  const offlineStock = stock.distribution?.offlineStock || 0;
  const refurbishedStock = stock.processing?.quantityRefurbished || 0;

  return onlineStock + offlineStock + refurbishedStock;
}

// ============= ADDITIONAL HELPER FUNCTIONS FOR BATCH MANAGEMENT =============

/**
 * Sorts batches by expiration date (FIFO order)
 * @param {Array} batches - Array of batch objects
 * @returns {Array} Sorted batches (earliest expiration first)
 */
function sortBatchesByExpiration(batches) {
  return batches.sort(
    (a, b) => new Date(a.expirationDate) - new Date(b.expirationDate)
  );
}

/**
 * Calculates days until expiration for a batch
 * @param {Date} expirationDate - The expiration date
 * @returns {number} Days until expiration (negative if expired)
 */
function getDaysUntilExpiration(expirationDate) {
  const now = new Date();
  const expiry = new Date(expirationDate);
  return Math.floor((expiry - now) / (1000 * 60 * 60 * 24));
}

/**
 * Gets batches that are expiring within specified days
 * @param {Array} batches - Array of batch objects
 * @param {number} days - Number of days to look ahead
 * @returns {Array} Batches expiring within the specified timeframe
 */
function getBatchesExpiringWithin(batches, days = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() + days);

  return batches.filter((batch) => {
    const expiryDate = new Date(batch.expirationDate);
    return expiryDate <= cutoffDate && batch.status !== 'EXPIRED';
  });
}

/**
 * Generates a FIFO recommendation for stock allocation
 * @param {Array} batches - Available batches
 * @param {number} requestedQuantity - Quantity needed
 * @returns {Object} FIFO recommendation with batch allocation
 */
function generateFIFORecommendation(batches, requestedQuantity) {
  const activeBatches = batches
    .filter(
      (batch) =>
        batch.status === 'ACTIVE' &&
        ['ONLINE', 'OFFLINE'].includes(batch.location)
    )
    .sort((a, b) => new Date(a.expirationDate) - new Date(b.expirationDate));

  const recommendation = [];
  let remainingQuantity = requestedQuantity;

  for (const batch of activeBatches) {
    if (remainingQuantity <= 0) break;

    const quantityFromBatch = Math.min(batch.quantity, remainingQuantity);
    recommendation.push({
      batchNumber: batch.batchNumber,
      quantity: quantityFromBatch,
      expirationDate: batch.expirationDate,
      location: batch.location,
      daysUntilExpiry: getDaysUntilExpiration(batch.expirationDate),
    });

    remainingQuantity -= quantityFromBatch;
  }

  return {
    recommendation,
    fulfilledQuantity: requestedQuantity - remainingQuantity,
    shortfall: remainingQuantity > 0 ? remainingQuantity : 0,
  };
}
