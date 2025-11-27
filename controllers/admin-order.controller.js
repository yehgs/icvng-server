// controllers/admin-order.controller.js - For manual/sales orders
import OrderModel from '../models/order.model.js';
import CustomerModel from '../models/customer.model.js';
import ProductModel from '../models/product.model.js';
import UserModel from '../models/user.model.js';
import mongoose from 'mongoose';

// ===== CREATE MANUAL ORDER =====
export const createAdminOrderController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);

    // Only SALES can create orders
    if (user.role !== 'ADMIN' || user.subRole !== 'SALES') {
      return response.status(403).json({
        message: 'Only sales agents can create orders',
        error: true,
      });
    }

    const {
      customerId,
      items, // Array of { productId, quantity, priceOption }
      orderType, // BTC or BTB
      orderMode, // ONLINE or OFFLINE
      paymentMethod, // CASH, BANK_TRANSFER, CARD
      deliveryAddress,
      notes,
      customerNotes,
      discountAmount = 0,
      taxAmount = 0,
      shippingCost = 0,
    } = request.body;

    // Validate customer
    const customer = await CustomerModel.findById(customerId);
    if (!customer) {
      return response.status(404).json({
        message: 'Customer not found',
        error: true,
      });
    }

    // Check permissions
    if (!['IT', 'MANAGER', 'DIRECTOR'].includes(user.subRole)) {
      if (
        customer.createdBy?.toString() !== userId &&
        !customer.isWebsiteCustomer
      ) {
        return response.status(403).json({
          message: 'You can only create orders for customers you manage',
          error: true,
        });
      }
    }

    // Validate and process items
    let subTotal = 0;
    const processedOrders = [];

    for (const item of items) {
      const product = await ProductModel.findById(item.productId);
      if (!product) {
        return response.status(404).json({
          message: `Product with ID ${item.productId} not found`,
          error: true,
        });
      }

      // Get price based on option
      let unitPrice = product.price;
      if (item.priceOption === '3weeks') {
        unitPrice = product.price3weeksDelivery || product.price;
      } else if (item.priceOption === '5weeks') {
        unitPrice = product.price5weeksDelivery || product.price;
      }

      const itemSubtotal = unitPrice * item.quantity;
      subTotal += itemSubtotal;

      // Create individual order for each item
      const orderId = `ORD-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      processedOrders.push({
        // ===== UNIFIED FIELDS =====
        orderId,
        userId: null, // Manual orders don't have userId
        customerId, // Manual orders use customerId

        // Classification
        orderType,
        orderMode,
        isWebsiteOrder: false, // Critical: This is a manual order

        // Product
        productId: item.productId,
        product_details: {
          name: product.name,
          image: product.image,
          priceOption: item.priceOption || 'regular',
          deliveryTime: item.priceOption || 'regular',
        },
        quantity: item.quantity,
        unitPrice,

        // Pricing (split costs proportionally if multiple items)
        subTotalAmt: itemSubtotal,
        discount_amount: discountAmount / items.length,
        tax_amount: taxAmount / items.length,
        shipping_cost: shippingCost / items.length,
        totalAmt:
          itemSubtotal +
          taxAmount / items.length +
          shippingCost / items.length -
          discountAmount / items.length,
        currency: 'NGN',

        // Payment
        payment_status: paymentMethod === 'CASH' ? 'PENDING' : 'PENDING',
        payment_method: paymentMethod,

        // Delivery
        deliveryAddress: deliveryAddress || customer.address,

        // Created by sales agent
        createdBy: userId,

        // Notes
        notes,
        customer_notes: customerNotes,
      });
    }

    const orders = await OrderModel.insertMany(processedOrders);

    // Update customer statistics
    await CustomerModel.findByIdAndUpdate(customerId, {
      $inc: {
        totalOrders: orders.length,
        totalOrderValue: orders.reduce((sum, order) => sum + order.totalAmt, 0),
      },
      lastOrderDate: new Date(),
    });

    const populatedOrders = await OrderModel.find({
      _id: { $in: orders.map((o) => o._id) },
    })
      .populate('customerId', 'name email customerType companyName')
      .populate('createdBy', 'name email')
      .populate('productId', 'name image');

    return response.json({
      message: 'Orders created successfully',
      data: populatedOrders,
      success: true,
    });
  } catch (error) {
    console.error('Create admin order error:', error);
    return response.status(500).json({
      message: error.message,
      error: true,
    });
  }
};

// ===== GET ALL ORDERS (UNIFIED) =====
export const getAllOrdersController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);

    const {
      page = 1,
      limit = 10,
      search,
      orderType,
      orderMode,
      orderStatus,
      paymentStatus,
      isWebsiteOrder,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      startDate,
      endDate,
    } = request.query;

    // Build query based on user role
    let query = {};

    // Role-based filtering
    if (user.role === 'ADMIN') {
      if (['IT', 'MANAGER', 'DIRECTOR'].includes(user.subRole)) {
        // Can see all orders (both website and manual)
        query = {};
      } else if (user.subRole === 'SALES') {
        // Can see:
        // 1. Manual orders they created
        // 2. Website orders (to process them)
        query = {
          $or: [
            { createdBy: userId, isWebsiteOrder: false }, // Their manual orders
            { isWebsiteOrder: true }, // All website orders
          ],
        };
      } else {
        return response.status(403).json({
          message: 'Access denied',
          error: true,
        });
      }
    } else {
      return response.status(403).json({
        message: 'Access denied',
        error: true,
      });
    }

    // Add filters
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$and = query.$and || [];
      query.$and.push({
        $or: [{ orderId: searchRegex }, { invoiceNumber: searchRegex }],
      });
    }

    if (orderType) query.orderType = orderType;
    if (orderMode) query.orderMode = orderMode;
    if (orderStatus) query.order_status = orderStatus;
    if (paymentStatus) query.payment_status = paymentStatus;
    if (isWebsiteOrder !== undefined)
      query.isWebsiteOrder = isWebsiteOrder === 'true';

    // Date range filter
    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const [orders, totalCount] = await Promise.all([
      OrderModel.find(query)
        .populate('userId', 'name email mobile')
        .populate('customerId', 'name email customerType companyName mobile')
        .populate('createdBy', 'name email subRole')
        .populate('productId', 'name image')
        .populate('delivery_address')
        .populate('shippingMethod', 'name type')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      OrderModel.countDocuments(query),
    ]);

    // Transform orders to include unified customer field
    const transformedOrders = orders.map((order) => {
      const orderObj = order.toObject();
      orderObj.customer = order.isWebsiteOrder
        ? order.userId
        : order.customerId;
      return orderObj;
    });

    return response.json({
      message: 'Orders retrieved successfully',
      data: {
        docs: transformedOrders,
        totalDocs: totalCount,
        limit: parseInt(limit),
        page: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        hasNextPage: parseInt(page) < Math.ceil(totalCount / parseInt(limit)),
        hasPrevPage: parseInt(page) > 1,
      },
      success: true,
    });
  } catch (error) {
    console.error('Get orders error:', error);
    return response.status(500).json({
      message: error.message,
      error: true,
    });
  }
};

// ===== UPDATE ORDER STATUS =====
export const updateOrderStatusController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);
    const { orderId } = request.params;
    const { order_status, payment_status, notes } = request.body;

    const order = await OrderModel.findById(orderId);
    if (!order) {
      return response.status(404).json({
        message: 'Order not found',
        error: true,
      });
    }

    // Permission check
    if (user.role === 'ADMIN') {
      if (['IT', 'MANAGER', 'DIRECTOR'].includes(user.subRole)) {
        // Can update any order
      } else if (user.subRole === 'SALES') {
        // Can update:
        // 1. Orders they created
        // 2. Website orders (to process)
        if (!order.isWebsiteOrder && order.createdBy?.toString() !== userId) {
          return response.status(403).json({
            message: 'You can only update orders you created',
            error: true,
          });
        }
      } else {
        return response.status(403).json({
          message: 'Access denied',
          error: true,
        });
      }
    }

    const updateData = {};
    if (order_status) updateData.order_status = order_status;
    if (payment_status) updateData.payment_status = payment_status;
    if (notes) updateData.admin_notes = notes;

    // Set delivery date if delivered
    if (order_status === 'DELIVERED') {
      updateData.actual_delivery = new Date();
    }

    const updatedOrder = await OrderModel.findByIdAndUpdate(
      orderId,
      updateData,
      { new: true }
    )
      .populate('userId', 'name email')
      .populate('customerId', 'name email companyName')
      .populate('createdBy', 'name email');

    return response.json({
      message: 'Order updated successfully',
      data: updatedOrder,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message,
      error: true,
    });
  }
};

// ===== GET ORDER ANALYTICS =====
export const getOrderAnalyticsController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);

    if (user.role !== 'ADMIN') {
      return response.status(403).json({
        message: 'Access denied',
        error: true,
      });
    }

    const { startDate, endDate, agentId } = request.query;

    let matchQuery = {};

    // Role-based filtering
    if (user.subRole === 'SALES') {
      matchQuery = {
        $or: [
          {
            createdBy: new mongoose.Types.ObjectId(userId),
            isWebsiteOrder: false,
          },
          { isWebsiteOrder: true },
        ],
      };
    } else if (agentId) {
      matchQuery.createdBy = new mongoose.Types.ObjectId(agentId);
    }

    // Date range
    if (startDate && endDate) {
      matchQuery.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const analytics = await OrderModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$totalAmt' },
          avgOrderValue: { $avg: '$totalAmt' },

          // Order types
          btcOrders: {
            $sum: { $cond: [{ $eq: ['$orderType', 'BTC'] }, 1, 0] },
          },
          btbOrders: {
            $sum: { $cond: [{ $eq: ['$orderType', 'BTB'] }, 1, 0] },
          },

          // Order modes
          onlineOrders: {
            $sum: { $cond: [{ $eq: ['$orderMode', 'ONLINE'] }, 1, 0] },
          },
          offlineOrders: {
            $sum: { $cond: [{ $eq: ['$orderMode', 'OFFLINE'] }, 1, 0] },
          },

          // Sources
          websiteOrders: { $sum: { $cond: ['$isWebsiteOrder', 1, 0] } },
          manualOrders: {
            $sum: { $cond: [{ $not: '$isWebsiteOrder' }, 1, 0] },
          },

          // Status
          pendingOrders: {
            $sum: { $cond: [{ $eq: ['$order_status', 'PENDING'] }, 1, 0] },
          },
          completedOrders: {
            $sum: { $cond: [{ $eq: ['$order_status', 'DELIVERED'] }, 1, 0] },
          },
          paidOrders: {
            $sum: { $cond: [{ $eq: ['$payment_status', 'PAID'] }, 1, 0] },
          },
        },
      },
    ]);

    // Sales by agent (for directors/managers)
    let salesByAgent = [];
    if (['DIRECTOR', 'MANAGER', 'IT'].includes(user.subRole)) {
      salesByAgent = await OrderModel.aggregate([
        { $match: { ...matchQuery, isWebsiteOrder: false } },
        {
          $group: {
            _id: '$createdBy',
            totalOrders: { $sum: 1 },
            totalRevenue: { $sum: '$totalAmt' },
          },
        },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'agent',
          },
        },
        { $unwind: '$agent' },
        {
          $project: {
            agentName: '$agent.name',
            agentEmail: '$agent.email',
            totalOrders: 1,
            totalRevenue: 1,
          },
        },
        { $sort: { totalRevenue: -1 } },
      ]);
    }

    return response.json({
      message: 'Analytics retrieved successfully',
      data: {
        summary: analytics[0] || {
          totalOrders: 0,
          totalRevenue: 0,
          avgOrderValue: 0,
          btcOrders: 0,
          btbOrders: 0,
          onlineOrders: 0,
          offlineOrders: 0,
          websiteOrders: 0,
          manualOrders: 0,
          pendingOrders: 0,
          completedOrders: 0,
          paidOrders: 0,
        },
        salesByAgent,
      },
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message,
      error: true,
    });
  }
};

// ===== GENERATE INVOICE =====
export const generateInvoiceController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);
    const { orderId } = request.params;

    // Only SALES can generate invoices
    if (user.role !== 'ADMIN' || user.subRole !== 'SALES') {
      return response.status(403).json({
        message: 'Only sales agents can generate invoices',
        error: true,
      });
    }

    const order = await OrderModel.findById(orderId)
      .populate('userId', 'name email')
      .populate('customerId', 'name email companyName')
      .populate('productId', 'name image')
      .populate('createdBy', 'name email');

    if (!order) {
      return response.status(404).json({
        message: 'Order not found',
        error: true,
      });
    }

    // Permission check
    if (!['IT', 'MANAGER', 'DIRECTOR'].includes(user.subRole)) {
      if (!order.isWebsiteOrder && order.createdBy?.toString() !== userId) {
        return response.status(403).json({
          message: 'You can only generate invoices for orders you created',
          error: true,
        });
      }
    }

    // Generate invoice
    if (!order.invoiceGenerated) {
      order.invoiceGenerated = true;
      await order.save();
    }

    return response.json({
      message: 'Invoice generated successfully',
      data: {
        invoiceNumber: order.invoiceNumber,
        order,
      },
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message,
      error: true,
    });
  }
};
