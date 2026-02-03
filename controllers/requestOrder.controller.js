// controllers/orderRequest.controller.js - UPDATED WITH SHIPPING
import OrderRequestModel from "../models/order-request.model.js";
import ProductModel from "../models/product.model.js";
import CustomerModel from "../models/customer.model.js";
import AddressModel from "../models/address.model.js";
import UserModel from "../models/user.model.js";
import CouponModel from "../models/coupon.model.js";
import ShippingZoneModel from "../models/shipping-zone.model.js";
import ShippingMethodModel from "../models/shipping-method.model.js";
import { transporter } from "../utils/nodemailer.js";
import mongoose from "mongoose";
import {
  sendOrderNotificationToSales,
  sendOrderStatusUpdateNotification,
  sendOrderAssignmentNotification,
  sendOrderCancellationNotification,
} from "../utils/order-request-emails.js";

/**
 * Create Order Request (Customer) - WITH SHIPPING
 */
export const createOrderRequest = async (req, res) => {
  try {
    const userId = req.userId; // From auth middleware
    const {
      items,
      shippingAddressId,
      billingAddressId,
      customerNotes,
      couponCode,
      shippingMethodId,
      pickupLocationId, // For pickup methods
    } = req.body;

    // Validation
    if (!items || items.length === 0) {
      return res.status(400).json({
        message: "Please add at least one item to your order",
        error: true,
        success: false,
      });
    }

    if (!shippingAddressId) {
      return res.status(400).json({
        message: "Shipping address is required",
        error: true,
        success: false,
      });
    }

    if (!shippingMethodId) {
      return res.status(400).json({
        message: "Shipping method is required",
        error: true,
        success: false,
      });
    }

    // Get user and customer
    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({
        message: "User not found",
        error: true,
        success: false,
      });
    }

    const customer = await CustomerModel.findOne({ email: user.email });
    if (!customer) {
      return res.status(404).json({
        message: "Customer profile not found",
        error: true,
        success: false,
      });
    }

    // Verify addresses
    const shippingAddress = await AddressModel.findOne({
      _id: shippingAddressId,
      userId: userId,
      status: true,
    }).populate("shipping_zone");

    if (!shippingAddress) {
      return res.status(404).json({
        message: "Invalid shipping address",
        error: true,
        success: false,
      });
    }

    let billingAddress = shippingAddress;
    if (billingAddressId && billingAddressId !== shippingAddressId) {
      billingAddress = await AddressModel.findOne({
        _id: billingAddressId,
        userId: userId,
        status: true,
      });

      if (!billingAddress) {
        return res.status(404).json({
          message: "Invalid billing address",
          error: true,
          success: false,
        });
      }
    }

    // Find shipping zone for address
    let shippingZone = shippingAddress.shipping_zone;

    if (!shippingZone) {
      const zones = await ShippingZoneModel.find({ isActive: true });

      for (const zone of zones) {
        const stateMatch = zone.states.find(
          (state) =>
            state.name.toLowerCase().trim() ===
            shippingAddress.state.toLowerCase().trim(),
        );

        if (stateMatch) {
          let lgaCovered = false;

          if (
            stateMatch.coverage_type === "all" ||
            !stateMatch.covered_lgas ||
            stateMatch.covered_lgas.length === 0
          ) {
            lgaCovered = true;
          } else if (stateMatch.coverage_type === "specific") {
            lgaCovered = stateMatch.covered_lgas?.some(
              (lga) =>
                lga.toLowerCase().trim() ===
                shippingAddress.lga.toLowerCase().trim(),
            );
          }

          if (lgaCovered) {
            shippingZone = zone;
            // Update address with zone
            await AddressModel.findByIdAndUpdate(shippingAddressId, {
              shipping_zone: zone._id,
            });
            break;
          }
        }
      }
    }

    // Process and validate items
    const processedItems = [];
    let subtotal = 0;
    let totalWeight = 0;

    for (const item of items) {
      const product = await ProductModel.findById(item.productId)
        .populate("category")
        .populate("brand");

      if (!product) {
        return res.status(404).json({
          message: `Product ${item.productId} not found`,
          error: true,
          success: false,
        });
      }

      // Check if product is BTB
      if (!product.btbProduct) {
        return res.status(400).json({
          message: `Product "${product.name}" is not available for BTB orders`,
          error: true,
          success: false,
        });
      }

      // Check stock availability
      const effectiveStock = product.effectiveStock;
      if (effectiveStock < item.quantity) {
        return res.status(400).json({
          message: `Insufficient stock for "${product.name}". Available: ${effectiveStock}`,
          error: true,
          success: false,
        });
      }

      const btbPrice = product.btbPrice || 0;
      const itemSubtotal = btbPrice * item.quantity;
      const itemWeight = (product.weight || 1) * item.quantity;

      processedItems.push({
        product: product._id,
        quantity: item.quantity,
        btbPrice: btbPrice,
        weight: product.weight || 1,
        discount: 0,
        discountType: "PERCENTAGE",
        finalPrice: btbPrice,
        subtotal: itemSubtotal,
      });

      subtotal += itemSubtotal;
      totalWeight += itemWeight;
    }

    // Verify and calculate shipping
    const shippingMethod = await ShippingMethodModel.findById(shippingMethodId);

    if (!shippingMethod || !shippingMethod.isActive) {
      return res.status(404).json({
        message: "Invalid or inactive shipping method",
        error: true,
        success: false,
      });
    }

    // Check if method is currently valid
    if (!shippingMethod.isCurrentlyValid()) {
      return res.status(400).json({
        message: "Selected shipping method is not currently available",
        error: true,
        success: false,
      });
    }

    // Calculate shipping cost
    const shippingCalculation = shippingMethod.calculateShippingCost({
      weight: totalWeight,
      orderValue: subtotal,
      zone: shippingZone?._id,
      items: processedItems,
    });

    if (!shippingCalculation.eligible) {
      return res.status(400).json({
        message: `Shipping not available: ${shippingCalculation.reason}`,
        error: true,
        success: false,
      });
    }

    const shippingCost = shippingCalculation.cost;

    // Handle pickup location if pickup method
    let pickupLocation = null;
    if (shippingMethod.type === "pickup" && pickupLocationId) {
      const locations = shippingMethod.getPickupLocationsForZone(
        shippingZone?._id,
      );
      pickupLocation = locations.find(
        (loc) => loc._id?.toString() === pickupLocationId,
      );

      if (!pickupLocation) {
        return res.status(400).json({
          message: "Invalid pickup location",
          error: true,
          success: false,
        });
      }
    }

    // Apply coupon if provided
    let couponDiscount = 0;
    let validCoupon = null;

    if (couponCode) {
      const coupon = await CouponModel.findOne({
        code: couponCode.toUpperCase(),
      });

      if (coupon && coupon.isValid()) {
        // Check min order amount
        if (coupon.minOrderAmount && subtotal < coupon.minOrderAmount) {
          return res.status(400).json({
            message: `Minimum order amount for this coupon is ₦${coupon.minOrderAmount.toLocaleString()}`,
            error: true,
            success: false,
          });
        }

        // Calculate discount
        if (coupon.discountType === "PERCENTAGE") {
          couponDiscount = (subtotal * coupon.discountValue) / 100;
          if (
            coupon.maxDiscountAmount &&
            couponDiscount > coupon.maxDiscountAmount
          ) {
            couponDiscount = coupon.maxDiscountAmount;
          }
        } else {
          couponDiscount = coupon.discountValue;
        }

        validCoupon = coupon;
      }
    }

    // Calculate estimated delivery
    let estimatedDeliveryDate = null;
    if (shippingMethod.estimatedDelivery) {
      const daysToAdd = shippingMethod.estimatedDelivery.maxDays || 7;
      estimatedDeliveryDate = new Date();
      estimatedDeliveryDate.setDate(
        estimatedDeliveryDate.getDate() + daysToAdd,
      );
    }

    // Create order request
    const orderRequest = new OrderRequestModel({
      customer: customer._id,
      user: userId,
      orderMode: "ONLINE",
      items: processedItems,
      shippingAddress: shippingAddressId,
      billingAddress: billingAddress._id,

      // Shipping fields
      shippingZone: shippingZone?._id,
      shippingMethod: shippingMethodId,
      shippingMethodDetails: {
        name: shippingMethod.name,
        code: shippingMethod.code,
        type: shippingMethod.type,
      },
      totalWeight: totalWeight,
      shippingCost: shippingCost,
      pickupLocation: pickupLocation,
      estimatedDeliveryDate: estimatedDeliveryDate,

      couponCode: validCoupon ? validCoupon.code : null,
      couponDiscount: couponDiscount,
      subtotal: subtotal,
      totalDiscount: couponDiscount,
      totalAmount: subtotal + shippingCost - couponDiscount,
      customerNotes: customerNotes || "",
      status: "PENDING",
    });

    await orderRequest.save();

    // Update coupon usage
    if (validCoupon) {
      validCoupon.usageCount += 1;
      await validCoupon.save();
    }

    // Populate order for response
    const populatedOrder = await OrderRequestModel.findById(orderRequest._id)
      .populate({
        path: "items.product",
        select: "name slug image btbPrice sku category brand weight",
        populate: [
          { path: "category", select: "name" },
          { path: "brand", select: "name" },
        ],
      })
      .populate("shippingAddress")
      .populate("billingAddress")
      .populate("customer")
      .populate("shippingZone", "name code")
      .populate("shippingMethod", "name code type estimatedDelivery");

    // Send notification to sales team
    await sendOrderNotificationToSales(populatedOrder);

    // Send confirmation to customer
    await sendOrderConfirmationToCustomer(populatedOrder, user);

    res.status(201).json({
      message: "Order request created successfully",
      error: false,
      success: true,
      data: populatedOrder,
    });
  } catch (error) {
    console.error("Create order request error:", error);
    res.status(500).json({
      message: error.message || "Failed to create order request",
      error: true,
      success: false,
    });
  }
};

