// models/directPricing.model.js
import mongoose from 'mongoose';

const directPricingSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      unique: true, // One direct pricing record per product
    },

    // Direct price entries (no calculations involved)
    directPrices: {
      salePrice: {
        type: Number,
        default: 0,
      },
      btbPrice: {
        type: Number,
        default: 0,
      },
      btcPrice: {
        type: Number,
        default: 0,
      },
      price3weeksDelivery: {
        type: Number,
        default: 0,
      },
      price5weeksDelivery: {
        type: Number,
        default: 0,
      },
    },

    // Track who updated each price type
    priceUpdatedBy: {
      salePrice: {
        updatedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        updatedAt: {
          type: Date,
        },
      },
      btbPrice: {
        updatedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        updatedAt: {
          type: Date,
        },
      },
      btcPrice: {
        updatedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        updatedAt: {
          type: Date,
        },
      },
      price3weeksDelivery: {
        updatedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        updatedAt: {
          type: Date,
        },
      },
      price5weeksDelivery: {
        updatedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        updatedAt: {
          type: Date,
        },
      },
    },

    // Overall tracking
    isActive: {
      type: Boolean,
      default: true,
    },

    // Notes for this pricing entry
    notes: {
      type: String,
      default: '',
    },

    // Last overall update tracking
    lastUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    lastUpdatedAt: {
      type: Date,
      default: Date.now,
    },

    // Approval tracking (optional, can be auto-approved for accountants)
    isApproved: {
      type: Boolean,
      default: true, // Auto-approve for direct pricing
    },

    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },

    approvedAt: {
      type: Date,
      default: Date.now,
    },

    // Price history for tracking all changes
    priceHistory: [
      {
        prices: {
          salePrice: Number,
          btbPrice: Number,
          btcPrice: Number,
          price3weeksDelivery: Number,
          price5weeksDelivery: Number,
        },
        priceType: {
          type: String, // Which specific price was updated
          enum: [
            'salePrice',
            'btbPrice',
            'btcPrice',
            'price3weeksDelivery',
            'price5weeksDelivery',
            'bulk',
          ],
        },
        previousValue: Number,
        newValue: Number,
        updatedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        updatedAt: {
          type: Date,
          default: Date.now,
        },
        notes: String,
        updateSource: {
          type: String,
          enum: ['DIRECT_ENTRY', 'BULK_UPDATE', 'ADMIN_OVERRIDE'],
          default: 'DIRECT_ENTRY',
        },
      },
    ],

    // Pricing source identifier
    pricingSource: {
      type: String,
      enum: ['DIRECT_PRICING', 'CONFIG_BASED'],
      default: 'DIRECT_PRICING',
    },

    // Override config-based pricing if both exist
    overrideConfigPricing: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for better performance
directPricingSchema.index({ product: 1 });
directPricingSchema.index({ isActive: 1 });
directPricingSchema.index({ lastUpdatedAt: -1 });
directPricingSchema.index({ 'priceUpdatedBy.salePrice.updatedBy': 1 });

// Pre-save middleware to update tracking information
directPricingSchema.pre('save', function (next) {
  if (this.isModified()) {
    this.lastUpdatedAt = new Date();
  }
  next();
});

// Virtual to check if any prices are set
directPricingSchema.virtual('hasPrices').get(function () {
  const prices = this.directPrices;
  return Object.values(prices).some((price) => price && price > 0);
});

// Virtual to get the latest price update info
directPricingSchema.virtual('latestUpdate').get(function () {
  if (this.priceHistory && this.priceHistory.length > 0) {
    return this.priceHistory[this.priceHistory.length - 1];
  }
  return null;
});

// Method to update a specific price
directPricingSchema.methods.updateSpecificPrice = function (
  priceType,
  newValue,
  updatedBy,
  notes = ''
) {
  const validPriceTypes = [
    'salePrice',
    'btbPrice',
    'btcPrice',
    'price3weeksDelivery',
    'price5weeksDelivery',
  ];

  if (!validPriceTypes.includes(priceType)) {
    throw new Error(`Invalid price type: ${priceType}`);
  }

  const previousValue = this.directPrices[priceType];

  // Update the price
  this.directPrices[priceType] = newValue;

  // Update tracking info for this specific price type
  this.priceUpdatedBy[priceType] = {
    updatedBy: updatedBy,
    updatedAt: new Date(),
  };

  // Add to history
  this.priceHistory.push({
    prices: { ...this.directPrices },
    priceType: priceType,
    previousValue: previousValue,
    newValue: newValue,
    updatedBy: updatedBy,
    updatedAt: new Date(),
    notes: notes,
    updateSource: 'DIRECT_ENTRY',
  });

  // Update overall tracking
  this.lastUpdatedBy = updatedBy;
  this.lastUpdatedAt = new Date();
};

// Method to bulk update multiple prices
directPricingSchema.methods.bulkUpdatePrices = function (
  priceUpdates,
  updatedBy,
  notes = ''
) {
  const previousPrices = { ...this.directPrices };
  const validPriceTypes = [
    'salePrice',
    'btbPrice',
    'btcPrice',
    'price3weeksDelivery',
    'price5weeksDelivery',
  ];

  // Update all provided prices
  Object.entries(priceUpdates).forEach(([priceType, newValue]) => {
    if (validPriceTypes.includes(priceType) && newValue !== undefined) {
      this.directPrices[priceType] = newValue;

      // Update tracking for each price type
      this.priceUpdatedBy[priceType] = {
        updatedBy: updatedBy,
        updatedAt: new Date(),
      };
    }
  });

  // Add bulk update to history
  this.priceHistory.push({
    prices: { ...this.directPrices },
    priceType: 'bulk',
    previousValue: null, // Not applicable for bulk updates
    newValue: null, // Not applicable for bulk updates
    updatedBy: updatedBy,
    updatedAt: new Date(),
    notes: notes,
    updateSource: 'BULK_UPDATE',
  });

  // Update overall tracking
  this.lastUpdatedBy = updatedBy;
  this.lastUpdatedAt = new Date();
};

// Static method to find or create direct pricing for a product
directPricingSchema.statics.findOrCreateForProduct = async function (
  productId,
  userId
) {
  let directPricing = await this.findOne({
    product: productId,
    isActive: true,
  });

  if (!directPricing) {
    directPricing = new this({
      product: productId,
      lastUpdatedBy: userId,
      approvedBy: userId,
    });
    await directPricing.save();
  }

  return directPricing;
};

const DirectPricingModel = mongoose.model('DirectPricing', directPricingSchema);

export default DirectPricingModel;
