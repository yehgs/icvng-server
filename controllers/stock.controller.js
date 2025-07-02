// controllers/stockManagement.controller.js (Simplified)
import StockModel from '../models/stock.model.js';
import PurchaseOrderModel from '../models/purchase-order.model.js';
import ProductModel from '../models/product.model.js';
import { syncProductStockFromBatches } from '../middleware/stockSync.js';

// Add this function to your existing stock controller
export const syncProductStock = async (productId) => {
  try {
    await syncProductStockFromBatches(productId);
  } catch (error) {
    console.error('Error syncing product stock:', error);
  }
};

// Create stock batch from purchase order (simplified)
export const createStockBatch = async (request, response) => {
  try {
    const {
      purchaseOrderId,
      items, // Array of { productId, quantity, expiryDate }
      warehouseLocation,
      notes,
    } = request.body;

    if (!purchaseOrderId || !items || items.length === 0) {
      return response.status(400).json({
        message: 'Purchase order and items are required',
        error: true,
        success: false,
      });
    }

    // Validate purchase order
    const purchaseOrder = await PurchaseOrderModel.findById(purchaseOrderId);
    if (!purchaseOrder) {
      return response.status(404).json({
        message: 'Purchase order not found',
        error: true,
        success: false,
      });
    }

    if (purchaseOrder.status !== 'DELIVERED') {
      return response.status(400).json({
        message: 'Purchase order must be delivered to create batch',
        error: true,
        success: false,
      });
    }

    // Create stock batch with all items from PO
    const stockBatch = new StockModel({
      purchaseOrder: purchaseOrderId,
      supplier: purchaseOrder.supplier,
      items: await Promise.all(
        items.map(async (item) => {
          const product = await ProductModel.findById(item.productId);
          return {
            product: item.productId,
            quantity: item.quantity,
            expiryDate: item.expiryDate ? new Date(item.expiryDate) : null,
            // Quality check fields (initially empty)
            passedQuantity: 0,
            refurbishedQuantity: 0,
            damagedQuantity: 0,
            expiredQuantity: 0,
          };
        })
      ),
      warehouseLocation: warehouseLocation || {},
      notes: notes || '',
      qualityStatus: 'PENDING',
      distributionStatus: 'PENDING',
      createdBy: request.user._id,
      updatedBy: request.user._id,
    });

    const savedBatch = await stockBatch.save();

    // Mark purchase order as having a batch
    purchaseOrder.hasBatch = true;
    await purchaseOrder.save();

    const populatedBatch = await StockModel.findById(savedBatch._id)
      .populate('items.product', 'name sku isPerishable')
      .populate('supplier', 'name')
      .populate('purchaseOrder', 'orderNumber')
      .populate('createdBy updatedBy', 'name email');

    return response.json({
      message: 'Stock batch created successfully',
      data: populatedBatch,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Create stock batch error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to create stock batch',
      error: true,
      success: false,
    });
  }
};

// Perform quality check (simplified)
export const performQualityCheck = async (request, response) => {
  try {
    const { batchId } = request.params;
    const { items, generalNotes } = request.body;

    const batch = await StockModel.findById(batchId);
    if (!batch) {
      return response.status(404).json({
        message: 'Stock batch not found',
        error: true,
        success: false,
      });
    }

    if (batch.qualityStatus !== 'PENDING') {
      return response.status(400).json({
        message: 'Quality check already performed for this batch',
        error: true,
        success: false,
      });
    }

    // Update each item with quality check results
    for (let i = 0; i < batch.items.length; i++) {
      const itemUpdate = items.find(
        (item) =>
          item.productId.toString() === batch.items[i].product.toString()
      );

      if (itemUpdate) {
        batch.items[i].passedQuantity = itemUpdate.passedQuantity;
        batch.items[i].refurbishedQuantity = itemUpdate.refurbishedQuantity;
        batch.items[i].damagedQuantity = itemUpdate.damagedQuantity;
        batch.items[i].expiredQuantity = itemUpdate.expiredQuantity;
        batch.items[i].notes = itemUpdate.notes || '';
      }
    }

    batch.qualityStatus = 'COMPLETED';
    batch.qualityCheckDate = new Date();
    batch.qualityCheckBy = request.user._id;
    batch.qualityNotes = generalNotes || '';
    batch.updatedBy = request.user._id;

    await batch.save();

    const affectedProducts = batch.items.map((item) => item.product);
    for (const productId of affectedProducts) {
      await syncProductStockFromBatches(productId);
    }

    const populatedBatch = await StockModel.findById(batch._id)
      .populate('items.product', 'name sku')
      .populate('supplier', 'name')
      .populate('qualityCheckBy', 'name email');

    return response.json({
      message: 'Quality check completed successfully',
      data: populatedBatch,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Quality check error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to perform quality check',
      error: true,
      success: false,
    });
  }
};

