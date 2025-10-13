// models/order.model.js - Updated with shipping integration
import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
    },
    orderId: {
      type: String,
      required: [true, 'Provide orderId'],
      unique: true,
    },
    productId: {
      type: mongoose.Schema.ObjectId,
      ref: 'product',
    },
    product_details: {
      name: String,
      image: Array,
      priceOption: {
        type: String,
        enum: ['regular', '3weeks', '5weeks'],
        default: 'regular',
      },
      deliveryTime: {
        type: String,
        default: 'regular',
      },
    },
    quantity: {
      type: Number,
      default: 1,
      min: 1,
    },
    unitPrice: {
      type: Number,
      default: 0,
    },
    paymentId: {
      type: String,
      default: '',
    },
    payment_status: {
      type: String,
      enum: ['PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PENDING_BANK_TRANSFER'],
      default: 'PENDING',
    },
    payment_method: {
      type: String,
      enum: ['STRIPE', 'PAYSTACK', 'BANK_TRANSFER'],
      default: 'STRIPE',
    },
    delivery_address: {
      type: mongoose.Schema.ObjectId,
      ref: 'address',
    },
    subTotalAmt: {
      type: Number,
      default: 0,
    },
    totalAmt: {
      type: Number,
      default: 0,
    },
    currency: {
      type: String,
      enum: ['NGN', 'USD', 'EUR', 'GBP'],
      default: 'NGN',
    },
    exchangeRate: {
      type: Number,
      default: 1,
    },
    originalAmount: {
      type: Number,
    },
    order_status: {
      type: String,
      enum: [
        'PENDING',
        'CONFIRMED',
        'PROCESSING',
        'SHIPPED',
        'DELIVERED',
        'CANCELLED',
        'RETURNED',
      ],
      default: 'PENDING',
    },

    // ===== SHIPPING INTEGRATION =====

    // Shipping method used for this order
    shippingMethod: {
      type: mongoose.Schema.ObjectId,
      ref: 'ShippingMethod',
    },

    // Shipping zone determined by delivery address
    shippingZone: {
      type: mongoose.Schema.ObjectId,
      ref: 'ShippingZone',
    },

    // Calculated shipping cost
    shipping_cost: {
      type: Number,
      default: 0,
    },

    // Shipping details
    shipping_details: {
      method_name: String,
      method_type: String,
      carrier: {
        name: String,
        code: String,
      },
      estimated_delivery_days: {
        min: Number,
        max: Number,
      },
      pickup_location: {
        name: String,
        address: String,
        city: String,
        state: String,
        phone: String,
      },
      delivery_instructions: String,
      weight: Number,
      dimensions: {
        length: Number,
        width: Number,
        height: Number,
        unit: String,
      },
    },

    // ===== EXISTING TRACKING FIELDS (Enhanced) =====

    tracking_number: {
      type: String,
      default: '',
      index: true,
    },
    estimated_delivery: {
      type: Date,
    },
    actual_delivery: {
      type: Date,
    },
    delivery_notes: {
      type: String,
      default: '',
    },

    // ===== EXISTING FIELDS =====

    invoice_receipt: {
      type: String,
      default: '',
    },
    discount_amount: {
      type: Number,
      default: 0,
    },
    discount_percentage: {
      type: Number,
      default: 0,
    },
    tax_amount: {
      type: Number,
      default: 0,
    },
    tax_percentage: {
      type: Number,
      default: 0,
    },
    cancellation_reason: {
      type: String,
      default: '',
    },
    cancelled_at: {
      type: Date,
    },
    cancelled_by: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
    },
    refund_amount: {
      type: Number,
      default: 0,
    },
    isWebsiteOrder: {
      type: Boolean,
      default: false,
    },
    refund_status: {
      type: String,
      enum: ['NONE', 'PENDING', 'PROCESSED', 'FAILED'],
      default: 'NONE',
    },
    refund_processed_at: {
      type: Date,
    },

    bank_transfer_details: {
      bankName: String,
      accountName: String,
      accountNumber: String,
      sortCode: String,
      reference: String,
    },
    bank_transfer_status: {
      type: String,
      enum: ['PENDING', 'VERIFIED', 'FAILED'],
      default: 'PENDING',
    },
    bank_transfer_verified_at: {
      type: Date,
    },
    bank_transfer_verified_by: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
    },
    admin_notes: {
      type: String,
      default: '',
    },
    customer_notes: {
      type: String,
      default: '',
    },
    currency: {
      type: String,
      enum: ['NGN', 'USD', 'EUR', 'GBP'],
      default: 'NGN',
    },

    // ✅ NEW: Store the exchange rate used at time of order
    exchangeRateUsed: {
      rate: {
        type: Number,
        default: 1,
      },
      fromCurrency: {
        type: String,
        default: 'NGN',
      },
      toCurrency: {
        type: String,
        default: 'NGN',
      },
      rateSource: {
        type: String,
        enum: ['manual', 'system'],
        default: 'manual',
      },
      appliedAt: {
        type: Date,
        default: Date.now,
      },
    },

    // ✅ Store original NGN amounts for reference
    amountsInNGN: {
      subtotal: {
        type: Number,
        default: 0,
      },
      shipping: {
        type: Number,
        default: 0,
      },
      total: {
        type: Number,
        default: 0,
      },
    },

    // These are the converted amounts (what customer actually pays)
    subTotalAmt: {
      type: Number,
      default: 0,
    },
    shipping_cost: {
      type: Number,
      default: 0,
    },
    totalAmt: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Existing indexes
orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ orderId: 1 });
orderSchema.index({ payment_status: 1 });
orderSchema.index({ order_status: 1 });
orderSchema.index({ productId: 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ payment_method: 1 });
orderSchema.index({ bank_transfer_status: 1 });

// New shipping-related indexes
orderSchema.index({ shippingMethod: 1 });
orderSchema.index({ shippingZone: 1 });
orderSchema.index({ tracking_number: 1 });
orderSchema.index({ estimated_delivery: 1 });
orderSchema.index({ actual_delivery: 1 });

// Existing virtuals
orderSchema.virtual('formattedOrderDate').get(function () {
  return this.createdAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
});

orderSchema.virtual('orderAgeInDays').get(function () {
  const now = new Date();
  const orderDate = new Date(this.createdAt);
  const diffTime = Math.abs(now - orderDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
});

orderSchema.virtual('deliveryStatus').get(function () {
  if (this.actual_delivery) {
    return 'DELIVERED';
  } else if (this.order_status === 'SHIPPED') {
    return 'IN_TRANSIT';
  } else if (this.order_status === 'PROCESSING') {
    return 'PREPARING';
  } else if (this.order_status === 'CONFIRMED') {
    return 'CONFIRMED';
  } else {
    return 'PENDING';
  }
});

// New shipping-related virtuals
orderSchema.virtual('hasTracking').get(function () {
  return Boolean(this.tracking_number);
});

orderSchema.virtual('isOverdue').get(function () {
  if (!this.estimated_delivery || this.actual_delivery) return false;
  return new Date() > this.estimated_delivery;
});

orderSchema.virtual('daysToDelivery').get(function () {
  if (this.actual_delivery) return 0;
  if (!this.estimated_delivery) return null;

  const now = new Date();
  const delivery = new Date(this.estimated_delivery);
  const diffTime = delivery - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
});

orderSchema.virtual('totalOrderValue').get(function () {
  return (
    this.subTotalAmt +
    this.shipping_cost +
    this.tax_amount -
    this.discount_amount
  );
});

// Enhanced pre-save middleware
orderSchema.pre('save', function (next) {
  // Existing logic for estimated delivery based on price option
  if (this.isNew && !this.estimated_delivery && !this.shippingMethod) {
    const deliveryDays = {
      regular: 3,
      '3weeks': 21,
      '5weeks': 35,
    };

    const days = deliveryDays[this.product_details?.priceOption] || 3;
    this.estimated_delivery = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  // Set original amount in NGN if currency is different
  if (this.currency !== 'NGN' && !this.originalAmount) {
    this.originalAmount = this.totalAmt;
  }

  next();
});

// Enhanced static methods
orderSchema.statics.getOrderStats = async function (userId = null) {
  const matchStage = userId
    ? { userId: new mongoose.Types.ObjectId(userId) }
    : {};

  const stats = await this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalAmount: { $sum: '$totalAmt' },
        totalShippingCost: { $sum: '$shipping_cost' },
        avgOrderValue: { $avg: '$totalAmt' },
        pendingOrders: {
          $sum: { $cond: [{ $eq: ['$order_status', 'PENDING'] }, 1, 0] },
        },
        processingOrders: {
          $sum: { $cond: [{ $eq: ['$order_status', 'PROCESSING'] }, 1, 0] },
        },
        shippedOrders: {
          $sum: { $cond: [{ $eq: ['$order_status', 'SHIPPED'] }, 1, 0] },
        },
        completedOrders: {
          $sum: { $cond: [{ $eq: ['$order_status', 'DELIVERED'] }, 1, 0] },
        },
        cancelledOrders: {
          $sum: { $cond: [{ $eq: ['$order_status', 'CANCELLED'] }, 1, 0] },
        },
        bankTransferOrders: {
          $sum: {
            $cond: [{ $eq: ['$payment_method', 'BANK_TRANSFER'] }, 1, 0],
          },
        },
        pendingBankTransfers: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$payment_method', 'BANK_TRANSFER'] },
                  { $eq: ['$payment_status', 'PENDING_BANK_TRANSFER'] },
                ],
              },
              1,
              0,
            ],
          },
        },
        overdueDeliveries: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $lt: ['$estimated_delivery', new Date()] },
                  {
                    $not: {
                      $in: [
                        '$order_status',
                        ['DELIVERED', 'CANCELLED', 'RETURNED'],
                      ],
                    },
                  },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

  return (
    stats[0] || {
      totalOrders: 0,
      totalAmount: 0,
      totalShippingCost: 0,
      avgOrderValue: 0,
      pendingOrders: 0,
      processingOrders: 0,
      shippedOrders: 0,
      completedOrders: 0,
      cancelledOrders: 0,
      bankTransferOrders: 0,
      pendingBankTransfers: 0,
      overdueDeliveries: 0,
    }
  );
};

