// models/admin-order.model.js - Extension to existing order model
import mongoose from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

const adminOrderSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      required: [true, 'Provide orderId'],
      unique: true,
    },
    customerId: {
      type: mongoose.Schema.ObjectId,
      ref: 'Customer',
      required: [true, 'Customer is required'],
    },
    // Product items in the order
    items: [
      {
        productId: {
          type: mongoose.Schema.ObjectId,
          ref: 'Product',
          required: true,
        },
        productName: String,
        quantity: {
          type: Number,
          required: true,
          min: 1,
        },
        unitPrice: {
          type: Number,
          required: true,
        },
        totalPrice: {
          type: Number,
          required: true,
        },
        priceOption: {
          type: String,
          enum: ['regular', '3weeks', '5weeks'],
          default: 'regular',
        },
      },
    ],

    // Order totals
    subTotal: {
      type: Number,
      required: true,
    },
    discountAmount: {
      type: Number,
      default: 0,
    },
    taxAmount: {
      type: Number,
      default: 0,
    },
    shippingCost: {
      type: Number,
      default: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
    },

    // Order classification
    orderType: {
      type: String,
      enum: ['BTC', 'BTB'],
      required: [true, 'Order type is required'],
    },
    orderMode: {
      type: String,
      enum: ['ONLINE', 'OFFLINE'],
      required: [true, 'Order mode is required'],
    },
    isWebsiteOrder: {
      type: Boolean,
      default: false,
    },

    // Payment information
    paymentStatus: {
      type: String,
      enum: ['PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PARTIAL'],
      default: 'PENDING',
    },
    paymentMethod: {
      type: String,
      enum: ['CASH', 'BANK_TRANSFER', 'CARD', 'ONLINE'],
      default: 'CASH',
    },

    // Order status
    orderStatus: {
      type: String,
      enum: [
        'PENDING',
        'CONFIRMED',
        'PROCESSING',
        'SHIPPED',
        'DELIVERED',
        'CANCELLED',
      ],
      default: 'PENDING',
    },

    // Sales agent who created the order
    createdBy: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: function () {
        return !this.isWebsiteOrder;
      },
    },

    // Invoice information
    invoiceGenerated: {
      type: Boolean,
      default: false,
    },
    invoiceNumber: {
      type: String,
      unique: true,
      sparse: true,
    },
    invoiceDate: {
      type: Date,
    },

    // Delivery information
    deliveryAddress: {
      street: String,
      city: String,
      state: String,
      country: { type: String, default: 'Nigeria' },
      postalCode: String,
    },
    deliveryDate: {
      type: Date,
    },

    // Notes and additional info
    notes: {
      type: String,
      default: '',
    },
    customerNotes: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

// Add pagination plugin
adminOrderSchema.plugin(mongoosePaginate);

// Create indexes
adminOrderSchema.index({ orderId: 1 });
adminOrderSchema.index({ customerId: 1 });
adminOrderSchema.index({ createdBy: 1 });
adminOrderSchema.index({ orderType: 1 });
adminOrderSchema.index({ orderMode: 1 });
adminOrderSchema.index({ orderStatus: 1 });
adminOrderSchema.index({ paymentStatus: 1 });
adminOrderSchema.index({ isWebsiteOrder: 1 });
adminOrderSchema.index({ createdAt: -1 });
adminOrderSchema.index({ invoiceNumber: 1 });

// Pre-save middleware to generate invoice number
adminOrderSchema.pre('save', function (next) {
  if (this.invoiceGenerated && !this.invoiceNumber) {
    this.invoiceNumber = `INV-${Date.now()}-${this.orderId}`;
    this.invoiceDate = new Date();
  }
  next();
});

// Virtual for total items count
adminOrderSchema.virtual('totalItems').get(function () {
  return this.items.reduce((total, item) => total + item.quantity, 0);
});

const AdminOrderModel = mongoose.model('AdminOrder', adminOrderSchema);

export default AdminOrderModel;