// Distribute stock between online and offline
export const distributeStock = async (request, response) => {
  try {
    const { batchId } = request.params;
    const { distributions, reason, notes } = request.body;

    const batch = await StockModel.findById(batchId);
    if (!batch) {
      return response.status(404).json({
        message: 'Stock batch not found',
        error: true,
        success: false,
      });
    }

    if (batch.qualityStatus !== 'COMPLETED') {
      return response.status(400).json({
        message: 'Quality check must be completed before distribution',
        error: true,
        success: false,
      });
    }

    // Store distribution plan
    batch.distributionPlan = distributions.map((dist) => ({
      productId: dist.productId,
      productName: batch.items.find(
        (item) => item.product.toString() === dist.productId.toString()
      )?.product?.name,
      onlineQuantity: dist.onlineQuantity,
      offlineQuantity: dist.offlineQuantity,
      notes: dist.notes || '',
    }));

    batch.distributionStatus = 'AWAITING_APPROVAL';
    batch.distributionSubmittedBy = request.user._id;
    batch.distributionSubmittedDate = new Date();
    batch.distributionReason = reason;
    batch.distributionNotes = notes || '';
    batch.updatedBy = request.user._id;

    await batch.save();

    const populatedBatch = await StockModel.findById(batch._id)
      .populate('items.product', 'name sku')
      .populate('distributionSubmittedBy', 'name email');

    return response.json({
      message: 'Distribution submitted for approval',
      data: populatedBatch,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Distribute stock error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to submit distribution',
      error: true,
      success: false,
    });
  }
};

// Approve distribution (Director, IT, Manager only)
export const approveDistribution = async (request, response) => {
  try {
    const { batchId } = request.params;
    const { approved, approverNotes } = request.body;

    // Check user role
    if (!['Director', 'IT', 'Manager'].includes(request.user.role)) {
      return response.status(403).json({
        message: 'Only Director, IT, or Manager can approve distributions',
        error: true,
        success: false,
      });
    }

    const batch = await StockModel.findById(batchId).populate(
      'items.product',
      'name sku'
    );

    if (!batch) {
      return response.status(404).json({
        message: 'Stock batch not found',
        error: true,
        success: false,
      });
    }

    if (batch.distributionStatus !== 'AWAITING_APPROVAL') {
      return response.status(400).json({
        message: 'Distribution is not awaiting approval',
        error: true,
        success: false,
      });
    }

    if (approved) {
      // Apply the distribution to actual stock
      for (const dist of batch.distributionPlan) {
        const batchItem = batch.items.find(
          (item) => item.product._id.toString() === dist.productId.toString()
        );

        if (batchItem) {
          batchItem.onlineStock = dist.onlineQuantity;
          batchItem.offlineStock = dist.offlineQuantity;
        }

        // Update product stock
        const product = await ProductModel.findById(dist.productId);
        if (product) {
          // Only update if not manually managed by warehouse
          if (!product.warehouseStock?.enabled) {
            product.stock += dist.onlineQuantity + dist.offlineQuantity;
            await product.save();
          }
        }
      }

      batch.distributionStatus = 'APPROVED';
      batch.distributionApprovedBy = request.user._id;
      batch.distributionApprovedDate = new Date();
      batch.distributionApproverNotes = approverNotes || '';

      await batch.save();

      // Sync all affected products
      const affectedProducts = batch.distributionPlan.map(
        (dist) => dist.productId
      );
      for (const productId of affectedProducts) {
        await syncProductStockFromBatches(productId);
      }

      // Close the purchase order
      const purchaseOrder = await PurchaseOrderModel.findById(
        batch.purchaseOrder
      );
      if (purchaseOrder) {
        purchaseOrder.status = 'CLOSED';
        purchaseOrder.closedBy = request.user._id;
        purchaseOrder.closedDate = new Date();
        await purchaseOrder.save();
      }
    } else {
      batch.distributionStatus = 'REJECTED';
      batch.distributionRejectedBy = request.user._id;
      batch.distributionRejectedDate = new Date();
      batch.distributionRejectionNotes = approverNotes || '';
    }

    batch.updatedBy = request.user._id;
    await batch.save();

    const populatedBatch = await StockModel.findById(batch._id)
      .populate('items.product', 'name sku')
      .populate('distributionApprovedBy distributionRejectedBy', 'name email');

    return response.json({
      message: approved
        ? 'Distribution approved successfully'
        : 'Distribution rejected',
      data: populatedBatch,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Approve distribution error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to approve distribution',
      error: true,
      success: false,
    });
  }
};