/**
 * Calculate Available Shipping Methods for Order
 */
export const calculateOrderShipping = async (req, res) => {
  try {
    const userId = req.userId;
    const { shippingAddressId, items } = req.body;

    if (!shippingAddressId || !items || items.length === 0) {
      return res.status(400).json({
        message: "Address and items are required",
        error: true,
        success: false,
      });
    }

    // Get address with zone
    const address = await AddressModel.findOne({
      _id: shippingAddressId,
      userId: userId,
      status: true,
    }).populate("shipping_zone");

    if (!address) {
      return res.status(404).json({
        message: "Address not found",
        error: true,
        success: false,
      });
    }

    // Find zone if not assigned
    let zone = address.shipping_zone;

    if (!zone) {
      const zones = await ShippingZoneModel.find({ isActive: true });

      for (const testZone of zones) {
        const stateMatch = testZone.states.find(
          (state) =>
            state.name.toLowerCase().trim() ===
            address.state.toLowerCase().trim(),
        );

        if (stateMatch) {
          let lgaCovered = false;

          if (
            stateMatch.coverage_type === "all" ||
            !stateMatch.covered_lgas ||
            stateMatch.covered_lgas.length === 0
          ) {
            lgaCovered = true;
          } else if (stateMatch.coverage_type === "specific") {
            lgaCovered = stateMatch.covered_lgas?.some(
              (lga) =>
                lga.toLowerCase().trim() === address.lga.toLowerCase().trim(),
            );
          }

          if (lgaCovered) {
            zone = testZone;
            await AddressModel.findByIdAndUpdate(shippingAddressId, {
              shipping_zone: testZone._id,
            });
            break;
          }
        }
      }
    }

    // Get products and calculate weight
    const productIds = items.map((item) => item.productId);
    const products = await ProductModel.find({
      _id: { $in: productIds },
      btbProduct: true,
      publish: "PUBLISHED",
    }).populate("category");

    if (products.length === 0) {
      return res.status(400).json({
        message: "No valid BTB products found",
        error: true,
        success: false,
      });
    }

    let totalWeight = 0;
    let subtotal = 0;
    const categoryIds = [
      ...new Set(products.map((p) => p.category?._id).filter(Boolean)),
    ];

    for (const item of items) {
      const product = products.find(
        (p) => p._id.toString() === item.productId.toString(),
      );
      if (product) {
        totalWeight += (product.weight || 1) * item.quantity;
        subtotal += (product.btbPrice || 0) * item.quantity;
      }
    }

    // Get available shipping methods
    const shippingMethods = await ShippingMethodModel.find({
      isActive: true,
    }).sort({ sortOrder: 1 });

    const availableMethods = [];

    for (const method of shippingMethods) {
      if (!method.isCurrentlyValid()) continue;

      const configKeyMap = {
        flat_rate: "flatRate",
        table_shipping: "tableShipping",
        pickup: "pickup",
      };

      const configKey = configKeyMap[method.type];
      const config = method[configKey];

      if (!config) continue;

      // Check assignment
      let appliesToItems = false;
      const assignment = config.assignment || "all_products";

      switch (assignment) {
        case "all_products":
          appliesToItems = true;
          break;
        case "categories":
          if (!config.categories || config.categories.length === 0) {
            appliesToItems = true;
          } else {
            appliesToItems = categoryIds.some((catId) =>
              config.categories.some(
                (methodCatId) => methodCatId.toString() === catId.toString(),
              ),
            );
          }
          break;
        case "specific_products":
          if (!config.products || config.products.length === 0) {
            appliesToItems = true;
          } else {
            appliesToItems = productIds.some((prodId) =>
              config.products.some(
                (methodProdId) => methodProdId.toString() === prodId.toString(),
              ),
            );
          }
          break;
      }

      if (!appliesToItems) continue;

      // Check availability and calculate cost
      const calculation = method.calculateShippingCost({
        weight: totalWeight,
        orderValue: subtotal,
        zone: zone?._id,
        items: items,
      });

      if (calculation.eligible) {
        const methodData = {
          _id: method._id,
          name: method.name,
          code: method.code,
          type: method.type,
          description: method.description,
          cost: calculation.cost,
          estimatedDelivery: method.estimatedDelivery,
          reason: calculation.reason,
        };

        // Add pickup locations for pickup methods
        if (method.type === "pickup") {
          const locations = method.getPickupLocationsForZone(zone?._id);
          methodData.pickupLocations = locations;
        }

        if (zone) {
          methodData.zoneInfo = {
            zoneId: zone._id,
            zoneName: zone.name,
            zoneCode: zone.code,
          };
        }

        availableMethods.push(methodData);
      }
    }

    // Sort: free first, then by price
    availableMethods.sort((a, b) => {
      if (a.cost === 0 && b.cost !== 0) return -1;
      if (a.cost !== 0 && b.cost === 0) return 1;
      return a.cost - b.cost;
    });

    res.status(200).json({
      message: "Shipping methods calculated successfully",
      error: false,
      success: true,
      data: {
        zone: zone
          ? {
              _id: zone._id,
              name: zone.name,
              code: zone.code,
            }
          : null,
        methods: availableMethods,
        totalWeight,
        subtotal,
        address: {
          city: address.city,
          state: address.state,
          lga: address.lga,
        },
      },
    });
  } catch (error) {
    console.error("Calculate shipping error:", error);
    res.status(500).json({
      message: error.message || "Failed to calculate shipping",
      error: true,
      success: false,
    });
  }
};

