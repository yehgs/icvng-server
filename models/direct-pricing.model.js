// models/directPricing.model.js
import mongoose from 'mongoose';

const directPricingSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      unique: true,
    },

    // Direct price entries (only BTC and delivery prices)
    directPrices: {
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

    isActive: {
      type: Boolean,
      default: true,
    },

    notes: {
      type: String,
      default: '',
    },

    lastUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    lastUpdatedAt: {
      type: Date,
      default: Date.now,
    },

    isApproved: {
      type: Boolean,
      default: true,
    },

    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },

    approvedAt: {
      type: Date,
      default: Date.now,
    },

    priceHistory: [
      {
        prices: {
          btcPrice: Number,
          price3weeksDelivery: Number,
          price5weeksDelivery: Number,
        },
        priceType: {
          type: String,
          enum: [
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

    pricingSource: {
      type: String,
      enum: ['DIRECT_PRICING', 'CONFIG_BASED'],
      default: 'DIRECT_PRICING',
    },

    overrideConfigPricing: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
directPricingSchema.index({ product: 1 });
directPricingSchema.index({ isActive: 1 });
directPricingSchema.index({ lastUpdatedAt: -1 });
directPricingSchema.index({ 'priceUpdatedBy.btcPrice.updatedBy': 1 });

// Pre-save middleware
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
    'btcPrice',
    'price3weeksDelivery',
    'price5weeksDelivery',
  ];

  if (!validPriceTypes.includes(priceType)) {
    throw new Error(`Invalid price type: ${priceType}`);
  }

  const previousValue = this.directPrices[priceType];

  this.directPrices[priceType] = newValue;

  this.priceUpdatedBy[priceType] = {
    updatedBy: updatedBy,
    updatedAt: new Date(),
  };

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

  this.lastUpdatedBy = updatedBy;
  this.lastUpdatedAt = new Date();
};

// Method to bulk update multiple prices
directPricingSchema.methods.bulkUpdatePrices = function (
  priceUpdates,
  updatedBy,
  notes = ''
) {
  const validPriceTypes = [
    'btcPrice',
    'price3weeksDelivery',
    'price5weeksDelivery',
  ];

  Object.entries(priceUpdates).forEach(([priceType, newValue]) => {
    if (validPriceTypes.includes(priceType) && newValue !== undefined) {
      this.directPrices[priceType] = newValue;

      this.priceUpdatedBy[priceType] = {
        updatedBy: updatedBy,
        updatedAt: new Date(),
      };
    }
  });

  this.priceHistory.push({
    prices: { ...this.directPrices },
    priceType: 'bulk',
    previousValue: null,
    newValue: null,
    updatedBy: updatedBy,
    updatedAt: new Date(),
    notes: notes,
    updateSource: 'BULK_UPDATE',
  });

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
