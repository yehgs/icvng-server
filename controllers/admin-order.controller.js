// controllers/admin-order.controller.js - COMPLETE CORRECTED VERSION
import OrderModel from "../models/order.model.js";
import CustomerModel from "../models/customer.model.js";
import ProductModel from "../models/product.model.js";
import UserModel from "../models/user.model.js";
import mongoose from "mongoose";
import { generateInvoiceTemplate } from "../utils/invoiceTemplate.js";
import sendEmail from "../config/sendEmail.js";

// Helper functions
const getProductPrice = (product, priceOption = "regular") => {
  switch (priceOption) {
    case "3weeks":
      return product.price3weeksDelivery || product.btcPrice || product.price;
    case "5weeks":
      return product.price5weeksDelivery || product.btcPrice || product.price;
    default:
      return product.btcPrice || product.price;
  }
};

const pricewithDiscount = (price, dis = 0) => {
  const discountAmount = Math.ceil((Number(price) * Number(dis)) / 100);
  return Number(price) - discountAmount;
};

// ===== CREATE MANUAL ORDER WITH WAREHOUSE STOCK DEDUCTION =====
export const createAdminOrderController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);

    if (user.role !== "ADMIN" || user.subRole !== "SALES") {
      return response.status(403).json({
        message: "Only sales agents can create orders",
        error: true,
      });
    }

    const {
      customerId,
      items,
      orderType,
      orderMode,
      paymentMethod,
      deliveryAddress,
      shippingMethodId,
      notes,
      customerNotes,
      discountAmount = 0,
      taxAmount = 0,
      shippingCost = 0,
      sendInvoiceEmail = false,
    } = request.body;

    const customer = await CustomerModel.findById(customerId);
    if (!customer) {
      return response.status(404).json({
        message: "Customer not found",
        error: true,
      });
    }

    if (!["IT", "MANAGER", "DIRECTOR"].includes(user.subRole)) {
      if (
        customer.createdBy?.toString() !== userId &&
        !customer.isWebsiteCustomer
      ) {
        return response.status(403).json({
          message: "You can only create orders for customers you manage",
          error: true,
        });
      }
    }

    const orderGroupId = `GRP-${Date.now()}-${customerId}`;
    const shippingCostPerItem = shippingCost / items.length;

    const groupTotals = {
      subTotal: 0,
      totalShipping: shippingCost,
      totalDiscount: discountAmount,
      totalTax: taxAmount,
      grandTotal: 0,
      itemCount: items.length,
    };

    const processedOrders = [];
    const stockUpdates = [];

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const firstOrderId = `ORD-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        const isParent = index === 0;

        const product = await ProductModel.findById(item.productId).session(
          session
        );
        if (!product) {
          throw new Error(`Product with ID ${item.productId} not found`);
        }

        const availableStock = product.warehouseStock?.enabled
          ? product.warehouseStock.offlineStock || 0
          : product.stock || 0;

        if (availableStock < item.quantity) {
          throw new Error(
            `Insufficient stock for ${product.name}. Available: ${availableStock}, Required: ${item.quantity}`
          );
        }

        let unitPrice;
        if (orderType === "BTB") {
          unitPrice = product.btbPrice || product.price;
        } else {
          unitPrice = getProductPrice(product, item.priceOption);
        }

        if (!unitPrice || unitPrice <= 0) {
          throw new Error(`Invalid price for product ${product.name}`);
        }

        const itemSubtotal = unitPrice * item.quantity;
        const itemTotal =
          itemSubtotal +
          shippingCostPerItem +
          taxAmount / items.length -
          discountAmount / items.length;

        groupTotals.subTotal += itemSubtotal;
        groupTotals.grandTotal += itemTotal;

        if (product.warehouseStock?.enabled) {
          const newOfflineStock =
            (product.warehouseStock.offlineStock || 0) - item.quantity;
          const newFinalStock =
            (product.warehouseStock.finalStock || 0) - item.quantity;

          await ProductModel.findByIdAndUpdate(
            item.productId,
            {
              "warehouseStock.offlineStock": newOfflineStock,
              "warehouseStock.finalStock": newFinalStock,
              "warehouseStock.lastUpdated": new Date(),
              "warehouseStock.updatedBy": userId,
            },
            { session }
          );

          stockUpdates.push({
            productId: item.productId,
            productName: product.name,
            quantityDeducted: item.quantity,
            previousOfflineStock: product.warehouseStock.offlineStock || 0,
            newOfflineStock,
          });
        } else {
          const newStock = (product.stock || 0) - item.quantity;
          await ProductModel.findByIdAndUpdate(
            item.productId,
            { stock: newStock },
            { session }
          );

          stockUpdates.push({
            productId: item.productId,
            productName: product.name,
            quantityDeducted: item.quantity,
            previousStock: product.stock || 0,
            newStock,
          });
        }

        const orderId = isParent
          ? firstOrderId
          : `ORD-${Date.now()}-${index}-${Math.random()
              .toString(36)
              .substr(2, 9)}`;

        processedOrders.push({
          orderId,
          userId: null,
          customerId,
          orderGroupId,
          isParentOrder: isParent,
          parentOrderId: isParent ? null : firstOrderId,
          orderSequence: index + 1,
          totalItemsInGroup: items.length,
          orderType,
          orderMode,
          isWebsiteOrder: false,
          productId: item.productId,
          product_details: {
            name: product.name,
            image: product.image,
            priceOption: item.priceOption || "regular",
            deliveryTime: item.priceOption || "regular",
            sku: product.sku,
          },
          quantity: item.quantity,
          unitPrice,
          subTotalAmt: itemSubtotal,
          discount_amount: discountAmount / items.length,
          tax_amount: taxAmount / items.length,
          shipping_cost: shippingCostPerItem,
          totalAmt: itemTotal,
          currency: "NGN",
          groupTotals: isParent ? groupTotals : {},
          payment_status: paymentMethod === "CASH" ? "PENDING" : "PENDING",
          payment_method: paymentMethod,
          paymentId: `MAN-${Date.now()}`,
          order_status: "CONFIRMED",
          deliveryAddress: deliveryAddress || customer.address,
          delivery_address: null,
          shippingMethod: shippingMethodId || null,
          createdBy: userId,
          notes,
          customer_notes: customerNotes,
          invoiceGenerated: false,
        });
      }

      if (processedOrders.length > 0) {
        processedOrders[0].groupTotals = groupTotals;
      }

      const orders = await OrderModel.insertMany(processedOrders, { session });

      await CustomerModel.findByIdAndUpdate(
        customerId,
        {
          $inc: {
            totalOrders: orders.length,
            totalOrderValue: orders.reduce(
              (sum, order) => sum + order.totalAmt,
              0
            ),
          },
          lastOrderDate: new Date(),
        },
        { session }
      );

      await session.commitTransaction();

      console.log(
        `✅ Manual order: Created order group ${orderGroupId} with ${orders.length} orders`
      );

      const populatedOrders = await OrderModel.find({
        _id: { $in: orders.map((o) => o._id) },
      })
        .populate(
          "customerId",
          "name email customerType companyName mobile address"
        )
        .populate("createdBy", "name email")
        .populate("productId", "name image sku");

      // ✅ SEND INVOICE EMAIL IF REQUESTED
      if (sendInvoiceEmail && customer.email) {
        try {
          const mainOrder = populatedOrders[0];

          const invoiceHTML = generateInvoiceTemplate({
            order: {
              orderId: mainOrder.orderId,
              invoiceNumber: mainOrder.invoiceNumber,
              invoiceDate: mainOrder.createdAt,
              createdAt: mainOrder.createdAt,
              orderType: mainOrder.orderType,
              orderMode: mainOrder.orderMode,
              orderStatus: mainOrder.order_status,
              paymentStatus: mainOrder.payment_status,
              paymentMethod: mainOrder.payment_method,
              subTotal: groupTotals.subTotal,
              discountAmount,
              taxAmount,
              shippingCost,
              totalAmount: groupTotals.grandTotal,
              notes: mainOrder.notes,
              customerNotes: mainOrder.customer_notes,
              isWebsiteOrder: false,
            },
            customer: {
              name: customer.name,
              email: customer.email,
              mobile: customer.mobile,
              customerType: customer.customerType,
              companyName: customer.companyName,
              address: deliveryAddress || customer.address,
              taxNumber: customer.taxNumber,
            },
            items: populatedOrders.map((order) => ({
              productName: order.productId.name,
              priceOption: order.product_details.priceOption,
              quantity: order.quantity,
              unitPrice: order.unitPrice,
              totalPrice: order.totalAmt,
            })),
            salesAgent: {
              name: user.name,
              email: user.email,
            },
          });

          await sendEmail({
            sendTo: customer.email,
            subject: `Invoice - Order ${mainOrder.orderId} | I-COFFEE.NG`,
            html: invoiceHTML,
            senderName: user.name,
            replyTo: user.email,
          });

          console.log(
            `✅ Invoice email sent to ${customer.email} from ${user.name}`
          );
        } catch (emailError) {
          console.error("❌ Error sending invoice email:", emailError);
        }
      }

      return response.json({
        message: "Orders created successfully",
        data: {
          orders: populatedOrders,
          stockUpdates,
          invoiceEmailSent: sendInvoiceEmail && customer.email,
          orderGroupId,
        },
        success: true,
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error("Create admin order error:", error);
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
      sortBy = "createdAt",
      sortOrder = "desc",
      startDate,
      endDate,
    } = request.query;

    let query = {};

    if (user.role === "ADMIN") {
      if (["IT", "MANAGER", "DIRECTOR"].includes(user.subRole)) {
        query = {};
      } else if (user.subRole === "SALES") {
        query = {
          $or: [
            { createdBy: userId, isWebsiteOrder: false },
            { isWebsiteOrder: true },
          ],
        };
      } else {
        return response.status(403).json({
          message: "Access denied",
          error: true,
        });
      }
    } else {
      return response.status(403).json({
        message: "Access denied",
        error: true,
      });
    }

    if (search) {
      const searchRegex = new RegExp(search, "i");
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
      query.isWebsiteOrder = isWebsiteOrder === "true";

    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

    const [orders, totalCount] = await Promise.all([
      OrderModel.find(query)
        .populate("userId", "name email mobile")
        .populate("customerId", "name email customerType companyName mobile")
        .populate("createdBy", "name email subRole")
        .populate("productId", "name image sku")
        .populate("delivery_address")
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      OrderModel.countDocuments(query),
    ]);

    return response.json({
      message: "Orders retrieved successfully",
      data: {
        docs: orders,
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
    console.error("Get orders error:", error);
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
        message: "Order not found",
        error: true,
      });
    }

    if (user.role === "ADMIN") {
      if (["IT", "MANAGER", "DIRECTOR"].includes(user.subRole)) {
        // Can update any order
      } else if (user.subRole === "SALES") {
        if (!order.isWebsiteOrder && order.createdBy?.toString() !== userId) {
          return response.status(403).json({
            message: "You can only update orders you created",
            error: true,
          });
        }
      } else {
        return response.status(403).json({
          message: "Access denied",
          error: true,
        });
      }
    }

    const updateData = {};
    if (order_status) updateData.order_status = order_status;
    if (payment_status) updateData.payment_status = payment_status;
    if (notes) updateData.admin_notes = notes;

    if (order_status === "DELIVERED") {
      updateData.actual_delivery = new Date();
    }

    const updatedOrder = await OrderModel.findByIdAndUpdate(
      orderId,
      updateData,
      { new: true }
    )
      .populate("userId", "name email")
      .populate("customerId", "name email companyName")
      .populate("createdBy", "name email");

    return response.json({
      message: "Order updated successfully",
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

// ===== GENERATE INVOICE WITH EMAIL OPTION =====
export const generateInvoiceController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);
    const { orderId } = request.params;
    const { sendEmail: shouldSendEmail = false } = request.body;

    if (user.role !== "ADMIN" || user.subRole !== "SALES") {
      return response.status(403).json({
        message: "Only sales agents can generate invoices",
        error: true,
      });
    }

    const order = await OrderModel.findById(orderId)
      .populate("userId", "name email")
      .populate(
        "customerId",
        "name email companyName customerType mobile address taxNumber"
      )
      .populate("productId", "name image sku")
      .populate("createdBy", "name email")
      .populate("delivery_address");

    if (!order) {
      return response.status(404).json({
        message: "Order not found",
        error: true,
      });
    }

    if (!["IT", "MANAGER", "DIRECTOR"].includes(user.subRole)) {
      if (!order.isWebsiteOrder && order.createdBy?.toString() !== userId) {
        return response.status(403).json({
          message: "You can only generate invoices for orders you created",
          error: true,
        });
      }
    }

    if (!order.invoiceGenerated) {
      order.invoiceGenerated = true;
      await order.save();
    }

    let deliveryAddress = null;
    if (order.isWebsiteOrder) {
      deliveryAddress = order.delivery_address;
    } else {
      deliveryAddress = order.deliveryAddress || order.customerId?.address;
    }

    let emailSent = false;
    if (shouldSendEmail) {
      const customer = order.isWebsiteOrder ? order.userId : order.customerId;

      if (customer && customer.email) {
        try {
          const invoiceHTML = generateInvoiceTemplate({
            order: {
              orderId: order.orderId,
              invoiceNumber: order.invoiceNumber,
              invoiceDate: order.createdAt,
              createdAt: order.createdAt,
              orderType: order.orderType,
              orderMode: order.orderMode,
              orderStatus: order.order_status,
              paymentStatus: order.payment_status,
              paymentMethod: order.payment_method,
              subTotal: order.subTotalAmt,
              discountAmount: order.discount_amount || 0,
              taxAmount: order.tax_amount || 0,
              shippingCost: order.shipping_cost || 0,
              totalAmount: order.totalAmt,
              notes: order.notes,
              customerNotes: order.customer_notes,
              isWebsiteOrder: order.isWebsiteOrder,
            },
            customer: {
              name: customer.name,
              email: customer.email,
              mobile: customer.mobile || order.userId?.mobile,
              customerType: customer.customerType,
              companyName: customer.companyName,
              address: deliveryAddress,
              taxNumber: customer.taxNumber,
            },
            items: [
              {
                productName: order.productId.name,
                priceOption: order.product_details?.priceOption || "regular",
                quantity: order.quantity,
                unitPrice: order.unitPrice,
                totalPrice: order.totalAmt,
              },
            ],
            salesAgent: order.createdBy
              ? {
                  name: order.createdBy.name,
                  email: order.createdBy.email,
                }
              : null,
          });

          await sendEmail({
            sendTo: customer.email,
            subject: `Invoice ${order.invoiceNumber} - Order ${order.orderId} | I-COFFEE.NG`,
            html: invoiceHTML,
            senderName: order.createdBy?.name || user.name,
            replyTo: order.createdBy?.email || user.email,
          });

          emailSent = true;
          console.log(
            `✅ Invoice email sent to ${customer.email} from ${
              order.createdBy?.name || user.name
            }`
          );
        } catch (emailError) {
          console.error("❌ Error sending invoice email:", emailError);
        }
      }
    }

    return response.json({
      message: "Invoice generated successfully",
      data: {
        invoiceNumber: order.invoiceNumber,
        order,
        emailSent,
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

// ===== GET ORDER ANALYTICS =====
export const getOrderAnalyticsController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);

    if (user.role !== "ADMIN") {
      return response.status(403).json({
        message: "Access denied",
        error: true,
      });
    }

    const { startDate, endDate, agentId } = request.query;

    let matchQuery = {};

    if (user.subRole === "SALES") {
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
          totalRevenue: { $sum: "$totalAmt" },
          avgOrderValue: { $avg: "$totalAmt" },
          btcOrders: {
            $sum: { $cond: [{ $eq: ["$orderType", "BTC"] }, 1, 0] },
          },
          btbOrders: {
            $sum: { $cond: [{ $eq: ["$orderType", "BTB"] }, 1, 0] },
          },
          onlineOrders: {
            $sum: { $cond: [{ $eq: ["$orderMode", "ONLINE"] }, 1, 0] },
          },
          offlineOrders: {
            $sum: { $cond: [{ $eq: ["$orderMode", "OFFLINE"] }, 1, 0] },
          },
          websiteOrders: { $sum: { $cond: ["$isWebsiteOrder", 1, 0] } },
          manualOrders: {
            $sum: { $cond: [{ $not: "$isWebsiteOrder" }, 1, 0] },
          },
          pendingOrders: {
            $sum: { $cond: [{ $eq: ["$order_status", "PENDING"] }, 1, 0] },
          },
          completedOrders: {
            $sum: { $cond: [{ $eq: ["$order_status", "DELIVERED"] }, 1, 0] },
          },
          paidOrders: {
            $sum: { $cond: [{ $eq: ["$payment_status", "PAID"] }, 1, 0] },
          },
        },
      },
    ]);

    let salesByAgent = [];
    if (["DIRECTOR", "MANAGER", "IT"].includes(user.subRole)) {
      salesByAgent = await OrderModel.aggregate([
        { $match: { ...matchQuery, isWebsiteOrder: false } },
        {
          $group: {
            _id: "$createdBy",
            totalOrders: { $sum: 1 },
            totalRevenue: { $sum: "$totalAmt" },
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "agent",
          },
        },
        { $unwind: "$agent" },
        {
          $project: {
            agentName: "$agent.name",
            agentEmail: "$agent.email",
            totalOrders: 1,
            totalRevenue: 1,
          },
        },
        { $sort: { totalRevenue: -1 } },
      ]);
    }

    return response.json({
      message: "Analytics retrieved successfully",
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

// ===== PREVIEW INVOICE WITHOUT GENERATING =====
export const previewInvoiceController = async (request, response) => {
  try {
    const userId = request.userId;
    const user = await UserModel.findById(userId);

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

    const customer = await CustomerModel.findById(customerId);
    if (!customer) {
      return response.status(404).json({
        message: "Customer not found",
        error: true,
      });
    }

    let subTotal = 0;
    const itemsForInvoice = [];

    for (const item of items) {
      const product = await ProductModel.findById(item.productId);
      if (!product) {
        continue;
      }

      let unitPrice;
      if (orderType === "BTB") {
        unitPrice = product.btbPrice || product.price;
      } else {
        unitPrice = getProductPrice(product, item.priceOption);
      }

      const itemTotal = unitPrice * item.quantity;
      subTotal += itemTotal;

      itemsForInvoice.push({
        productName: product.name,
        priceOption: item.priceOption || "regular",
        quantity: item.quantity,
        unitPrice,
        totalPrice: itemTotal,
      });
    }

    const totalAmount = subTotal + taxAmount + shippingCost - discountAmount;

    const invoiceHTML = generateInvoiceTemplate({
      order: {
        orderId: "PREVIEW",
        invoiceNumber: "PREVIEW",
        invoiceDate: new Date(),
        createdAt: new Date(),
        orderType,
        orderMode,
        orderStatus: "PENDING",
        paymentStatus: "PENDING",
        paymentMethod,
        subTotal,
        discountAmount,
        taxAmount,
        shippingCost,
        totalAmount,
        notes,
        customerNotes,
        isWebsiteOrder: false,
      },
      customer: {
        name: customer.name,
        email: customer.email,
        mobile: customer.mobile,
        customerType: customer.customerType,
        companyName: customer.companyName,
        address: deliveryAddress || customer.address,
        taxNumber: customer.taxNumber,
      },
      items: itemsForInvoice,
      salesAgent: {
        name: user.name,
        email: user.email,
      },
    });

    return response.json({
      message: "Invoice preview generated",
      data: {
        html: invoiceHTML,
        summary: {
          subTotal,
          discountAmount,
          taxAmount,
          shippingCost,
          totalAmount,
          itemCount: items.length,
        },
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
