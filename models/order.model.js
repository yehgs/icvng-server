// models/order.model.js - 
import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema(
  {
    // ===== UNIFIED IDENTIFIERS =====
    orderId: {
      type: String,
      required: [true, 'Provide orderId'],
      unique: true,
      index: true,
    },

    // ===== NEW: ORDER GROUPING SYSTEM =====
    // Groups multiple product orders from same checkout into one transaction
    orderGroupId: {
      type: String,
      required: true,
      index: true,
      // Same for all items from same checkout session
      // Example: "GRP-1234567890-user123"
    },
    isParentOrder: {
      type: Boolean,
      default: false,
      index: true,
      // First order in group is parent (holds main transaction details)
    },
    parentOrderId: {
      type: String,
      default: null,
      index: true,
      // References the parent order's orderId
      // Null for parent order, set for child orders
    },
    orderSequence: {
      type: Number,
      default: 1,
      // 1 for parent, 2,3,4... for children
      // Helps maintain order within group
    },
    totalItemsInGroup: {
      type: Number,
      default: 1,
      // Total number of product orders in this group
      // Same value across all orders in group
    },

    // ===== CUSTOMER REFERENCES (UNIFIED) =====
    // For website orders - references User model
    userId: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: function () {
        return this.isWebsiteOrder === true;
      },
    },

    // For manual orders - references Customer model
    customerId: {
      type: mongoose.Schema.ObjectId,
      ref: 'Customer',
      required: function () {
        return this.isWebsiteOrder === false;
      },
    },

    // ===== ORDER CLASSIFICATION =====
    orderType: {
      type: String,
      enum: ['BTC', 'BTB'],
      required: [true, 'Order type is required'],
      index: true,
    },
    orderMode: {
      type: String,
      enum: ['ONLINE', 'OFFLINE'],
      required: [true, 'Order mode is required'],
      index: true,
    },
    isWebsiteOrder: {
      type: Boolean,
      default: false,
      index: true,
    },

    // ===== PRODUCT DETAILS =====
    productId: {
      type: mongoose.Schema.ObjectId,
      ref: 'Product',
      required: true,
    },
    product_details: {
      name: String,
      image: Array,
      priceOption: {
        type: String,
        enum: ['regular', '3weeks', '5weeks'],
        default: 'regular',
      },
      deliveryTime: String,
    },
    quantity: {
      type: Number,
      default: 1,
      min: 1,
    },
    unitPrice: {
      type: Number,
      required: true,
    },

    // ===== PRICING =====
    subTotalAmt: {
      type: Number,
      required: true,
    },
    discount_amount: {
      type: Number,
      default: 0,
    },
    tax_amount: {
      type: Number,
      default: 0,
    },
    shipping_cost: {
      type: Number,
      default: 0,
    },
    totalAmt: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      enum: ['NGN', 'USD', 'EUR', 'GBP'],
      default: 'NGN',
    },

    // ===== GROUP TOTALS (stored in parent order) =====
    // These represent the ENTIRE checkout transaction
    groupTotals: {
      subTotal: { type: Number, default: 0 },
      totalShipping: { type: Number, default: 0 },
      totalDiscount: { type: Number, default: 0 },
      totalTax: { type: Number, default: 0 },
      grandTotal: { type: Number, default: 0 },
      itemCount: { type: Number, default: 0 },
    },

    // ===== EXCHANGE RATE INFO =====
    exchangeRateUsed: {
      rate: { type: Number, default: 1 },
      fromCurrency: { type: String, default: 'NGN' },
      toCurrency: { type: String, default: 'NGN' },
      rateSource: {
        type: String,
        enum: ['manual', 'system'],
        default: 'manual',
      },
      appliedAt: { type: Date, default: Date.now },
    },
    amountsInNGN: {
      subtotal: { type: Number, default: 0 },
      shipping: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },

    // ===== PAYMENT =====
    paymentId: {
      type: String,
      default: '',
      index: true,
      // Same for all orders in a group (shared transaction)
    },
    payment_status: {
      type: String,
      enum: [
        'PENDING',
        'PAID',
        'FAILED',
        'REFUNDED',
        'PENDING_BANK_TRANSFER',
        'PARTIAL',
      ],
      default: 'PENDING',
      index: true,
    },
    payment_method: {
      type: String,
      enum: ['STRIPE', 'PAYSTACK', 'BANK_TRANSFER', 'CASH', 'CARD', 'ONLINE'],
      default: 'CASH',
      index: true,
    },

    // Bank transfer details (for website orders)
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

    // ===== ORDER STATUS =====
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
      index: true,
    },

    // ===== DELIVERY =====
    delivery_address: {
      type: mongoose.Schema.ObjectId,
      ref: 'address',
    },
    // For manual orders without address model reference
    deliveryAddress: {
      street: String,
      city: String,
      state: String,
      lga: String,
      country: { type: String, default: 'Nigeria' },
      postalCode: String,
    },

    // ===== SHIPPING INTEGRATION =====
    shippingMethod: {
      type: mongoose.Schema.ObjectId,
      ref: 'ShippingMethod',
    },
    shippingZone: {
      type: mongoose.Schema.ObjectId,
      ref: 'ShippingZone',
    },
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
    },
    tracking_number: {
      type: String,
      default: '',
      index: true,
    },
    estimated_delivery: Date,
    actual_delivery: Date,

    // ===== CREATED BY (for manual orders) =====
    createdBy: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: function () {
        return this.isWebsiteOrder === false;
      },
      index: true,
    },

    // ===== INVOICE =====
    invoiceGenerated: {
      type: Boolean,
      default: false,
    },
    invoiceNumber: {
      type: String,
      unique: true,
      sparse: true,
    },
    invoiceDate: Date,
    invoice_receipt: {
      type: String,
      default: '',
    },

    // ===== NOTES =====
    notes: {
      type: String,
      default: '',
    },
    customer_notes: {
      type: String,
      default: '',
    },
    admin_notes: {
      type: String,
      default: '',
    },

    // ===== CANCELLATION/REFUND =====
    cancellation_reason: String,
    cancelled_at: Date,
    cancelled_by: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
    },
    refund_amount: {
      type: Number,
      default: 0,
    },
    refund_status: {
      type: String,
      enum: ['NONE', 'PENDING', 'PROCESSED', 'FAILED'],
      default: 'NONE',
    },
  },
  {
    timestamps: true,
  }
);