// Get orders by shipping status
orderSchema.statics.getOrdersByShippingStatus = function (status) {
  const statusMapping = {
    ready_to_ship: {
      order_status: 'CONFIRMED',
      tracking_number: { $exists: false },
    },
    shipped: { order_status: 'SHIPPED', tracking_number: { $exists: true } },
    in_transit: { order_status: 'SHIPPED' },
    delivered: { order_status: 'DELIVERED' },
    overdue: {
      estimated_delivery: { $lt: new Date() },
      order_status: { $nin: ['DELIVERED', 'CANCELLED', 'RETURNED'] },
    },
  };

  const query = statusMapping[status] || {};

  return this.find(query)
    .populate('delivery_address')
    .populate('userId', 'name email mobile')
    .populate('shippingMethod', 'name type')
    .populate('shippingZone', 'name')
    .sort({ createdAt: -1 });
};

// Get orders by shipping method
orderSchema.statics.getOrdersByShippingMethod = function (
  methodId,
  startDate = null,
  endDate = null
) {
  const query = { shippingMethod: methodId };

  if (startDate && endDate) {
    query.createdAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    };
  }

  return this.find(query)
    .populate('delivery_address')
    .populate('userId', 'name email')
    .populate('shippingMethod')
    .sort({ createdAt: -1 });
};

// Get shipping analytics
orderSchema.statics.getShippingAnalytics = async function (startDate, endDate) {
  const matchStage = {
    createdAt: {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    },
    order_status: { $ne: 'CANCELLED' },
  };

  const analytics = await this.aggregate([
    { $match: matchStage },
    {
      $lookup: {
        from: 'shippingmethods',
        localField: 'shippingMethod',
        foreignField: '_id',
        as: 'method',
      },
    },
    {
      $lookup: {
        from: 'shippingzones',
        localField: 'shippingZone',
        foreignField: '_id',
        as: 'zone',
      },
    },
    {
      $group: {
        _id: {
          method: { $arrayElemAt: ['$method.name', 0] },
          zone: { $arrayElemAt: ['$zone.name', 0] },
        },
        orderCount: { $sum: 1 },
        totalShippingRevenue: { $sum: '$shipping_cost' },
        avgShippingCost: { $avg: '$shipping_cost' },
        avgDeliveryTime: {
          $avg: {
            $cond: [
              { $and: ['$actual_delivery', '$createdAt'] },
              {
                $divide: [
                  { $subtract: ['$actual_delivery', '$createdAt'] },
                  1000 * 60 * 60 * 24,
                ],
              },
              null,
            ],
          },
        },
      },
    },
    {
      $sort: { orderCount: -1 },
    },
  ]);

  return analytics;
};