/**
 * Get Customer's Order Requests
 */
export const getCustomerOrderRequests = async (req, res) => {
  try {
    const userId = req.userId;
    const { page = 1, limit = 10, status } = req.query;

    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({
        message: "User not found",
        error: true,
        success: false,
      });
    }

    // Build query
    const query = { user: userId };
    if (status) {
      query.status = status;
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { createdAt: -1 },
      populate: [
        {
          path: "items.product",
          select: "name slug image btbPrice sku",
        },
        {
          path: "shippingAddress",
          select: "address_line city state lga mobile",
        },
        {
          path: "assignedTo",
          select: "name email",
        },
      ],
    };

    const orders = await OrderRequestModel.paginate(query, options);

    res.status(200).json({
      message: "Orders fetched successfully",
      error: false,
      success: true,
      data: orders,
    });
  } catch (error) {
    console.error("Get customer orders error:", error);
    res.status(500).json({
      message: error.message || "Failed to fetch orders",
      error: true,
      success: false,
    });
  }
};

/**
 * Get Single Order Request (Customer)
 */
export const getCustomerOrderRequestById = async (req, res) => {
  try {
    const userId = req.userId;
    const { orderId } = req.params;

    const order = await OrderRequestModel.findOne({
      _id: orderId,
      user: userId,
    })
      .populate({
        path: "items.product",
        select: "name slug image btbPrice sku category brand weight",
        populate: [
          { path: "category", select: "name" },
          { path: "brand", select: "name" },
        ],
      })
      .populate("shippingAddress")
      .populate("billingAddress")
      .populate("customer")
      .populate("assignedTo", "name email mobile")
      .populate("processedBy", "name email");

    if (!order) {
      return res.status(404).json({
        message: "Order not found",
        error: true,
        success: false,
      });
    }

    res.status(200).json({
      message: "Order fetched successfully",
      error: false,
      success: true,
      data: order,
    });
  } catch (error) {
    console.error("Get order by ID error:", error);
    res.status(500).json({
      message: error.message || "Failed to fetch order",
      error: true,
      success: false,
    });
  }
};

