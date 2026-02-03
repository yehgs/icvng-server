// models/purchaseOrder.model.js
import mongoose from "mongoose";

const purchaseOrderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
  },
  unitPrice: {
    type: Number,
    required: true,
    min: 0,
  },
  currency: {
    type: String,
    required: true,
    default: "USD",
    uppercase: true,
  },
  totalPrice: {
    type: Number,
    required: true,
    min: 0,
  },
  // For batch tracking
  expectedExpiryDate: {
    type: Date,
  },
  productionDate: {
    type: Date,
  },
  notes: {
    type: String,
    default: "",
  },
  receipts: [
    {
      url: {
        type: String,
        required: true,
      },
      name: {
        type: String,
        required: true,
      },
      type: {
        type: String,
        enum: ["image", "pdf"],
        required: true,
      },
      size: {
        type: Number,
        required: true,
      },
      uploadedAt: {
        type: Date,
        default: Date.now,
      },
      uploadedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    },
  ],
});

const statusHistorySchema = new mongoose.Schema(
  {
    previousStatus: {
      type: String,
      enum: [
        "DRAFT",
        "PENDING",
        "APPROVED",
        "DELIVERED",
        "COMPLETED",
        "CANCELLED",
      ],
    },
    newStatus: {
      type: String,
      enum: [
        "DRAFT",
        "PENDING",
        "APPROVED",
        "DELIVERED",
        "COMPLETED",
        "CANCELLED",
      ],
      required: true,
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    changedAt: {
      type: Date,
      default: Date.now,
    },
    notes: {
      type: String,
      default: "",
    },
    reason: {
      type: String,
      default: "",
    },
    userRole: {
      type: String,
      enum: ["EMPLOYEE", "IT", "DIRECTOR", "WAREHOUSE", "ADMIN"],
    },
  },
  { _id: true },
);

const purchaseOrderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
    },
    batchNumber: {
      type: String,
      required: true,
      unique: true,
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
    },
    items: [purchaseOrderItemSchema],

    // Dates
    orderDate: {
      type: Date,
      default: Date.now,
    },
    expectedDeliveryDate: {
      type: Date,
      required: true,
    },
    actualDeliveryDate: {
      type: Date,
    },

    // Status tracking
    status: {
      type: String,
      enum: [
        "DRAFT",
        "PENDING",
        "APPROVED",
        ,
        "DELIVERED",
        "CANCELLED",
        "COMPLETED",
      ],
      default: "DRAFT",
    },

    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    approvedAt: {
      type: Date,
    },
    deliveredAt: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    cancelledAt: {
      type: Date,
    },
    cancellationReason: {
      type: String,
    },

    // Financial information
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    taxAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    shippingCost: {
      type: Number,
      default: 0,
      min: 0,
    },
    discountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      required: true,
      default: "USD",
      uppercase: true,
    },

    // Exchange rate information
    exchangeRate: {
      type: Number,
      default: 1,
    },
    baseCurrency: {
      type: String,
      default: "USD",
      uppercase: true,
    },

    // Shipping information
    shippingAddress: {
      street: String,
      city: String,
      state: String,
      country: String,
      zipCode: String,
    },
    trackingNumber: {
      type: String,
      default: "",
    },

    // Terms and conditions
    paymentTerms: {
      type: String,
      default: "NET_30",
    },
    deliveryTerms: {
      type: String,
      default: "FOB",
    },

    // Logistics information
    logistics: {
      transportMode: {
        type: String,
        enum: ["AIR", "SEA", "LAND", "RAIL", "MULTIMODAL"],
        required: true,
        default: "SEA",
      },
      freightCost: {
        type: Number,
        default: 0,
        min: 0,
      },
      clearanceCost: {
        type: Number,
        default: 0,
        min: 0,
      },
      otherLogisticsCost: {
        type: Number,
        default: 0,
        min: 0,
      },
      totalLogisticsCost: {
        type: Number,
        default: 0,
        min: 0,
      },
    },

    // Cost breakdown including logistics
    grandTotal: {
      type: Number,
      required: true,
      min: 0,
    },

    // Additional information
    notes: {
      type: String,
      default: "",
    },
    internalNotes: {
      type: String,
      default: "",
    },

    // Approval workflow
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    approvalDate: {
      type: Date,
    },

    // User tracking
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // Quality control tracking
    qualityChecked: {
      type: Boolean,
      default: false,
    },
    qualityCheckDate: {
      type: Date,
    },
    qualityCheckBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    qualityNotes: {
      type: String,
      default: "",
    },
    statusHistory: [statusHistorySchema],
  },
  {
    timestamps: true,
  },
);