// ===== INDEXES =====
orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ customerId: 1, createdAt: -1 });
orderSchema.index({ orderId: 1 });
orderSchema.index({ payment_status: 1 });
orderSchema.index({ order_status: 1 });
orderSchema.index({ isWebsiteOrder: 1 });
orderSchema.index({ orderType: 1, orderMode: 1 });
orderSchema.index({ createdBy: 1 });
orderSchema.index({ createdAt: -1 });
// NEW: Indexes for order grouping
orderSchema.index({ orderGroupId: 1, orderSequence: 1 });
orderSchema.index({ isParentOrder: 1, orderGroupId: 1 });
orderSchema.index({ parentOrderId: 1 });
orderSchema.index({ paymentId: 1 });

// ===== PRE-SAVE MIDDLEWARE =====
orderSchema.pre('save', function (next) {
  // Generate invoice number if needed
  if (this.invoiceGenerated && !this.invoiceNumber) {
    this.invoiceNumber = `INV-${Date.now()}-${this.orderId}`;
    this.invoiceDate = new Date();
  }

  // Set estimated delivery
  if (this.isNew && !this.estimated_delivery && !this.shippingMethod) {
    const deliveryDays = {
      regular: 3,
      '3weeks': 21,
      '5weeks': 35,
    };
    const days = deliveryDays[this.product_details?.priceOption] || 3;
    this.estimated_delivery = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  next();
});

// ===== VIRTUALS =====
orderSchema.virtual('customerReference').get(function () {
  return this.isWebsiteOrder ? 'userId' : 'customerId';
});

orderSchema.virtual('totalItems').get(function () {
  return this.quantity;
});

// ===== STATIC METHODS =====

// NEW: Get all orders in a group
orderSchema.statics.getOrderGroup = async function (orderGroupId) {
  const orders = await this.find({ orderGroupId })
    .populate('userId', 'name email mobile')
    .populate('customerId', 'name email mobile companyName customerType')
    .populate('productId', 'name image')
    .populate('createdBy', 'name email subRole')
    .populate('delivery_address')
    .populate('shippingMethod', 'name type')
    .sort({ orderSequence: 1 });

  return orders;
};

// NEW: Get parent order for a group
orderSchema.statics.getParentOrder = async function (orderGroupId) {
  return await this.findOne({ orderGroupId, isParentOrder: true })
    .populate('userId', 'name email mobile')
    .populate('customerId', 'name email mobile companyName customerType')
    .populate('delivery_address')
    .populate('shippingMethod', 'name type');
};

// NEW: Get child orders for a group
orderSchema.statics.getChildOrders = async function (orderGroupId) {
  return await this.find({ orderGroupId, isParentOrder: false })
    .populate('productId', 'name image')
    .sort({ orderSequence: 1 });
};

// NEW: Get grouped orders for user (website orders)
orderSchema.statics.getGroupedOrdersForUser = async function (
  userId,
  options = {}
) {
  const { page = 1, limit = 10 } = options;
  const skip = (page - 1) * limit;

  // Get unique order groups for this user
  const orderGroups = await this.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        isWebsiteOrder: true,
      },
    },
    {
      $group: {
        _id: '$orderGroupId',
        parentOrderId: { $first: '$parentOrderId' },
        createdAt: { $first: '$createdAt' },
        totalItemsInGroup: { $first: '$totalItemsInGroup' },
        payment_status: { $first: '$payment_status' },
        order_status: { $min: '$order_status' }, // Get worst status in group
        groupTotals: { $first: '$groupTotals' },
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: limit },
  ]);

  // For each group, get all orders
  const groupedOrders = await Promise.all(
    orderGroups.map(async (group) => {
      const orders = await this.getOrderGroup(group._id);
      const parentOrder = orders.find((o) => o.isParentOrder);

      return {
        orderGroupId: group._id,
        parentOrder,
        childOrders: orders.filter((o) => !o.isParentOrder),
        allOrders: orders,
        summary: {
          totalItems: group.totalItemsInGroup,
          createdAt: group.createdAt,
          payment_status: group.payment_status,
          order_status: group.order_status,
          totals: group.groupTotals,
        },
      };
    })
  );

  // Get total count of groups
  const totalGroups = await this.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        isWebsiteOrder: true,
      },
    },
    {
      $group: {
        _id: '$orderGroupId',
      },
    },
    {
      $count: 'total',
    },
  ]);

  return {
    groups: groupedOrders,
    totalGroups: totalGroups[0]?.total || 0,
    page,
    totalPages: Math.ceil((totalGroups[0]?.total || 0) / limit),
  };
};