/**
 * Cancel Order Request (Customer)
 */
export const cancelOrderRequest = async (req, res) => {
  try {
    const userId = req.userId;
    const { orderId } = req.params;
    const { reason } = req.body;

    const order = await OrderRequestModel.findOne({
      _id: orderId,
      user: userId,
    });

    if (!order) {
      return res.status(404).json({
        message: "Order not found",
        error: true,
        success: false,
      });
    }

    // Only allow cancellation for certain statuses
    const cancellableStatuses = ["PENDING", "ATTENDING_TO"];
    if (!cancellableStatuses.includes(order.status)) {
      return res.status(400).json({
        message: `Cannot cancel order with status: ${order.status}`,
        error: true,
        success: false,
      });
    }

    order.status = "CANCELLED";
    order.customerNotes = `${order.customerNotes}\n\nCancellation reason: ${reason || "No reason provided"}`;
    order.statusHistory.push({
      status: "CANCELLED",
      updatedBy: userId,
      notes: `Customer cancelled: ${reason || "No reason provided"}`,
    });

    await order.save();

    // Notify sales team
    if (order.assignedTo) {
      await sendOrderCancellationNotification(order);
    }

    res.status(200).json({
      message: "Order cancelled successfully",
      error: false,
      success: true,
      data: order,
    });
  } catch (error) {
    console.error("Cancel order error:", error);
    res.status(500).json({
      message: error.message || "Failed to cancel order",
      error: true,
      success: false,
    });
  }
};

