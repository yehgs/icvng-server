// models/stock.model.js
import mongoose from 'mongoose';

const stockSchema = new mongoose.Schema(
  {
    batchNumber: {
      type: String,
      required: true,
      unique: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    purchaseOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PurchaseOrder',
      required: true,
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      required: true,
    },

    // Quantity tracking
    originalQuantity: {
      type: Number,
      required: true,
      min: 0,
    },
    currentQuantity: {
      type: Number,
      required: true,
      min: 0,
    },
    reservedQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    availableQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Quality control
    qualityStatus: {
      type: String,
      enum: ['PENDING', 'PASSED', 'FAILED', 'REFURBISHED'],
      default: 'PENDING',
    },
    qualityCheckDate: {
      type: Date,
    },
    qualityCheckBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    qualityNotes: {
      type: String,
      default: '',
    },

    // Quantity breakdown by quality
    goodQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    refurbishedQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    damagedQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Dates
    receivedDate: {
      type: Date,
      default: Date.now,
    },
    productionDate: {
      type: Date,
    },
    expiryDate: {
      type: Date,
    },

    // Location tracking
    warehouseLocation: {
      zone: {
        type: String,
        default: 'A',
      },
      aisle: {
        type: String,
        default: '01',
      },
      shelf: {
        type: String,
        default: '01',
      },
      bin: {
        type: String,
        default: '01',
      },
    },

    // Status
    status: {
      type: String,
      enum: [
        'RECEIVED',
        'IN_QUALITY_CHECK',
        'AVAILABLE',
        'PARTIALLY_ALLOCATED',
        'ALLOCATED',
        'EXPIRED',
        'DAMAGED',
        'DISPOSED',
      ],
      default: 'RECEIVED',
    },

    // Cost information
    unitCost: {
      type: Number,
      required: true,
      min: 0,
    },
    totalCost: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: 'USD',
      uppercase: true,
    },

    // Distribution tracking
    onlineStock: {
      type: Number,
      default: 0,
      min: 0,
    },
    offlineStock: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Alerts and notifications
    lowStockThreshold: {
      type: Number,
      default: 10,
    },
    expiryWarningDays: {
      type: Number,
      default: 30,
    },

    // Notes and tracking
    notes: {
      type: String,
      default: '',
    },
    movementHistory: [
      {
        type: {
          type: String,
          enum: [
            'RECEIVED',
            'QUALITY_CHECK',
            'ALLOCATED',
            'MOVED',
            'ADJUSTED',
            'EXPIRED',
            'DAMAGED',
          ],
          required: true,
        },
        quantity: {
          type: Number,
          required: true,
        },
        fromLocation: {
          type: String,
          default: '',
        },
        toLocation: {
          type: String,
          default: '',
        },
        reason: {
          type: String,
          default: '',
        },
        date: {
          type: Date,
          default: Date.now,
        },
        performedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        notes: {
          type: String,
          default: '',
        },
      },
    ],

    // User tracking
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

// Generate batch number if not provided
stockSchema.pre('save', async function (next) {
  if (!this.batchNumber) {
    const count = await this.constructor.countDocuments();
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const day = String(new Date().getDate()).padStart(2, '0');
    this.batchNumber = `SB-${year}${month}${day}-${String(count + 1).padStart(
      4,
      '0'
    )}`;
  }

  // Calculate available quantity
  this.availableQuantity = this.currentQuantity - this.reservedQuantity;

  // Calculate total cost
  if (this.unitCost && this.originalQuantity) {
    this.totalCost = this.unitCost * this.originalQuantity;
  }

  next();
});

// Virtual for expiry status
stockSchema.virtual('isExpired').get(function () {
  if (!this.expiryDate) return false;
  return new Date() > this.expiryDate;
});

// Virtual for days until expiry
stockSchema.virtual('daysUntilExpiry').get(function () {
  if (!this.expiryDate) return null;
  const today = new Date();
  const expiryDate = new Date(this.expiryDate);
  const diffTime = expiryDate - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
});

// Virtual for location string
stockSchema.virtual('locationString').get(function () {
  const loc = this.warehouseLocation;
  return `${loc.zone}-${loc.aisle}-${loc.shelf}-${loc.bin}`;
});

// Index for better performance
stockSchema.index({ batchNumber: 1 });
stockSchema.index({ product: 1 });
stockSchema.index({ purchaseOrder: 1 });
stockSchema.index({ supplier: 1 });
stockSchema.index({ status: 1 });
stockSchema.index({ qualityStatus: 1 });
stockSchema.index({ expiryDate: 1 });
stockSchema.index({ receivedDate: -1 });

// Static method to get expiring batches
stockSchema.statics.getExpiringBatches = function (days = 30) {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + days);

  return this.find({
    expiryDate: { $lte: futureDate, $gte: new Date() },
    status: { $in: ['AVAILABLE', 'PARTIALLY_ALLOCATED'] },
    currentQuantity: { $gt: 0 },
  })
    .populate('product', 'name sku')
    .populate('supplier', 'name');
};

// Instance method to add movement history
stockSchema.methods.addMovement = function (movementData) {
  this.movementHistory.push({
    ...movementData,
    date: new Date(),
  });
  return this.save();
};

// Instance method to allocate stock
stockSchema.methods.allocateStock = function (quantity, userId, reason = '') {
  if (quantity > this.availableQuantity) {
    throw new Error('Insufficient available stock');
  }

  this.reservedQuantity += quantity;
  this.addMovement({
    type: 'ALLOCATED',
    quantity,
    reason,
    performedBy: userId,
  });

  // Update status based on allocation
  if (this.reservedQuantity >= this.currentQuantity) {
    this.status = 'ALLOCATED';
  } else if (this.reservedQuantity > 0) {
    this.status = 'PARTIALLY_ALLOCATED';
  }

  return this.save();
};

const StockModel = mongoose.model('Stock', stockSchema);

export default StockModel;