// Get stock batches (updated for simplified system)
export const getStockBatches = async (request, response) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      qualityStatus,
      distributionStatus,
      supplier,
      expiringInDays,
    } = request.query;

    const query = {};

    if (search) {
      query.$or = [{ batchNumber: { $regex: search, $options: 'i' } }];
    }

    if (qualityStatus) {
      query.qualityStatus = qualityStatus;
    }

    if (distributionStatus) {
      query.distributionStatus = distributionStatus;
    }

    if (supplier) {
      query.supplier = supplier;
    }

    if (expiringInDays) {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + parseInt(expiringInDays));
      query['items.expiryDate'] = { $lte: futureDate, $gte: new Date() };
    }

    const skip = (page - 1) * limit;

    const [batches, totalCount] = await Promise.all([
      StockModel.find(query)
        .populate('items.product', 'name sku isPerishable')
        .populate('supplier', 'name')
        .populate('purchaseOrder', 'orderNumber')
        .populate(
          'qualityCheckBy distributionSubmittedBy distributionApprovedBy',
          'name email'
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      StockModel.countDocuments(query),
    ]);

    return response.json({
      message: 'Stock batches retrieved successfully',
      data: batches,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: parseInt(page),
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get stock batches error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to retrieve stock batches',
      error: true,
      success: false,
    });
  }
};

// Get expiring batches
export const getExpiringBatches = async (request, response) => {
  try {
    const { days = 30 } = request.query;

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + parseInt(days));

    const expiringBatches = await StockModel.find({
      'items.expiryDate': { $lte: futureDate, $gte: new Date() },
      qualityStatus: 'COMPLETED',
    })
      .populate('items.product', 'name sku')
      .populate('supplier', 'name')
      .sort({ 'items.expiryDate': 1 });

    // Flatten the results to show individual items
    const flattenedItems = [];
    expiringBatches.forEach((batch) => {
      batch.items.forEach((item) => {
        if (item.expiryDate && item.expiryDate <= futureDate) {
          const today = new Date();
          const daysUntilExpiry = Math.ceil(
            (item.expiryDate - today) / (1000 * 60 * 60 * 24)
          );

          flattenedItems.push({
            _id: item._id,
            batchId: batch._id,
            batchNumber: batch.batchNumber,
            product: item.product,
            supplier: batch.supplier,
            expiryDate: item.expiryDate,
            daysUntilExpiry,
            currentQuantity: item.passedQuantity + item.refurbishedQuantity,
            onlineStock: item.onlineStock || 0,
            offlineStock: item.offlineStock || 0,
          });
        }
      });
    });

    return response.json({
      message: 'Expiring batches retrieved successfully',
      data: flattenedItems,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get expiring batches error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to retrieve expiring batches',
      error: true,
      success: false,
    });
  }
};

