// models/productPricing.model.js (Updated)
import mongoose from 'mongoose';

const productPricingSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      unique: true,
    },

    purchaseOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PurchaseOrder',
    },

    // Cost breakdown in original currency and Naira
    costBreakdown: {
      // Original purchase cost
      unitCostInOriginalCurrency: {
        type: Number,
        required: true,
      },
      originalCurrency: {
        type: String,
        required: true,
      },
      exchangeRate: {
        type: Number,
        required: true,
      },
      unitCostInNaira: {
        type: Number,
        required: true,
      },

      // Logistics costs per unit
      freightAndClearingCostPerUnit: {
        type: Number,
        required: true,
        default: 0,
      },

      // Total cost per unit in Naira (unit cost + logistics)
      totalCostPerUnit: {
        type: Number,
        required: true,
      },

      // Overhead calculation
      overheadPercentage: {
        type: Number,
        required: true,
      },
      overheadAmount: {
        type: Number,
        required: true,
      },

      // Sub price (total cost + overhead) - base for all price calculations
      subPrice: {
        type: Number,
        required: true,
      },
    },

    // All calculated prices in Naira
    calculatedPrices: {
      salePrice: {
        type: Number,
        required: true,
      },
      btbPrice: {
        type: Number,
        required: true,
      },
      btcPrice: {
        type: Number,
        required: true,
      },
      price3weeksDelivery: {
        type: Number,
        required: true,
      },
      price5weeksDelivery: {
        type: Number,
        required: true,
      },
    },

    // Applied profit margins for each price type
    appliedMargins: {
      salePrice: {
        type: Number,
        required: true,
      },
      btbPrice: {
        type: Number,
        required: true,
      },
      btcPrice: {
        type: Number,
        required: true,
      },
      price3weeksDelivery: {
        type: Number,
        required: true,
      },
      price5weeksDelivery: {
        type: Number,
        required: true,
      },
    },

    // Pricing configuration used
    pricingConfig: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PricingConfig',
      required: true,
    },

    // Approval tracking
    isApproved: {
      type: Boolean,
      default: false,
    },

    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },

    approvedAt: {
      type: Date,
    },

    // Calculation tracking
    calculatedAt: {
      type: Date,
      default: Date.now,
    },

    calculatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Exchange rate tracking for recalculation
    lastExchangeRateUpdate: {
      type: Date,
      default: Date.now,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    // Price history for tracking changes
    priceHistory: [
      {
        calculatedPrices: {
          salePrice: Number,
          btbPrice: Number,
          btcPrice: Number,
          price3weeksDelivery: Number,
          price5weeksDelivery: Number,
        },
        appliedMargins: {
          salePrice: Number,
          btbPrice: Number,
          btcPrice: Number,
          price3weeksDelivery: Number,
          price5weeksDelivery: Number,
        },
        exchangeRate: Number,
        calculatedAt: {
          type: Date,
          default: Date.now,
        },
        calculatedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        approvedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        approvedAt: Date,
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Indexes for better performance
productPricingSchema.index({ product: 1 });
productPricingSchema.index({ purchaseOrder: 1 });
productPricingSchema.index({ isApproved: 1 });
productPricingSchema.index({ isActive: 1 });

const ProductPricingModel = mongoose.model(
  'ProductPricing',
  productPricingSchema
);

export default ProductPricingModel;