// ==========================================
// ADMIN/SALES CONTROLLERS
// ==========================================

/**
 * Get All Order Requests (Admin/Sales)
 */
export const getAllOrderRequests = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      orderMode,
      search,
      startDate,
      endDate,
      assignedTo,
    } = req.query;

    // Build query
    const query = {};

    if (status) {
      query.status = status;
    }

    if (orderMode) {
      query.orderMode = orderMode;
    }

    if (assignedTo) {
      query.assignedTo = assignedTo;
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    if (search) {
      query.$or = [
        { orderNumber: { $regex: search, $options: "i" } },
        { customerNotes: { $regex: search, $options: "i" } },
      ];
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { createdAt: -1 },
      populate: [
        {
          path: "customer",
          select: "name email mobile companyName customerType",
        },
        {
          path: "user",
          select: "name email",
        },
        {
          path: "items.product",
          select: "name slug image btbPrice sku",
        },
        {
          path: "shippingAddress",
          select: "address_line city state lga mobile",
        },
        {
          path: "assignedTo",
          select: "name email",
        },
        {
          path: "processedBy",
          select: "name email",
        },
      ],
    };

    const orders = await OrderRequestModel.paginate(query, options);

    // Calculate summary statistics
    const summary = await OrderRequestModel.aggregate([
      { $match: query },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$totalAmount" },
        },
      },
    ]);

    res.status(200).json({
      message: "Orders fetched successfully",
      error: false,
      success: true,
      data: orders,
      summary,
    });
  } catch (error) {
    console.error("Get all orders error:", error);
    res.status(500).json({
      message: error.message || "Failed to fetch orders",
      error: true,
      success: false,
    });
  }
};