// Get stock summary by product (simplified)
export const getStockSummary = async (request, response) => {
  try {
    const summary = await StockModel.aggregate([
      {
        $match: {
          qualityStatus: 'COMPLETED',
          distributionStatus: 'APPROVED',
        },
      },
      {
        $unwind: '$items',
      },
      {
        $group: {
          _id: '$items.product',
          totalQuantity: {
            $sum: {
              $add: ['$items.passedQuantity', '$items.refurbishedQuantity'],
            },
          },
          onlineStock: { $sum: '$items.onlineStock' },
          offlineStock: { $sum: '$items.offlineStock' },
          damagedQuantity: { $sum: '$items.damagedQuantity' },
          expiredQuantity: { $sum: '$items.expiredQuantity' },
          batchCount: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product',
        },
      },
      {
        $unwind: '$product',
      },
      {
        $project: {
          product: {
            _id: '$product._id',
            name: '$product.name',
            sku: '$product.sku',
          },
          totalQuantity: 1,
          onlineStock: 1,
          offlineStock: 1,
          damagedQuantity: 1,
          expiredQuantity: 1,
          batchCount: 1,
        },
      },
      {
        $sort: { 'product.name': 1 },
      },
    ]);

    return response.json({
      message: 'Stock summary retrieved successfully',
      data: summary,
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

// Get stock batch details
export const getStockBatchDetails = async (request, response) => {
  try {
    const { batchId } = request.params;

    const batch = await StockModel.findById(batchId)
      .populate('items.product', 'name sku isPerishable shelfLifeDays')
      .populate('supplier', 'name')
      .populate('purchaseOrder', 'orderNumber')
      .populate(
        'qualityCheckBy distributionSubmittedBy distributionApprovedBy distributionRejectedBy',
        'name email'
      )
      .populate('createdBy updatedBy', 'name email');

    if (!batch) {
      return response.status(404).json({
        message: 'Stock batch not found',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: 'Stock batch details retrieved successfully',
      data: batch,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get stock batch details error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to retrieve stock batch details',
      error: true,
      success: false,
    });
  }
};

// Close purchase order (after distribution approval)
export const closePurchaseOrder = async (request, response) => {
  try {
    const { purchaseOrderId } = request.params;

    const purchaseOrder = await PurchaseOrderModel.findById(purchaseOrderId);
    if (!purchaseOrder) {
      return response.status(404).json({
        message: 'Purchase order not found',
        error: true,
        success: false,
      });
    }

    purchaseOrder.status = 'CLOSED';
    purchaseOrder.closedBy = request.user._id;
    purchaseOrder.closedDate = new Date();
    await purchaseOrder.save();

    return response.json({
      message: 'Purchase order closed successfully',
      data: purchaseOrder,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Close purchase order error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to close purchase order',
      error: true,
      success: false,
    });
  }
};

// Reactivate purchase order (Director, IT only)
export const reactivatePurchaseOrder = async (request, response) => {
  try {
    const { purchaseOrderId } = request.params;
    const { reason } = request.body;

    // Check user role
    if (!['Director', 'IT'].includes(request.user.role)) {
      return response.status(403).json({
        message: 'Only Director or IT can reactivate purchase orders',
        error: true,
        success: false,
      });
    }

    const purchaseOrder = await PurchaseOrderModel.findById(purchaseOrderId);
    if (!purchaseOrder) {
      return response.status(404).json({
        message: 'Purchase order not found',
        error: true,
        success: false,
      });
    }

    if (purchaseOrder.status !== 'CLOSED') {
      return response.status(400).json({
        message: 'Only closed purchase orders can be reactivated',
        error: true,
        success: false,
      });
    }

    purchaseOrder.status = 'DELIVERED'; // Back to delivered status
    purchaseOrder.reactivatedBy = request.user._id;
    purchaseOrder.reactivatedDate = new Date();
    purchaseOrder.reactivationReason = reason || '';
    await purchaseOrder.save();

    return response.json({
      message: 'Purchase order reactivated successfully',
      data: purchaseOrder,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Reactivate purchase order error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to reactivate purchase order',
      error: true,
      success: false,
    });
  }
};