// Generate order number
purchaseOrderSchema.pre("save", async function (next) {
  if (!this.orderNumber) {
    const count = await this.constructor.countDocuments();
    const year = new Date().getFullYear();
    this.orderNumber = `PO-${year}-${String(count + 1).padStart(4, "0")}`;
  }

  if (!this.batchNumber) {
    const count = await this.constructor.countDocuments();
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, "0");
    this.batchNumber = `BATCH-${year}${month}-${String(count + 1).padStart(
      4,
      "0",
    )}`;
  }

  next();
});

// Calculate totals before saving
purchaseOrderSchema.pre("save", function (next) {
  // Calculate subtotal from items
  this.subtotal = this.items.reduce(
    (total, item) => total + item.totalPrice,
    0,
  );

  // Calculate total logistics cost
  if (this.logistics) {
    this.logistics.totalLogisticsCost =
      (this.logistics.freightCost || 0) +
      (this.logistics.clearanceCost || 0) +
      (this.logistics.otherLogisticsCost || 0);
  }

  // Calculate total amount (subtotal + tax + shipping - discount)
  this.totalAmount =
    this.subtotal + this.taxAmount + this.shippingCost - this.discountAmount;

  // Calculate grand total (total amount + logistics costs)
  this.grandTotal =
    this.totalAmount + (this.logistics?.totalLogisticsCost || 0);

  next();
});

// Index for better performance
purchaseOrderSchema.index({ supplier: 1 });
purchaseOrderSchema.index({ status: 1 });
purchaseOrderSchema.index({ orderDate: -1 });
purchaseOrderSchema.index({ expectedDeliveryDate: 1 });

// Virtual for days until delivery
purchaseOrderSchema.virtual("daysUntilDelivery").get(function () {
  if (!this.expectedDeliveryDate) return null;
  const today = new Date();
  const deliveryDate = new Date(this.expectedDeliveryDate);
  const diffTime = deliveryDate - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
});

// Virtual for order age
purchaseOrderSchema.virtual("orderAge").get(function () {
  const today = new Date();
  const orderDate = new Date(this.orderDate);
  const diffTime = today - orderDate;
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
});

// Virtual for logistics cost percentage
purchaseOrderSchema.virtual("logisticsCostPercentage").get(function () {
  if (!this.subtotal || this.subtotal === 0) return 0;
  return ((this.logistics?.totalLogisticsCost || 0) / this.subtotal) * 100;
});

// Virtual for total cost per unit (including logistics)
purchaseOrderSchema.virtual("totalCostPerUnit").get(function () {
  const totalUnits = this.items.reduce((sum, item) => sum + item.quantity, 0);
  if (totalUnits === 0) return 0;
  return this.grandTotal / totalUnits;
});

// Virtual for logistics cost per unit
purchaseOrderSchema.virtual("logisticsCostPerUnit").get(function () {
  const totalUnits = this.items.reduce((sum, item) => sum + item.quantity, 0);
  if (totalUnits === 0) return 0;
  return (this.logistics?.totalLogisticsCost || 0) / totalUnits;
});

// Static method to get orders by status
purchaseOrderSchema.statics.getByStatus = function (status) {
  return this.find({ status })
    .populate("supplier", "name email phone")
    .populate("items.product", "name sku")
    .populate("createdBy updatedBy approvedBy", "name email")
    .sort({ createdAt: -1 });
};

// Instance method to update status
purchaseOrderSchema.methods.updateStatus = function (status, userId) {
  this.status = status;
  this.updatedBy = userId;

  if (status === "APPROVED") {
    this.approvedBy = userId;
    this.approvalDate = new Date();
  }

  if (status === "DELIVERED") {
    this.actualDeliveryDate = new Date();
  }

  this.statusHistory.push({
    previousStatus,
    newStatus,
    changedBy: userId,
    changedAt: new Date(),
  });

  return this.save();
};

const PurchaseOrderModel = mongoose.model("PurchaseOrder", purchaseOrderSchema);

export default PurchaseOrderModel;
