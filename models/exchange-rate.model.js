// models/exchangeRate.model.js
import mongoose from 'mongoose';

const exchangeRateSchema = new mongoose.Schema(
  {
    baseCurrency: {
      type: String,
      required: true,
      default: 'USD',
      uppercase: true,
    },
    targetCurrency: {
      type: String,
      required: true,
      uppercase: true,
    },
    rate: {
      type: Number,
      required: true,
      min: 0,
    },
    source: {
      type: String,
      enum: ['API', 'MANUAL'],
      default: 'API',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: function () {
        return this.source === 'MANUAL';
      },
    },
    apiProvider: {
      type: String,
      default: 'exchangerate.host', // ✅ Updated to use the free, reliable API
      enum: [
        'exchangerate.host',
        'fixer.io',
        'currencyapi.com',
        'exchangeratesapi.io',
        'freecurrencyapi.net',
        'manual',
        'fallback',
      ],
    },
    notes: {
      type: String,
      default: '',
    },
    // ✅ NEW: Additional metadata
    confidence: {
      type: Number,
      default: 1.0,
      min: 0,
      max: 1,
      // 1.0 = API source, 0.8 = manual, 0.5 = fallback
    },
    lastAPIUpdate: {
      type: Date,
      default: Date.now,
    },
    // ✅ NEW: Track API response time for monitoring
    apiResponseTime: {
      type: Number, // in milliseconds
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Create compound index for base and target currency
exchangeRateSchema.index(
  { baseCurrency: 1, targetCurrency: 1 },
  { unique: true }
);

// ✅ NEW: Index for better query performance
exchangeRateSchema.index({ lastUpdated: -1 });
exchangeRateSchema.index({ source: 1 });
exchangeRateSchema.index({ isActive: 1 });

// Add method to get current rate
exchangeRateSchema.methods.getCurrentRate = function () {
  return this.rate;
};

// ✅ ENHANCED: Static method to get rate between currencies with better logic
exchangeRateSchema.statics.getRate = async function (from, to) {
  const fromUpper = from.toUpperCase();
  const toUpper = to.toUpperCase();

  // Direct rate lookup — prefer MANUAL rates set by admin, then fall back to API rates
  const rate = await this.findOne({
    baseCurrency: fromUpper,
    targetCurrency: toUpper,
    isActive: true,
  }).sort({ source: -1, lastUpdated: -1 }); // 'MANUAL' sorts before 'API' alphabetically in desc order

  // Explicitly prefer MANUAL over API if both exist
  const manualRate = await this.findOne({
    baseCurrency: fromUpper,
    targetCurrency: toUpper,
    isActive: true,
    source: 'MANUAL',
  }).sort({ lastUpdated: -1 });

  const effectiveRate = manualRate || rate;

  if (effectiveRate) {
    return effectiveRate.rate;
  }

  // Try reverse rate
  const manualReverseRate = await this.findOne({
    baseCurrency: toUpper,
    targetCurrency: fromUpper,
    isActive: true,
    source: 'MANUAL',
  }).sort({ lastUpdated: -1 });

  const reverseRate = manualReverseRate || await this.findOne({
    baseCurrency: toUpper,
    targetCurrency: fromUpper,
    isActive: true,
  }).sort({ source: -1, lastUpdated: -1 });

  if (reverseRate) {
    return 1 / reverseRate.rate;
  }

  // Try cross-rate calculation via USD — prefer MANUAL rates
  if (fromUpper !== 'USD' && toUpper !== 'USD') {
    const fromUSDRate = await this.findOne({
      baseCurrency: 'USD',
      targetCurrency: fromUpper,
      isActive: true,
      source: 'MANUAL',
    }).sort({ lastUpdated: -1 }) || await this.findOne({
      baseCurrency: 'USD',
      targetCurrency: fromUpper,
      isActive: true,
    }).sort({ source: -1, lastUpdated: -1 });

    const toUSDRate = await this.findOne({
      baseCurrency: 'USD',
      targetCurrency: toUpper,
      isActive: true,
      source: 'MANUAL',
    }).sort({ lastUpdated: -1 }) || await this.findOne({
      baseCurrency: 'USD',
      targetCurrency: toUpper,
      isActive: true,
    }).sort({ source: -1, lastUpdated: -1 });

    if (fromUSDRate && toUSDRate) {
      // Calculate cross rate: (1/fromUSDRate) * toUSDRate
      return toUSDRate.rate / fromUSDRate.rate;
    }

    // Try reverse USD rates
    const usdFromRate = await this.findOne({
      baseCurrency: fromUpper,
      targetCurrency: 'USD',
      isActive: true,
      source: 'MANUAL',
    }).sort({ lastUpdated: -1 }) || await this.findOne({
      baseCurrency: fromUpper,
      targetCurrency: 'USD',
      isActive: true,
    }).sort({ source: -1, lastUpdated: -1 });

    const usdToRate = await this.findOne({
      baseCurrency: toUpper,
      targetCurrency: 'USD',
      isActive: true,
      source: 'MANUAL',
    }).sort({ lastUpdated: -1 }) || await this.findOne({
      baseCurrency: toUpper,
      targetCurrency: 'USD',
      isActive: true,
    }).sort({ source: -1, lastUpdated: -1 });

    if (usdFromRate && usdToRate) {
      // Calculate cross rate: usdFromRate * (1/usdToRate)
      return usdFromRate.rate / usdToRate.rate;
    }
  }

  return null;
};

// ✅ NEW: Static method to get all rates for a base currency
exchangeRateSchema.statics.getRatesForBase = async function (baseCurrency) {
  return await this.find({
    baseCurrency: baseCurrency.toUpperCase(),
    isActive: true,
  }).sort({ confidence: -1, lastUpdated: -1 });
};

// ✅ NEW: Static method to check if rates are stale
exchangeRateSchema.statics.getStaleRates = async function (hoursOld = 24) {
  const cutoffDate = new Date(Date.now() - hoursOld * 60 * 60 * 1000);
  return await this.find({
    isActive: true,
    source: 'API',
    lastUpdated: { $lt: cutoffDate },
  });
};

// ✅ NEW: Static method to get rate statistics
exchangeRateSchema.statics.getRateStats = async function () {
  const [totalRates, apiRates, manualRates, providers] = await Promise.all([
    this.countDocuments({ isActive: true }),
    this.countDocuments({ isActive: true, source: 'API' }),
    this.countDocuments({ isActive: true, source: 'MANUAL' }),
    this.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$apiProvider', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  return {
    total: totalRates,
    api: apiRates,
    manual: manualRates,
    providers: providers,
  };
};

// Pre-save middleware to set confidence levels — MANUAL rates take highest priority
exchangeRateSchema.pre('save', function (next) {
  if (this.source === 'MANUAL') {
    this.confidence = 1.0; // Admin-set manual rates are the source of truth
  } else if (this.source === 'API') {
    this.confidence = this.apiProvider === 'fallback' ? 0.3 : 0.6;
  }
  next();
});

const ExchangeRateModel = mongoose.model('ExchangeRate', exchangeRateSchema);

export default ExchangeRateModel;