// Get orders with unified customer population
orderSchema.statics.getOrdersWithCustomer = async function (filters = {}) {
  const orders = await this.find(filters)
    .populate('userId', 'name email mobile')
    .populate('customerId', 'name email mobile companyName customerType')
    .populate('productId', 'name image')
    .populate('createdBy', 'name email subRole')
    .populate('delivery_address')
    .populate('shippingMethod', 'name type')
    .sort({ createdAt: -1 });

  return orders.map((order) => {
    const orderObj = order.toObject();
    // Unified customer info
    orderObj.customer = order.isWebsiteOrder ? order.userId : order.customerId;
    return orderObj;
  });
};

// Get order stats (works for both systems)
orderSchema.statics.getOrderStats = async function (filters = {}) {
  const stats = await this.aggregate([
    { $match: filters },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalAmount: { $sum: '$totalAmt' },
        avgOrderValue: { $avg: '$totalAmt' },
        pendingOrders: {
          $sum: { $cond: [{ $eq: ['$order_status', 'PENDING'] }, 1, 0] },
        },
        completedOrders: {
          $sum: { $cond: [{ $eq: ['$order_status', 'DELIVERED'] }, 1, 0] },
        },
        paidOrders: {
          $sum: { $cond: [{ $eq: ['$payment_status', 'PAID'] }, 1, 0] },
        },
        websiteOrders: {
          $sum: { $cond: ['$isWebsiteOrder', 1, 0] },
        },
        manualOrders: {
          $sum: { $cond: [{ $not: '$isWebsiteOrder' }, 1, 0] },
        },
      },
    },
  ]);

  return (
    stats[0] || {
      totalOrders: 0,
      totalAmount: 0,
      avgOrderValue: 0,
      pendingOrders: 0,
      completedOrders: 0,
      paidOrders: 0,
      websiteOrders: 0,
      manualOrders: 0,
    }
  );
};

const OrderModel = mongoose.model('order', orderSchema);

export default OrderModel;
