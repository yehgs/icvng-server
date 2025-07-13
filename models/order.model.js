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
      enum: ['PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PENDING_BANK_TRANSFER'], // Added PENDING_BANK_TRANSFER
      default: 'PENDING',
    },
    payment_method: {
      type: String,
      enum: ['STRIPE', 'FLUTTERWAVE', 'BANK_TRANSFER'], // Added BANK_TRANSFER
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
    // Exchange rate at the time of order (for record keeping)
    exchangeRate: {
      type: Number,
      default: 1,
    },
    // Original amount in base currency (NGN)
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
    tracking_number: {
      type: String,
      default: '',
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
    invoice_receipt: {
      type: String,
      default: '',
    },
    // Discount information
    discount_amount: {
      type: Number,
      default: 0,
    },
    discount_percentage: {
      type: Number,
      default: 0,
    },
    // Tax information
    tax_amount: {
      type: Number,
      default: 0,
    },
    tax_percentage: {
      type: Number,
      default: 0,
    },
    // Shipping information
    shipping_cost: {
      type: Number,
      default: 0,
    },
    shipping_method: {
      type: String,
      default: 'Standard',
    },
    // Cancellation and refund info
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
    refund_status: {
      type: String,
      enum: ['NONE', 'PENDING', 'PROCESSED', 'FAILED'],
      default: 'NONE',
    },
    refund_processed_at: {
      type: Date,
    },
    // Bank transfer specific fields
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
      ref: 'User', // Admin who verified the transfer
    },
    // Admin notes
    admin_notes: {
      type: String,
      default: '',
    },
    // Customer notes
    customer_notes: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for better query performance
orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ orderId: 1 });
orderSchema.index({ payment_status: 1 });
orderSchema.index({ order_status: 1 });
orderSchema.index({ productId: 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ payment_method: 1 }); // Added index for payment method
orderSchema.index({ bank_transfer_status: 1 }); // Added index for bank transfer status

// Virtual for formatted order date
orderSchema.virtual('formattedOrderDate').get(function () {
  return this.createdAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
});

// Virtual for order age in days
orderSchema.virtual('orderAgeInDays').get(function () {
  const now = new Date();
  const orderDate = new Date(this.createdAt);
  const diffTime = Math.abs(now - orderDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
});

// Virtual for delivery status
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

// Virtual for bank transfer status display
orderSchema.virtual('bankTransferStatusDisplay').get(function () {
  if (this.payment_method !== 'BANK_TRANSFER') {
    return null;
  }

  const statusMap = {
    PENDING: 'Awaiting Transfer',
    VERIFIED: 'Transfer Verified',
    FAILED: 'Transfer Failed',
  };

  return statusMap[this.bank_transfer_status] || 'Unknown';
});

// Pre-save middleware to set estimated delivery based on price option
orderSchema.pre('save', function (next) {
  if (this.isNew && !this.estimated_delivery) {
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
    // This would be set from the controller with proper exchange rate
    this.originalAmount = this.totalAmt;
  }

  next();
});

// Static method to get order statistics
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
        avgOrderValue: { $avg: '$totalAmt' },
        pendingOrders: {
          $sum: { $cond: [{ $eq: ['$order_status', 'PENDING'] }, 1, 0] },
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
      cancelledOrders: 0,
      bankTransferOrders: 0,
      pendingBankTransfers: 0,
    }
  );
};

// Static method to get orders by date range
orderSchema.statics.getOrdersByDateRange = function (
  startDate,
  endDate,
  userId = null
) {
  const query = {
    createdAt: {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    },
  };

  if (userId) {
    query.userId = userId;
  }

  return this.find(query)
    .populate('productId delivery_address userId')
    .sort({ createdAt: -1 });
};

// Static method to get pending bank transfers (for admin)
orderSchema.statics.getPendingBankTransfers = function () {
  return this.find({
    payment_method: 'BANK_TRANSFER',
    payment_status: 'PENDING_BANK_TRANSFER',
    bank_transfer_status: 'PENDING',
  })
    .populate('userId delivery_address productId')
    .sort({ createdAt: -1 });
};

// Instance method to check if order can be cancelled
orderSchema.methods.canBeCancelled = function () {
  const cancellableStatuses = ['PENDING', 'CONFIRMED'];
  const cancellablePaymentStatuses = ['PENDING', 'PENDING_BANK_TRANSFER'];

  return (
    cancellableStatuses.includes(this.order_status) &&
    cancellablePaymentStatuses.includes(this.payment_status) &&
    this.payment_status !== 'REFUNDED'
  );
};

// Instance method to check if order can be returned
orderSchema.methods.canBeReturned = function () {
  if (this.order_status !== 'DELIVERED' || !this.actual_delivery) {
    return false;
  }

  const deliveryDate = new Date(this.actual_delivery);
  const now = new Date();
  const daysSinceDelivery = (now - deliveryDate) / (1000 * 60 * 60 * 24);

  return daysSinceDelivery <= 30; // 30-day return policy
};

// Instance method to verify bank transfer (for admin use)
orderSchema.methods.verifyBankTransfer = function (adminUserId) {
  this.bank_transfer_status = 'VERIFIED';
  this.bank_transfer_verified_at = new Date();
  this.bank_transfer_verified_by = adminUserId;
  this.payment_status = 'PAID';
  this.order_status = 'CONFIRMED';

  return this.save();
};

// Instance method to reject bank transfer (for admin use)
orderSchema.methods.rejectBankTransfer = function (adminUserId, reason) {
  this.bank_transfer_status = 'FAILED';
  this.payment_status = 'FAILED';
  this.admin_notes = `Bank transfer rejected: ${reason}`;

  return this.save();
};

const OrderModel = mongoose.model('order', orderSchema);

export default OrderModel;
