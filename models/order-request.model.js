// models/orderRequest.model.js - UPDATED WITH SHIPPING
import mongoose from "mongoose";
import mongoosePaginate from "mongoose-paginate-v2";

const orderRequestSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      unique: true,
      required: true,
    },
    customer: {
      type: mongoose.Schema.ObjectId,
      ref: "Customer",
      required: true,
    },
    user: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: function () {
        return this.orderMode === "ONLINE";
      },
    },
    orderMode: {
      type: String,
      enum: ["ONLINE", "OFFLINE"],
      required: true,
    },
    items: [
      {
        product: {
          type: mongoose.Schema.ObjectId,
          ref: "Product",
          required: true,
        },
        quantity: {
          type: Number,
          required: true,
          min: 1,
        },
        btbPrice: {
          type: Number,
          required: true,
        },
        weight: {
          type: Number,
          default: 1,
        },
        discount: {
          type: Number,
          default: 0,
        },
        discountType: {
          type: String,
          enum: ["PERCENTAGE", "FIXED"],
          default: "PERCENTAGE",
        },
        finalPrice: {
          type: Number,
          required: true,
        },
        subtotal: {
          type: Number,
          required: true,
        },
      },
    ],
    shippingAddress: {
      type: mongoose.Schema.ObjectId,
      ref: "address",
      required: true,
    },
    billingAddress: {
      type: mongoose.Schema.ObjectId,
      ref: "address",
    },

    // ====== NEW: SHIPPING FIELDS ======
    shippingZone: {
      type: mongoose.Schema.ObjectId,
      ref: "ShippingZone",
    },
    shippingMethod: {
      type: mongoose.Schema.ObjectId,
      ref: "ShippingMethod",
      required: true,
    },
    shippingMethodDetails: {
      name: String,
      code: String,
      type: String,
    },
    totalWeight: {
      type: Number,
      default: 0,
    },
    shippingCost: {
      type: Number,
      default: 0,
      required: true,
    },
    pickupLocation: {
      name: String,
      address: String,
      city: String,
      state: String,
      lga: String,
      phone: String,
    },
    estimatedDeliveryDate: {
      type: Date,
    },
    actualDeliveryDate: {
      type: Date,
    },
    trackingNumber: {
      type: String,
      default: "",
    },
    // ====== END SHIPPING FIELDS ======

    couponCode: {
      type: String,
      default: null,
    },
    couponDiscount: {
      type: Number,
      default: 0,
    },
    subtotal: {
      type: Number,
      required: true,
    },
    totalDiscount: {
      type: Number,
      default: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: [
        "PENDING",
        "ATTENDING_TO",
        "PROCESSING",
        "CONFIRMED",
        "PREPARING",
        "READY_FOR_PICKUP",
        "READY_FOR_SHIPPING",
        "IN_TRANSIT",
        "DELIVERED",
        "CANCELLED",
        "REJECTED",
      ],
      default: "PENDING",
    },
    statusHistory: [
      {
        status: String,
        updatedBy: {
          type: mongoose.Schema.ObjectId,
          ref: "User",
        },
        updatedAt: {
          type: Date,
          default: Date.now,
        },
        notes: String,
      },
    ],
    assignedTo: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
    },
    processedBy: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
    },
    notes: {
      type: String,
      default: "",
    },
    customerNotes: {
      type: String,
      default: "",
    },
    internalNotes: {
      type: String,
      default: "",
    },
    paymentStatus: {
      type: String,
      enum: ["PENDING", "PARTIAL", "PAID", "REFUNDED"],
      default: "PENDING",
    },
    paymentMethod: {
      type: String,
      enum: ["BANK_TRANSFER", "CASH", "CARD", "PAYSTACK", "OTHER"],
      default: "BANK_TRANSFER",
    },
    invoiceGenerated: {
      type: Boolean,
      default: false,
    },
    invoiceUrl: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  },
);

// Add pagination
orderRequestSchema.plugin(mongoosePaginate);

// Indexes
orderRequestSchema.index({ customer: 1 });
orderRequestSchema.index({ user: 1 });
orderRequestSchema.index({ status: 1 });
orderRequestSchema.index({ assignedTo: 1 });
orderRequestSchema.index({ createdAt: -1 });
orderRequestSchema.index({ orderMode: 1 });
orderRequestSchema.index({ shippingZone: 1 });
orderRequestSchema.index({ trackingNumber: 1 });

// Pre-save middleware to generate order number
orderRequestSchema.pre("save", async function (next) {
  if (!this.orderNumber) {
    const count = await this.constructor.countDocuments();
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    this.orderNumber = `BTB${year}${month}${String(count + 1).padStart(5, "0")}`;
  }

  // Calculate totals
  this.subtotal = this.items.reduce((sum, item) => sum + item.subtotal, 0);
  this.totalDiscount =
    this.items.reduce((sum, item) => {
      const discount =
        item.discountType === "PERCENTAGE"
          ? (item.btbPrice * item.quantity * item.discount) / 100
          : item.discount * item.quantity;
      return sum + discount;
    }, 0) + (this.couponDiscount || 0);

  // Include shipping cost in total
  this.totalAmount =
    this.subtotal - this.totalDiscount + (this.shippingCost || 0);

  // Calculate total weight if not set
  if (!this.totalWeight) {
    this.totalWeight = this.items.reduce(
      (sum, item) => sum + item.weight * item.quantity,
      0,
    );
  }

  next();
});

// Add status to history when status changes
orderRequestSchema.pre("save", function (next) {
  if (this.isModified("status") && !this.isNew) {
    this.statusHistory.push({
      status: this.status,
      updatedBy: this.processedBy || this.assignedTo,
      notes: this.notes,
    });
  }
  next();
});

const OrderRequestModel = mongoose.model("OrderRequest", orderRequestSchema);

export default OrderRequestModel;