// Instance method to check if order is ready for shipping
orderSchema.methods.isReadyForShipping = function () {
  return (
    this.payment_status === 'PAID' &&
    this.order_status === 'CONFIRMED' &&
    !this.tracking_number
  );
};

// Instance method to get shipping timeline
orderSchema.methods.getShippingTimeline = function () {
  const timeline = [
    {
      status: 'Order Placed',
      date: this.createdAt,
      completed: true,
    },
    {
      status: 'Payment Confirmed',
      date: this.payment_status === 'PAID' ? this.updatedAt : null,
      completed: this.payment_status === 'PAID',
    },
    {
      status: 'Processing',
      date: this.order_status === 'PROCESSING' ? this.updatedAt : null,
      completed: ['PROCESSING', 'SHIPPED', 'DELIVERED'].includes(
        this.order_status
      ),
    },
    {
      status: 'Shipped',
      date: this.order_status === 'SHIPPED' ? this.updatedAt : null,
      completed: ['SHIPPED', 'DELIVERED'].includes(this.order_status),
    },
    {
      status: 'Delivered',
      date: this.actual_delivery,
      completed: this.order_status === 'DELIVERED',
    },
  ];

  return timeline;
};

// Static method to get orders ready for shipping
orderSchema.statics.getOrdersReadyForShipping = function (filters = {}) {
  const query = {
    payment_status: 'PAID',
    order_status: { $in: ['CONFIRMED', 'PROCESSING'] },
    tracking_number: { $exists: false },
    ...filters,
  };

  return this.find(query)
    .populate('delivery_address')
    .populate('userId', 'name email mobile')
    .populate('productId', 'name image weight')
    .populate('shippingMethod', 'name type')
    .sort({ createdAt: -1 });
};

// Instance method to create shipment
orderSchema.methods.createShipment = async function (shippingData = {}) {
  const ShippingTrackingModel = mongoose.model('ShippingTracking');

  // Check if tracking already exists
  const existingTracking = await ShippingTrackingModel.findOne({
    orderId: this._id,
  });
  if (existingTracking) {
    throw new Error('Tracking already exists for this order');
  }

  const trackingData = {
    orderId: this._id,
    carrier: shippingData.carrier || {
      name: 'I-Coffee Logistics',
      code: 'ICF',
      phone: '+234-800-ICOFFEE',
      website: 'https://i-coffee.ng',
    },
    shippingMethod: this.shippingMethod,
    estimatedDelivery: this.estimated_delivery,
    packageInfo: {
      weight: shippingData.weight || 1,
      fragile: shippingData.fragile || false,
      insured: this.totalAmt > 50000,
      insuranceValue: this.totalAmt > 50000 ? this.totalAmt : 0,
    },
    shippingCost: this.shipping_cost || 0,
    priority: shippingData.priority || 'NORMAL',
    createdBy: shippingData.createdBy,
    updatedBy: shippingData.updatedBy,
  };

  const tracking = new ShippingTrackingModel(trackingData);
  const savedTracking = await tracking.save();

  // Add initial tracking event
  await savedTracking.addTrackingEvent(
    {
      status: 'PENDING',
      description: 'Order confirmed and ready for processing',
      location: {
        facility: 'I-Coffee Fulfillment Center',
        city: 'Lagos',
        state: 'Lagos',
        country: 'Nigeria',
      },
    },
    shippingData.createdBy
  );

  // Update order with tracking number
  await this.updateOne({
    tracking_number: savedTracking.trackingNumber,
    order_status: 'PROCESSING',
  });

  return savedTracking;
};

const OrderModel = mongoose.model('order', orderSchema);

export default OrderModel;
