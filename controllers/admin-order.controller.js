// controllers/admin-order.controller.js
import AdminOrderModel from '../models/admin-order.model.js';
import CustomerModel from '../models/customer.model.js';
import ProductModel from '../models/product.model.js';
import UserModel from '../models/user.model.js';
import mongoose from 'mongoose';
import { generateInvoiceTemplate } from '../utils/invoiceTemplate.js';
import sendEmail from '../config/sendEmail.js';

// Create new order through admin
export const createAdminOrderController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);

    // Only SALES subrole can create orders
    if (user.role !== 'ADMIN' || user.subRole !== 'SALES') {
      return response.status(403).json({
        message: 'Only sales agents can create orders',
        error: true,
        success: false,
      });
    }

    const {
      customerId,
      items,
      orderType,
      orderMode,
      paymentMethod,
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
        success: false,
      });
    }

    // Check if sales agent can access this customer
    if (!['IT', 'MANAGER', 'DIRECTOR'].includes(user.subRole)) {
      if (
        customer.createdBy?.toString() !== userId &&
        !customer.isWebsiteCustomer
      ) {
        return response.status(403).json({
          message: 'You can only create orders for customers you manage',
          error: true,
          success: false,
        });
      }
    }

    // Validate and process items
    let subTotal = 0;
    const processedItems = [];

    for (const item of items) {
      const product = await ProductModel.findById(item.productId);
      if (!product) {
        return response.status(404).json({
          message: `Product with ID ${item.productId} not found`,
          error: true,
          success: false,
        });
      }

      // Get price based on option
      let unitPrice = product.price;
      if (item.priceOption === '3weeks') {
        unitPrice = product.price3weeksDelivery || product.price;
      } else if (item.priceOption === '5weeks') {
        unitPrice = product.price5weeksDelivery || product.price;
      }

      const totalPrice = unitPrice * item.quantity;
      subTotal += totalPrice;

      processedItems.push({
        productId: item.productId,
        productName: product.name,
        quantity: item.quantity,
        unitPrice,
        totalPrice,
        priceOption: item.priceOption || 'regular',
      });
    }

    const totalAmount = subTotal + taxAmount + shippingCost - discountAmount;

    // Generate order ID
    const orderId = `ORD-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    const orderData = {
      orderId,
      customerId,
      items: processedItems,
      subTotal,
      discountAmount,
      taxAmount,
      shippingCost,
      totalAmount,
      orderType,
      orderMode,
      isWebsiteOrder: false,
      paymentMethod,
      createdBy: userId,
      deliveryAddress: deliveryAddress || customer.address,
      notes,
      customerNotes,
    };

    const newOrder = new AdminOrderModel(orderData);
    const savedOrder = await newOrder.save();

    // Update customer statistics
    await CustomerModel.findByIdAndUpdate(customerId, {
      $inc: {
        totalOrders: 1,
        totalOrderValue: totalAmount,
      },
      lastOrderDate: new Date(),
    });

    const populatedOrder = await AdminOrderModel.findById(savedOrder._id)
      .populate('customerId', 'name email customerType companyName')
      .populate('createdBy', 'name email')
      .populate('items.productId', 'name image');

    return response.json({
      message: 'Order created successfully',
      data: populatedOrder,
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

// Get orders list with dynamic filtering
export const getAdminOrdersController = async (request, response) => {
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
        // Can see all orders
        query = {};
      } else if (user.subRole === 'SALES') {
        // Can only see orders they created or website orders
        query = {
          $or: [{ createdBy: userId }, { isWebsiteOrder: true }],
        };
      } else {
        return response.status(403).json({
          message: 'Access denied',
          error: true,
          success: false,
        });
      }
    } else {
      return response.status(403).json({
        message: 'Access denied',
        error: true,
        success: false,
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
    if (orderStatus) query.orderStatus = orderStatus;
    if (paymentStatus) query.paymentStatus = paymentStatus;
    if (isWebsiteOrder !== undefined)
      query.isWebsiteOrder = isWebsiteOrder === 'true';

    // Date range filter
    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { [sortBy]: sortOrder === 'desc' ? -1 : 1 },
      populate: [
        {
          path: 'customerId',
          select: 'name email customerType companyName',
        },
        {
          path: 'createdBy',
          select: 'name email subRole',
        },
        {
          path: 'items.productId',
          select: 'name image',
        },
      ],
    };

    const orders = await AdminOrderModel.paginate(query, options);

    return response.json({
      message: 'Orders retrieved successfully',
      data: orders,
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

// Update order status
export const updateOrderStatusController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);
    const { orderId } = request.params;
    const { orderStatus, paymentStatus, notes } = request.body;

    const order = await AdminOrderModel.findById(orderId);
    if (!order) {
      return response.status(404).json({
        message: 'Order not found',
        error: true,
        success: false,
      });
    }

    // Permission check
    if (user.role === 'ADMIN') {
      if (['IT', 'MANAGER', 'DIRECTOR'].includes(user.subRole)) {
        // Can update any order
      } else if (user.subRole === 'SALES') {
        // Can only update orders they created
        if (order.createdBy?.toString() !== userId && !order.isWebsiteOrder) {
          return response.status(403).json({
            message: 'You can only update orders you created',
            error: true,
            success: false,
          });
        }
      } else {
        return response.status(403).json({
          message: 'Access denied',
          error: true,
          success: false,
        });
      }
    } else {
      return response.status(403).json({
        message: 'Access denied',
        error: true,
        success: false,
      });
    }

    const updateData = {};
    if (orderStatus) updateData.orderStatus = orderStatus;
    if (paymentStatus) updateData.paymentStatus = paymentStatus;
    if (notes) updateData.notes = notes;

    // Set delivery date if order is delivered
    if (orderStatus === 'DELIVERED') {
      updateData.deliveryDate = new Date();
    }

    const updatedOrder = await AdminOrderModel.findByIdAndUpdate(
      orderId,
      updateData,
      { new: true }
    ).populate('customerId createdBy');

    return response.json({
      message: 'Order updated successfully',
      data: updatedOrder,
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

// Generate and send invoice
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
        success: false,
      });
    }

    const order = await AdminOrderModel.findById(orderId)
      .populate('customerId')
      .populate('items.productId')
      .populate('createdBy');

    if (!order) {
      return response.status(404).json({
        message: 'Order not found',
        error: true,
        success: false,
      });
    }

    // Permission check
    if (!['IT', 'MANAGER', 'DIRECTOR'].includes(user.subRole)) {
      if (order.createdBy?.toString() !== userId && !order.isWebsiteOrder) {
        return response.status(403).json({
          message: 'You can only generate invoices for orders you created',
          error: true,
          success: false,
        });
      }
    }

    // Mark invoice as generated if not already
    if (!order.invoiceGenerated) {
      order.invoiceGenerated = true;
      await order.save();
    }

    // Generate invoice HTML
    const invoiceHtml = generateInvoiceTemplate({
      order,
      customer: order.customerId,
      items: order.items,
      salesAgent: order.createdBy,
    });

    // Send invoice email to customer
    try {
      await sendEmail({
        sendTo: order.customerId.email,
        subject: `Invoice ${order.invoiceNumber} - I-Coffee Nigeria`,
        html: invoiceHtml,
      });
    } catch (emailError) {
      console.error('Failed to send invoice email:', emailError);
    }

    return response.json({
      message: 'Invoice generated and sent successfully',
      data: {
        invoiceNumber: order.invoiceNumber,
        invoiceHtml,
        order,
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

// Get order analytics
export const getOrderAnalyticsController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);

    // Only admin roles can access analytics
    if (user.role !== 'ADMIN') {
      return response.status(403).json({
        message: 'Access denied',
        error: true,
        success: false,
      });
    }

    const { startDate, endDate, agentId } = request.query;

    let matchQuery = {};

    // Role-based filtering for analytics
    if (user.subRole === 'SALES') {
      matchQuery = {
        $or: [
          { createdBy: new mongoose.Types.ObjectId(userId) },
          { isWebsiteOrder: true },
        ],
      };
    } else if (agentId) {
      matchQuery.createdBy = new mongoose.Types.ObjectId(agentId);
    }

    // Date range filter
    if (startDate && endDate) {
      matchQuery.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const analytics = await AdminOrderModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$totalAmount' },
          avgOrderValue: { $avg: '$totalAmount' },
          btcOrders: {
            $sum: { $cond: [{ $eq: ['$orderType', 'BTC'] }, 1, 0] },
          },
          btbOrders: {
            $sum: { $cond: [{ $eq: ['$orderType', 'BTB'] }, 1, 0] },
          },
          onlineOrders: {
            $sum: { $cond: [{ $eq: ['$orderMode', 'ONLINE'] }, 1, 0] },
          },
          offlineOrders: {
            $sum: { $cond: [{ $eq: ['$orderMode', 'OFFLINE'] }, 1, 0] },
          },
          websiteOrders: {
            $sum: { $cond: ['$isWebsiteOrder', 1, 0] },
          },
          adminOrders: {
            $sum: { $cond: [{ $not: '$isWebsiteOrder' }, 1, 0] },
          },
          pendingOrders: {
            $sum: { $cond: [{ $eq: ['$orderStatus', 'PENDING'] }, 1, 0] },
          },
          completedOrders: {
            $sum: { $cond: [{ $eq: ['$orderStatus', 'DELIVERED'] }, 1, 0] },
          },
          paidOrders: {
            $sum: { $cond: [{ $eq: ['$paymentStatus', 'PAID'] }, 1, 0] },
          },
        },
      },
    ]);

    // Get top products
    const topProducts = await AdminOrderModel.aggregate([
      { $match: matchQuery },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.productId',
          productName: { $first: '$items.productName' },
          totalQuantity: { $sum: '$items.quantity' },
          totalRevenue: { $sum: '$items.totalPrice' },
        },
      },
      { $sort: { totalQuantity: -1 } },
      { $limit: 10 },
    ]);

    // Get sales by agent (for directors/managers)
    let salesByAgent = [];
    if (['DIRECTOR', 'MANAGER', 'IT'].includes(user.subRole)) {
      salesByAgent = await AdminOrderModel.aggregate([
        { $match: { ...matchQuery, isWebsiteOrder: false } },
        {
          $group: {
            _id: '$createdBy',
            totalOrders: { $sum: 1 },
            totalRevenue: { $sum: '$totalAmount' },
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

    const result = {
      summary: analytics[0] || {
        totalOrders: 0,
        totalRevenue: 0,
        avgOrderValue: 0,
        btcOrders: 0,
        btbOrders: 0,
        onlineOrders: 0,
        offlineOrders: 0,
        websiteOrders: 0,
        adminOrders: 0,
        pendingOrders: 0,
        completedOrders: 0,
        paidOrders: 0,
      },
      topProducts,
      salesByAgent,
    };

    return response.json({
      message: 'Order analytics retrieved successfully',
      data: result,
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
