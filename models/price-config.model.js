import mongoose from "mongoose";

const pricingConfigSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      default: "Default Pricing Configuration",
    },

    baseCurrency: {
      type: String,
      default: "NGN",
      required: true,
    },

    // Pricing margins/percentages for different price types
    margins: {
      salePrice: {
        type: Number,
        required: true,
        default: 15, // 15% profit margin
      },
      btbPrice: {
        type: Number,
        required: true,
        default: 10, // 10% profit margin for BTB
      },
      btcPrice: {
        type: Number,
        required: true,
        default: 8, // 8% profit margin for BTC
      },
      price3weeksDelivery: {
        type: Number,
        required: true,
        default: 20, // 20% profit margin for 3 weeks delivery
      },
      price5weeksDelivery: {
        type: Number,
        required: true,
        default: 25, // 25% profit margin for 5 weeks delivery
      },
    },

    // General overhead percentage
    overheadPercentage: {
      type: Number,
      required: true,
      default: 15, // 15% overhead
    },

    // NEW: Tax percentage - added to all calculated prices
    taxPercentage: {
      type: Number,
      required: true,
      default: 7.5, // 7.5% tax (VAT)
      min: 0,
      max: 100,
    },

    // Auto-update prices when exchange rates change
    autoUpdateOnExchangeRateChange: {
      type: Boolean,
      default: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    // Approval tracking
    isApproved: {
      type: Boolean,
      default: false,
    },

    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    approvedAt: {
      type: Date,
    },

    // Who last updated the configuration
    lastUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Configuration history for tracking changes
    configHistory: [
      {
        margins: {
          salePrice: Number,
          btbPrice: Number,
          btcPrice: Number,
          price3weeksDelivery: Number,
          price5weeksDelivery: Number,
        },
        overheadPercentage: Number,
        taxPercentage: Number, // NEW: Track tax changes in history
        updatedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        updatedAt: {
          type: Date,
          default: Date.now,
        },
        approvedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        approvedAt: Date,
      },
    ],
  },
  {
    timestamps: true,
  },
);

// Ensure only one active configuration exists
pricingConfigSchema.index(
  { isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);

const PricingConfigModel = mongoose.model("PricingConfig", pricingConfigSchema);

export default PricingConfigModel;