/**
 * Get Single Order Request (Admin/Sales)
 */
export const getOrderRequestById = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await OrderRequestModel.findById(orderId)
      .populate({
        path: "items.product",
        select: "name slug image btbPrice sku category brand weight unit",
        populate: [
          { path: "category", select: "name" },
          { path: "brand", select: "name" },
        ],
      })
      .populate("shippingAddress")
      .populate("billingAddress")
      .populate("customer")
      .populate("user", "name email mobile")
      .populate("assignedTo", "name email mobile")
      .populate("processedBy", "name email")
      .populate("statusHistory.updatedBy", "name email");

    if (!order) {
      return res.status(404).json({
        message: "Order not found",
        error: true,
        success: false,
      });
    }

    res.status(200).json({
      message: "Order fetched successfully",
      error: false,
      success: true,
      data: order,
    });
  } catch (error) {
    console.error("Get order by ID error:", error);
    res.status(500).json({
      message: error.message || "Failed to fetch order",
      error: true,
      success: false,
    });
  }
};

/**
 * Assign Order to Sales Person
 */
export const assignOrderRequest = async (req, res) => {
  try {
    const userId = req.userId;
    const { orderId } = req.params;
    const { assignedToId } = req.body;

    const order = await OrderRequestModel.findById(orderId);

    if (!order) {
      return res.status(404).json({
        message: "Order not found",
        error: true,
        success: false,
      });
    }

    // Verify assigned user is SALES or MANAGER
    const assignedUser = await UserModel.findById(assignedToId);
    if (!assignedUser || !["SALES", "MANAGER"].includes(assignedUser.subRole)) {
      return res.status(400).json({
        message: "Can only assign to SALES or MANAGER users",
        error: true,
        success: false,
      });
    }

    order.assignedTo = assignedToId;
    order.statusHistory.push({
      status: order.status,
      updatedBy: userId,
      notes: `Order assigned to ${assignedUser.name}`,
    });

    await order.save();

    // Send notification to assigned user
    await sendOrderAssignmentNotification(order, assignedUser);

    res.status(200).json({
      message: "Order assigned successfully",
      error: false,
      success: true,
      data: order,
    });
  } catch (error) {
    console.error("Assign order error:", error);
    res.status(500).json({
      message: error.message || "Failed to assign order",
      error: true,
      success: false,
    });
  }
};

/**
 * Update Order Status (Sales/Manager)
 */
