import PurchaseOrderModel from "../models/purchase-order.model.js";
import SupplierModel from "../models/supplier.model.js";
import ProductModel from "../models/product.model.js";
import ExchangeRateModel from "../models/exchange-rate.model.js";

// Create purchase order
export const createPurchaseOrder = async (request, response) => {
  try {
    const {
      supplier,
      items,
      expectedDeliveryDate,
      currency,
      exchangeRate,
      taxAmount,
      shippingCost,
      discountAmount,
      logistics,
      shippingAddress,
      paymentTerms,
      deliveryTerms,
      notes,
      internalNotes,
      receipts,
    } = request.body;

    if (!supplier || !items || items.length === 0 || !expectedDeliveryDate) {
      return response.status(400).json({
        message: "Supplier, items, and expected delivery date are required",
        error: true,
        success: false,
      });
    }

    // Validate logistics if provided
    if (logistics && !logistics.transportMode) {
      return response.status(400).json({
        message:
          "Transport mode is required when logistics information is provided",
        error: true,
        success: false,
      });
    }

    // Validate supplier exists
    const supplierDoc = await SupplierModel.findById(supplier);
    if (!supplierDoc) {
      return response.status(404).json({
        message: "Supplier not found",
        error: true,
        success: false,
      });
    }

    // Process receipts if provided
    const processedReceipts = receipts
      ? receipts.map((receipt) => ({
          ...receipt,
          uploadedBy: request.user._id,
          uploadedAt: receipt.uploadedAt || new Date(),
        }))
      : [];

    // Validate products exist and calculate totals
    let calculatedSubtotal = 0;
    const processedItems = [];

    for (const item of items) {
      const product = await ProductModel.findById(item.product);
      if (!product) {
        return response.status(404).json({
          message: `Product with ID ${item.product} not found`,
          error: true,
          success: false,
        });
      }

      const totalPrice = item.quantity * item.unitPrice;
      calculatedSubtotal += totalPrice;

      processedItems.push({
        ...item,
        totalPrice,
      });
    }

    // Get exchange rate if currency is different from base
    let finalExchangeRate = exchangeRate || 1;
    const baseCurrency = "USD";

    if (currency && currency !== baseCurrency && !exchangeRate) {
      const dbExchangeRate = await ExchangeRateModel.getRate(
        baseCurrency,
        currency,
      );
      if (dbExchangeRate) {
        finalExchangeRate = dbExchangeRate;
      } else {
        console.warn(
          `Exchange rate not found for ${baseCurrency} to ${currency}, using rate 1`,
        );
      }
    }

    // Process logistics information
    const logisticsData = logistics
      ? {
          transportMode: logistics.transportMode,
          freightCost: logistics.freightCost || 0,
          clearanceCost: logistics.clearanceCost || 0,
          otherLogisticsCost: logistics.otherLogisticsCost || 0,
          totalLogisticsCost:
            (logistics.freightCost || 0) +
            (logistics.clearanceCost || 0) +
            (logistics.otherLogisticsCost || 0),
        }
      : {
          transportMode: "AIR",
          freightCost: 0,
          clearanceCost: 0,
          otherLogisticsCost: 0,
          totalLogisticsCost: 0,
        };

    // Calculate totals
    const subtotal = calculatedSubtotal;
    const finalTaxAmount = taxAmount || 0;
    const finalShippingCost = shippingCost || 0;
    const finalDiscountAmount = discountAmount || 0;
    const totalLogisticsCost = logisticsData.totalLogisticsCost;

    // Calculate totalAmount (subtotal + tax + shipping - discount)
    const totalAmount =
      subtotal + finalTaxAmount + finalShippingCost - finalDiscountAmount;

    // Calculate grandTotal (totalAmount + logistics costs)
    const grandTotal = totalAmount + totalLogisticsCost;

    // Generate order number and batch number
    const orderNumber = await generateOrderNumber();
    const batchNumber = await generateBatchNumber();

    const purchaseOrder = new PurchaseOrderModel({
      orderNumber,
      batchNumber,
      supplier,
      items: processedItems,
      receipts: processedReceipts,
      expectedDeliveryDate: new Date(expectedDeliveryDate),
      currency: currency || baseCurrency,
      subtotal,
      totalAmount,
      grandTotal,
      taxAmount: finalTaxAmount,
      shippingCost: finalShippingCost,
      discountAmount: finalDiscountAmount,
      logistics: logisticsData,
      exchangeRate: finalExchangeRate,
      baseCurrency,
      shippingAddress: shippingAddress || {},
      paymentTerms: paymentTerms || "NET_30",
      deliveryTerms: deliveryTerms || "FOB",
      notes: notes || "",
      internalNotes: internalNotes || "",
      status: "DRAFT",
      orderDate: new Date(),
      createdBy: request.user._id,
      updatedBy: request.user._id,
    });

    const savedOrder = await purchaseOrder.save();

    // Populate the saved order
    const populatedOrder = await PurchaseOrderModel.findById(savedOrder._id)
      .populate("supplier", "name email phone")
      .populate("items.product", "name sku")
      .populate("createdBy updatedBy", "name email");

    return response.json({
      message: "Purchase order created successfully",
      data: populatedOrder,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Create purchase order error:", error);
    return response.status(500).json({
      message: error.message || "Failed to create purchase order",
      error: true,
      success: false,
    });
  }
};

// Get purchase orders
export const getPurchaseOrders = async (request, response) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      supplier: supplierId,
      startDate,
      endDate,
    } = request.query;

    const query = {};

    if (search) {
      query.$or = [
        { orderNumber: { $regex: search, $options: "i" } },
        { batchNumber: { $regex: search, $options: "i" } },
      ];
    }

    if (status) {
      query.status = status;
    }

    if (supplierId) {
      query.supplier = supplierId;
    }

    if (startDate || endDate) {
      query.orderDate = {};
      if (startDate) query.orderDate.$gte = new Date(startDate);
      if (endDate) query.orderDate.$lte = new Date(endDate);
    }

    const skip = (page - 1) * limit;

    const [orders, totalCount] = await Promise.all([
      PurchaseOrderModel.find(query)
        .populate("supplier", "name email phone")
        .populate("items.product", "name sku")
        .populate("createdBy updatedBy approvedBy", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      PurchaseOrderModel.countDocuments(query),
    ]);

    return response.json({
      message: "Purchase orders retrieved successfully",
      data: orders,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: parseInt(page),
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Get purchase orders error:", error);
    return response.status(500).json({
      message: error.message || "Failed to retrieve purchase orders",
      error: true,
      success: false,
    });
  }
};

// Get purchase order details
export const getPurchaseOrderDetails = async (request, response) => {
  try {
    const { orderId } = request.params;

    const order = await PurchaseOrderModel.findById(orderId)
      .populate("supplier")
      .populate("items.product")
      .populate("createdBy updatedBy approvedBy qualityCheckBy", "name email");

    if (!order) {
      return response.status(404).json({
        message: "Purchase order not found",
        error: true,
        success: false,
      });
    }

    return response.json({
      message: "Purchase order details retrieved successfully",
      data: order,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Get purchase order details error:", error);
    return response.status(500).json({
      message: error.message || "Failed to retrieve purchase order details",
      error: true,
      success: false,
    });
  }
};

// Update purchase order
export const updatePurchaseOrder = async (request, response) => {
  try {
    const { orderId } = request.params;
    const updateData = request.body;

    const order = await PurchaseOrderModel.findById(orderId);
    if (!order) {
      return response.status(404).json({
        message: "Purchase order not found",
        error: true,
        success: false,
      });
    }

    // Prevent editing of delivered or completed orders
    if (["DELIVERED", "COMPLETED", "CANCELLED"].includes(order.status)) {
      return response.status(400).json({
        message: `Cannot edit ${order.status.toLowerCase()} purchase orders`,
        error: true,
        success: false,
      });
    }

    // Recalculate totals if items are updated
    if (updateData.items) {
      let calculatedSubtotal = 0;
      const processedItems = [];

      for (const item of updateData.items) {
        const totalPrice = item.quantity * item.unitPrice;
        calculatedSubtotal += totalPrice;
        processedItems.push({
          ...item,
          totalPrice,
        });
      }

      updateData.items = processedItems;
      updateData.subtotal = calculatedSubtotal;
    }

    // Recalculate logistics costs if logistics data is updated
    if (updateData.logistics) {
      updateData.logistics.totalLogisticsCost =
        (updateData.logistics.freightCost || 0) +
        (updateData.logistics.clearanceCost || 0) +
        (updateData.logistics.otherLogisticsCost || 0);
    }

    updateData.updatedBy = request.user._id;

    const updatedOrder = await PurchaseOrderModel.findByIdAndUpdate(
      orderId,
      updateData,
      { new: true, runValidators: true },
    )
      .populate("supplier", "name email phone")
      .populate("items.product", "name sku")
      .populate("createdBy updatedBy approvedBy", "name email");

    return response.json({
      message: "Purchase order updated successfully",
      data: updatedOrder,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Update purchase order error:", error);
    return response.status(500).json({
      message: error.message || "Failed to update purchase order",
      error: true,
      success: false,
    });
  }
};

// Update purchase order status with role-based validation
export const updateOrderStatus = async (request, response) => {
  try {
    const { orderId } = request.params;
    const { status, notes, reason } = request.body;
    const user = request.user;

    if (!status) {
      return response.status(400).json({
        message: "Status is required",
        error: true,
        success: false,
      });
    }

    // Get the current order
    const order = await PurchaseOrderModel.findById(orderId);
    if (!order) {
      return response.status(404).json({
        message: "Purchase order not found",
        error: true,
        success: false,
      });
    }

    // Validate status transition and role permissions
    const validationResult = validateStatusUpdate(
      order.status,
      status,
      user.subRole || user.role,
    );
    if (!validationResult.isValid) {
      return response.status(403).json({
        message: validationResult.message,
        error: true,
        success: false,
      });
    }

    // Create status history entry
    const statusHistory = {
      previousStatus: order.status,
      newStatus: status,
      changedBy: user._id,
      changedAt: new Date(),
      notes: notes || "",
      reason: reason || "",
      userRole: user.subRole || user.role,
    };

    // Update the order
    const updateData = {
      status,
      updatedBy: user._id,
      updatedAt: new Date(),
      $push: { statusHistory: statusHistory },
    };

    // Set specific fields based on status
    switch (status) {
      case "APPROVED":
        updateData.approvedBy = user._id;
        updateData.approvedAt = new Date();
        break;
      case "DELIVERED":
        updateData.deliveredAt = new Date();
        break;
      case "COMPLETED":
        updateData.completedAt = new Date();
        break;
      case "CANCELLED":
        updateData.cancelledBy = user._id;
        updateData.cancelledAt = new Date();
        updateData.cancellationReason = reason || notes || "No reason provided";
        break;
    }

    const updatedOrder = await PurchaseOrderModel.findByIdAndUpdate(
      orderId,
      updateData,
      { new: true, runValidators: true },
    )
      .populate("supplier", "name email phone")
      .populate("items.product", "name sku")
      .populate("createdBy updatedBy approvedBy cancelledBy", "name email role")
      .populate("statusHistory.changedBy", "name email role");

    // Add internal notes for tracking
    const noteEntry = `[${new Date().toISOString()}] Status changed from ${
      order.status
    } to ${status} by ${user.name} (${user.subRole || user.role})${
      notes ? `: ${notes}` : ""
    }`;

    if (updatedOrder.internalNotes) {
      updatedOrder.internalNotes += `\n${noteEntry}`;
    } else {
      updatedOrder.internalNotes = noteEntry;
    }

    await updatedOrder.save();

    return response.json({
      message: `Purchase order status updated to ${status}`,
      data: updatedOrder,
      statusChange: {
        from: order.status,
        to: status,
        changedBy: user.name,
        changedAt: statusHistory.changedAt,
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Update order status error:", error);
    return response.status(500).json({
      message: error.message || "Failed to update order status",
      error: true,
      success: false,
    });
  }
};

// Role-based status transition validation
function validateStatusUpdate(currentStatus, newStatus, userRole) {
  // Define valid status transitions
  const statusTransitions = {
    DRAFT: ["PENDING", "CANCELLED"],
    PENDING: ["APPROVED", "CANCELLED", "DRAFT"],
    APPROVED: ["DELIVERED", "CANCELLED"],
    DELIVERED: ["COMPLETED", "CANCELLED"],
    COMPLETED: [], // Final status
    CANCELLED: [], // Final status
  };

  // Define role permissions - removed ADMIN and EMPLOYEE, gave WAREHOUSE employee capabilities
  const rolePermissions = {
    WAREHOUSE: {
      canUpdate: ["DRAFT", "APPROVED"],
      canUpdateTo: ["PENDING", "DELIVERED"],
    },
    IT: {
      canUpdate: ["DRAFT", "PENDING", "APPROVED", "DELIVERED"],
      canUpdateTo: [
        "PENDING",
        "APPROVED",
        "DELIVERED",
        "COMPLETED",
        "CANCELLED",
      ],
    },
    DIRECTOR: {
      canUpdate: ["DRAFT", "PENDING", "APPROVED", "DELIVERED", "COMPLETED"],
      canUpdateTo: [
        "PENDING",
        "APPROVED",
        "DELIVERED",
        "COMPLETED",
        "CANCELLED",
      ],
    },
  };

  // Check if status transition is valid
  if (!statusTransitions[currentStatus]?.includes(newStatus)) {
    return {
      isValid: false,
      message: `Invalid status transition from ${currentStatus} to ${newStatus}`,
    };
  }

  // Check role permissions
  const userPermissions = rolePermissions[userRole.toUpperCase()];
  if (!userPermissions) {
    return {
      isValid: false,
      message: `Unknown user role: ${userRole}`,
    };
  }

  // Check if user can update from current status
  if (!userPermissions.canUpdate.includes(currentStatus)) {
    return {
      isValid: false,
      message: `Your role (${userRole}) cannot update orders with status ${currentStatus}`,
    };
  }

  // Check if user can update to new status
  if (!userPermissions.canUpdateTo.includes(newStatus)) {
    return {
      isValid: false,
      message: `Your role (${userRole}) cannot set order status to ${newStatus}`,
    };
  }

  return { isValid: true };
}

// Get allowed status updates for a user
export const getAllowedStatusUpdates = async (request, response) => {
  try {
    const { orderId } = request.params;
    const user = request.user;

    const order = await PurchaseOrderModel.findById(orderId);
    if (!order) {
      return response.status(404).json({
        message: "Purchase order not found",
        error: true,
        success: false,
      });
    }

    const allowedStatuses = getValidStatusTransitions(
      order.status,
      user.subRole || user.role,
    );

    return response.json({
      message: "Allowed status updates retrieved successfully",
      data: {
        currentStatus: order.status,
        allowedStatuses,
        userRole: user.subRole || user.role,
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Get allowed status updates error:", error);
    return response.status(500).json({
      message: error.message || "Failed to get allowed status updates",
      error: true,
      success: false,
    });
  }
};

// Helper function to get valid status transitions for a role
function getValidStatusTransitions(currentStatus, userRole) {
  const statusTransitions = {
    DRAFT: ["PENDING", "CANCELLED"],
    PENDING: ["APPROVED", "CANCELLED", "DRAFT"],
    APPROVED: ["DELIVERED", "CANCELLED"],
    DELIVERED: ["COMPLETED", "CANCELLED"],
    COMPLETED: [],
    CANCELLED: [],
  };

  const rolePermissions = {
    WAREHOUSE: {
      canUpdate: ["DRAFT", "APPROVED"],
      canUpdateTo: ["PENDING", "DELIVERED"],
    },
    IT: {
      canUpdate: ["DRAFT", "PENDING", "APPROVED", "DELIVERED"],
      canUpdateTo: [
        "PENDING",
        "APPROVED",
        "DELIVERED",
        "COMPLETED",
        "CANCELLED",
      ],
    },
    DIRECTOR: {
      canUpdate: ["DRAFT", "PENDING", "APPROVED", "DELIVERED", "COMPLETED"],
      canUpdateTo: [
        "PENDING",
        "APPROVED",
        "DELIVERED",
        "COMPLETED",
        "CANCELLED",
      ],
    },
  };

  const possibleTransitions = statusTransitions[currentStatus] || [];
  const userPermissions = rolePermissions[userRole.toUpperCase()];

  if (!userPermissions || !userPermissions.canUpdate.includes(currentStatus)) {
    return [];
  }

  return possibleTransitions.filter((status) =>
    userPermissions.canUpdateTo.includes(status),
  );
}

// Get status history
export const getStatusHistory = async (request, response) => {
  try {
    const { orderId } = request.params;

    const order = await PurchaseOrderModel.findById(orderId)
      .populate("statusHistory.changedBy", "name email role")
      .select("statusHistory orderNumber status");

    if (!order) {
      return response.status(404).json({
        message: "Purchase order not found",
        error: true,
        success: false,
      });
    }

    return response.json({
      message: "Status history retrieved successfully",
      data: {
        orderNumber: order.orderNumber,
        currentStatus: order.status,
        history: order.statusHistory || [],
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Get status history error:", error);
    return response.status(500).json({
      message: error.message || "Failed to get status history",
      error: true,
      success: false,
    });
  }
};

// Delete purchase order
export const deletePurchaseOrder = async (request, response) => {
  try {
    const { orderId } = request.params;

    const order = await PurchaseOrderModel.findById(orderId);
    if (!order) {
      return response.status(404).json({
        message: "Purchase order not found",
        error: true,
        success: false,
      });
    }

    // Only allow deletion of draft orders
    if (order.status !== "DRAFT") {
      return response.status(400).json({
        message: "Only draft purchase orders can be deleted",
        error: true,
        success: false,
      });
    }

    await PurchaseOrderModel.findByIdAndDelete(orderId);

    return response.json({
      message: "Purchase order deleted successfully",
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Delete purchase order error:", error);
    return response.status(500).json({
      message: error.message || "Failed to delete purchase order",
      error: true,
      success: false,
    });
  }
};

// Get purchase order statistics
export const getPurchaseOrderStats = async (request, response) => {
  try {
    const stats = await PurchaseOrderModel.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$totalAmount" },
          grandTotal: { $sum: "$grandTotal" },
          totalLogisticsCost: { $sum: "$logistics.totalLogisticsCost" },
        },
      },
    ]);

    const monthlyStats = await PurchaseOrderModel.aggregate([
      {
        $match: {
          orderDate: {
            $gte: new Date(new Date().getFullYear(), 0, 1),
          },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$orderDate" },
            month: { $month: "$orderDate" },
          },
          count: { $sum: 1 },
          totalAmount: { $sum: "$totalAmount" },
          grandTotal: { $sum: "$grandTotal" },
          totalLogisticsCost: { $sum: "$logistics.totalLogisticsCost" },
        },
      },
      {
        $sort: { "_id.year": 1, "_id.month": 1 },
      },
    ]);

    const logisticsStats = await PurchaseOrderModel.aggregate([
      {
        $group: {
          _id: "$logistics.transportMode",
          count: { $sum: 1 },
          averageLogisticsCost: { $avg: "$logistics.totalLogisticsCost" },
          totalLogisticsCost: { $sum: "$logistics.totalLogisticsCost" },
          averageFreightCost: { $avg: "$logistics.freightCost" },
          averageClearanceCost: { $avg: "$logistics.clearanceCost" },
        },
      },
      {
        $sort: { totalLogisticsCost: -1 },
      },
    ]);

    return response.json({
      message: "Purchase order statistics retrieved successfully",
      data: {
        statusStats: stats,
        monthlyStats,
        logisticsStats,
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Get purchase order stats error:", error);
    return response.status(500).json({
      message: error.message || "Failed to retrieve statistics",
      error: true,
      success: false,
    });
  }
};

// Get logistics cost analysis
export const getLogisticsCostAnalysis = async (request, response) => {
  try {
    const { startDate, endDate, transportMode, supplier } = request.query;

    const matchStage = {};

    if (startDate || endDate) {
      matchStage.orderDate = {};
      if (startDate) matchStage.orderDate.$gte = new Date(startDate);
      if (endDate) matchStage.orderDate.$lte = new Date(endDate);
    }

    if (transportMode) {
      matchStage["logistics.transportMode"] = transportMode;
    }

    if (supplier) {
      matchStage.supplier = mongoose.Types.ObjectId(supplier);
    }

    const analysis = await PurchaseOrderModel.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalProductCost: { $sum: "$subtotal" },
          totalLogisticsCost: { $sum: "$logistics.totalLogisticsCost" },
          totalFreightCost: { $sum: "$logistics.freightCost" },
          totalClearanceCost: { $sum: "$logistics.clearanceCost" },
          totalOtherLogisticsCost: { $sum: "$logistics.otherLogisticsCost" },
          averageLogisticsCostPerOrder: {
            $avg: "$logistics.totalLogisticsCost",
          },
          averageLogisticsCostPercentage: {
            $avg: {
              $cond: {
                if: { $gt: ["$subtotal", 0] },
                then: {
                  $multiply: [
                    { $divide: ["$logistics.totalLogisticsCost", "$subtotal"] },
                    100,
                  ],
                },
                else: 0,
              },
            },
          },
        },
      },
    ]);

    const transportModeAnalysis = await PurchaseOrderModel.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$logistics.transportMode",
          orderCount: { $sum: 1 },
          totalLogisticsCost: { $sum: "$logistics.totalLogisticsCost" },
          averageLogisticsCost: { $avg: "$logistics.totalLogisticsCost" },
          averageLogisticsCostPercentage: {
            $avg: {
              $cond: {
                if: { $gt: ["$subtotal", 0] },
                then: {
                  $multiply: [
                    { $divide: ["$logistics.totalLogisticsCost", "$subtotal"] },
                    100,
                  ],
                },
                else: 0,
              },
            },
          },
        },
      },
      {
        $sort: { totalLogisticsCost: -1 },
      },
    ]);

    return response.json({
      message: "Logistics cost analysis retrieved successfully",
      data: {
        overall: analysis[0] || {},
        byTransportMode: transportModeAnalysis,
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Get logistics cost analysis error:", error);
    return response.status(500).json({
      message: error.message || "Failed to retrieve logistics cost analysis",
      error: true,
      success: false,
    });
  }
};

// Helper functions to generate order and batch numbers
async function generateOrderNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");

  const lastOrder = await PurchaseOrderModel.findOne({
    orderNumber: { $regex: `^PO-${year}${month}` },
  }).sort({ orderNumber: -1 });

  let sequence = 1;
  if (lastOrder) {
    const lastSequence = parseInt(lastOrder.orderNumber.split("-")[2]);
    sequence = lastSequence + 1;
  }

  return `PO-${year}${month}-${String(sequence).padStart(4, "0")}`;
}

async function generateBatchNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  const lastBatch = await PurchaseOrderModel.findOne({
    batchNumber: { $regex: `^BATCH-${year}${month}${day}` },
  }).sort({ batchNumber: -1 });

  let sequence = 1;
  if (lastBatch) {
    const lastSequence = parseInt(lastBatch.batchNumber.split("-")[2]);
    sequence = lastSequence + 1;
  }

  return `BATCH-${year}${month}${day}-${String(sequence).padStart(3, "0")}`;
}