export const updateOrderStatus = async (req, res) => {
  try {
    const userId = req.userId;
    const { orderId } = req.params;
    const { status, notes, estimatedDeliveryDate } = req.body;

    const validStatuses = [
      "PENDING",
      "ATTENDING_TO",
      "PROCESSING",
      "CONFIRMED",
      "PREPARING",
      "READY_FOR_PICKUP",
      "IN_TRANSIT",
      "DELIVERED",
      "CANCELLED",
      "REJECTED",
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        message: "Invalid status",
        error: true,
        success: false,
      });
    }

    const order = await OrderRequestModel.findById(orderId)
      .populate("customer")
      .populate("user", "email name");

    if (!order) {
      return res.status(404).json({
        message: "Order not found",
        error: true,
        success: false,
      });
    }

    const oldStatus = order.status;
    order.status = status;
    order.processedBy = userId;

    if (notes) {
      order.internalNotes = `${order.internalNotes}\n\n[${new Date().toISOString()}] ${notes}`;
    }

    if (estimatedDeliveryDate) {
      order.estimatedDeliveryDate = new Date(estimatedDeliveryDate);
    }

    if (status === "DELIVERED") {
      order.actualDeliveryDate = new Date();
    }

    order.statusHistory.push({
      status: status,
      updatedBy: userId,
      notes: notes || `Status changed from ${oldStatus} to ${status}`,
    });

    await order.save();

    // Send status update notification to customer
    await sendOrderStatusUpdateNotification(order);

    res.status(200).json({
      message: "Order status updated successfully",
      error: false,
      success: true,
      data: order,
    });
  } catch (error) {
    console.error("Update order status error:", error);
    res.status(500).json({
      message: error.message || "Failed to update order status",
      error: true,
      success: false,
    });
  }
};

/**
 * Process Order (Apply Discounts, Update Items)
 */
export const processOrderRequest = async (req, res) => {
  try {
    const userId = req.userId;
    const { orderId } = req.params;
    const { items, couponCode, shippingCost, paymentMethod, internalNotes } =
      req.body;

    const order =
      await OrderRequestModel.findById(orderId).populate("items.product");

    if (!order) {
      return res.status(404).json({
        message: "Order not found",
        error: true,
        success: false,
      });
    }

    // Only allow processing for certain statuses
    const processableStatuses = ["PENDING", "ATTENDING_TO", "PROCESSING"];
    if (!processableStatuses.includes(order.status)) {
      return res.status(400).json({
        message: `Cannot process order with status: ${order.status}`,
        error: true,
        success: false,
      });
    }

    // Update items if provided
    if (items && items.length > 0) {
      const updatedItems = [];
      let subtotal = 0;

      for (const item of items) {
        const product = await ProductModel.findById(item.productId);

        if (!product) {
          return res.status(404).json({
            message: `Product ${item.productId} not found`,
            error: true,
            success: false,
          });
        }

        const btbPrice = product.btbPrice || 0;
        const discount = item.discount || 0;
        const discountType = item.discountType || "PERCENTAGE";

        let finalPrice = btbPrice;
        if (discountType === "PERCENTAGE") {
          finalPrice = btbPrice - (btbPrice * discount) / 100;
        } else {
          finalPrice = btbPrice - discount;
        }

        const itemSubtotal = finalPrice * item.quantity;

        updatedItems.push({
          product: product._id,
          quantity: item.quantity,
          btbPrice: btbPrice,
          discount: discount,
          discountType: discountType,
          finalPrice: finalPrice,
          subtotal: itemSubtotal,
        });

        subtotal += itemSubtotal;
      }

      order.items = updatedItems;
      order.subtotal = subtotal;
    }

    // Apply new coupon if provided
    if (couponCode) {
      const coupon = await CouponModel.findOne({
        code: couponCode.toUpperCase(),
      });

      if (coupon && coupon.isValid()) {
        if (coupon.minOrderAmount && order.subtotal < coupon.minOrderAmount) {
          return res.status(400).json({
            message: `Minimum order amount for this coupon is ₦${coupon.minOrderAmount.toLocaleString()}`,
            error: true,
            success: false,
          });
        }

        let couponDiscount = 0;
        if (coupon.discountType === "PERCENTAGE") {
          couponDiscount = (order.subtotal * coupon.discountValue) / 100;
          if (
            coupon.maxDiscountAmount &&
            couponDiscount > coupon.maxDiscountAmount
          ) {
            couponDiscount = coupon.maxDiscountAmount;
          }
        } else {
          couponDiscount = coupon.discountValue;
        }

        order.couponCode = coupon.code;
        order.couponDiscount = couponDiscount;

        // Update coupon usage
        coupon.usageCount += 1;
        await coupon.save();
      }
    }

    // Update shipping cost if provided
    if (shippingCost !== undefined) {
      order.shippingCost = shippingCost;
    }

    // Update payment method if provided
    if (paymentMethod) {
      order.paymentMethod = paymentMethod;
    }

    // Add internal notes
    if (internalNotes) {
      order.internalNotes = `${order.internalNotes}\n\n[${new Date().toISOString()}] ${internalNotes}`;
    }

    // Recalculate totals
    order.totalDiscount =
      order.items.reduce((sum, item) => {
        const discount =
          item.discountType === "PERCENTAGE"
            ? (item.btbPrice * item.quantity * item.discount) / 100
            : item.discount * item.quantity;
        return sum + discount;
      }, 0) + (order.couponDiscount || 0);

    order.totalAmount =
      order.subtotal - order.totalDiscount + order.shippingCost;

    // Update status to PROCESSING if it was PENDING
    if (order.status === "PENDING") {
      order.status = "PROCESSING";
    }

    order.processedBy = userId;

    order.statusHistory.push({
      status: order.status,
      updatedBy: userId,
      notes: "Order processed and updated by sales team",
    });

    await order.save();

    // Populate for response
    const populatedOrder = await OrderRequestModel.findById(order._id)
      .populate("items.product")
      .populate("customer")
      .populate("shippingAddress")
      .populate("assignedTo", "name email")
      .populate("processedBy", "name email");

    res.status(200).json({
      message: "Order processed successfully",
      error: false,
      success: true,
      data: populatedOrder,
    });
  } catch (error) {
    console.error("Process order error:", error);
    res.status(500).json({
      message: error.message || "Failed to process order",
      error: true,
      success: false,
    });
  }
};

/**
 * Mark Product as BTB Product
 */
export const markProductAsBTB = async (req, res) => {
  try {
    const { productId } = req.params;
    const { btbProduct, btbPrice } = req.body;

    const product = await ProductModel.findById(productId);

    if (!product) {
      return res.status(404).json({
        message: "Product not found",
        error: true,
        success: false,
      });
    }

    if (btbProduct !== undefined) {
      product.btbProduct = btbProduct;
    }

    if (btbPrice !== undefined) {
      product.btbPrice = btbPrice;
    }

    await product.save();

    res.status(200).json({
      message: "Product updated successfully",
      error: false,
      success: true,
      data: product,
    });
  } catch (error) {
    console.error("Mark product as BTB error:", error);
    res.status(500).json({
      message: error.message || "Failed to update product",
      error: true,
      success: false,
    });
  }
};

/**
 * Get Order Statistics
 */
export const getOrderStatistics = async (req, res) => {
  try {
    const { startDate, endDate, assignedTo } = req.query;

    const matchQuery = {};

    if (startDate || endDate) {
      matchQuery.createdAt = {};
      if (startDate) matchQuery.createdAt.$gte = new Date(startDate);
      if (endDate) matchQuery.createdAt.$lte = new Date(endDate);
    }

    if (assignedTo) {
      matchQuery.assignedTo = mongoose.Types.ObjectId(assignedTo);
    }

    const statistics = await OrderRequestModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$totalAmount" },
          totalDiscount: { $sum: "$totalDiscount" },
        },
      },
    ]);

    const totalOrders = await OrderRequestModel.countDocuments(matchQuery);
    const totalRevenue = await OrderRequestModel.aggregate([
      { $match: matchQuery },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]);

    res.status(200).json({
      message: "Statistics fetched successfully",
      error: false,
      success: true,
      data: {
        statistics,
        totalOrders,
        totalRevenue: totalRevenue[0]?.total || 0,
      },
    });
  } catch (error) {
    console.error("Get statistics error:", error);
    res.status(500).json({
      message: error.message || "Failed to fetch statistics",
      error: true,
      success: false,
    });
  }
};
