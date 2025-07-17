// models/shippingMethod.model.js - Updated with simplified table shipping structure
import mongoose from 'mongoose';

const shippingMethodSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Shipping method name is required'],
      trim: true,
    },
    code: {
      type: String,
      required: [true, 'Shipping method code is required'],
      unique: true,
      uppercase: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    type: {
      type: String,
      enum: ['flat_rate', 'table_shipping', 'pickup'],
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },

    // Flat rate configuration
    flatRate: {
      cost: {
        type: Number,
        default: 0,
      },
      // Zone-specific pricing (if empty, applies to all zones)
      zoneRates: [
        {
          zone: {
            type: mongoose.Schema.ObjectId,
            ref: 'ShippingZone',
            required: true,
          },
          cost: {
            type: Number,
            required: true,
          },
          freeShipping: {
            enabled: { type: Boolean, default: false },
            minimumOrderAmount: { type: Number, default: 0 },
          },
        },
      ],
      // Default settings (used when no zone-specific rates)
      defaultCost: {
        type: Number,
        default: 0,
      },
      assignment: {
        type: String,
        enum: ['all_products', 'categories', 'specific_products'],
        default: 'all_products',
      },
      categories: [
        {
          type: mongoose.Schema.ObjectId,
          ref: 'Category',
        },
      ],
      products: [
        {
          type: mongoose.Schema.ObjectId,
          ref: 'Product',
        },
      ],
      freeShipping: {
        enabled: { type: Boolean, default: false },
        minimumOrderAmount: { type: Number, default: 0 },
      },
      validFrom: {
        type: Date,
        default: Date.now,
      },
      validUntil: {
        type: Date,
        default: null,
      },
    },

    // Table shipping configuration (zone-based with weight) - UPDATED STRUCTURE
    tableShipping: {
      // Assignment settings (same as flat rate)
      assignment: {
        type: String,
        enum: ['all_products', 'categories', 'specific_products'],
        default: 'all_products',
      },
      categories: [
        {
          type: mongoose.Schema.ObjectId,
          ref: 'Category',
        },
      ],
      products: [
        {
          type: mongoose.Schema.ObjectId,
          ref: 'Product',
        },
      ],
      // Zone-based weight rates - SIMPLIFIED STRUCTURE
      zoneRates: [
        {
          zone: {
            type: mongoose.Schema.ObjectId,
            ref: 'ShippingZone',
            required: true,
          },
          weightRanges: [
            {
              minWeight: { type: Number, required: true }, // in kg
              maxWeight: { type: Number, required: true }, // in kg
              shippingCost: { type: Number, required: true }, // fixed cost for this range
            },
          ],
        },
      ],
      // Duration settings
      validFrom: {
        type: Date,
        default: Date.now,
      },
      validUntil: {
        type: Date,
        default: null,
      },
    },

    // Pickup configuration
    pickup: {
      // Zone-specific locations (if empty, applies to all zones)
      zoneLocations: [
        {
          zone: {
            type: mongoose.Schema.ObjectId,
            ref: 'ShippingZone',
            required: true,
          },
          locations: [
            {
              name: {
                type: String,
                required: true,
              },
              address: {
                type: String,
                required: true,
              },
              city: {
                type: String,
                required: true,
              },
              state: {
                type: String,
                required: true,
              },
              postalCode: String,
              phone: String,
              operatingHours: {
                monday: { open: String, close: String },
                tuesday: { open: String, close: String },
                wednesday: { open: String, close: String },
                thursday: { open: String, close: String },
                friday: { open: String, close: String },
                saturday: { open: String, close: String },
                sunday: { open: String, close: String },
              },
              isActive: {
                type: Boolean,
                default: true,
              },
            },
          ],
        },
      ],
      // Default locations (used when no zone-specific locations)
      defaultLocations: [
        {
          name: {
            type: String,
            required: true,
          },
          address: {
            type: String,
            required: true,
          },
          city: {
            type: String,
            required: true,
          },
          state: {
            type: String,
            required: true,
          },
          postalCode: String,
          phone: String,
          operatingHours: {
            monday: { open: String, close: String },
            tuesday: { open: String, close: String },
            wednesday: { open: String, close: String },
            thursday: { open: String, close: String },
            friday: { open: String, close: String },
            saturday: { open: String, close: String },
            sunday: { open: String, close: String },
          },
          isActive: {
            type: Boolean,
            default: true,
          },
        },
      ],
      cost: {
        type: Number,
        default: 0,
      },
      assignment: {
        type: String,
        enum: ['all_products', 'categories', 'specific_products'],
        default: 'all_products',
      },
      categories: [
        {
          type: mongoose.Schema.ObjectId,
          ref: 'Category',
        },
      ],
      products: [
        {
          type: mongoose.Schema.ObjectId,
          ref: 'Product',
        },
      ],
    },

    // Estimated delivery time
    estimatedDelivery: {
      minDays: {
        type: Number,
        default: 1,
      },
      maxDays: {
        type: Number,
        default: 7,
      },
    },

    createdBy: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
shippingMethodSchema.index({ code: 1 });
shippingMethodSchema.index({ type: 1 });
shippingMethodSchema.index({ isActive: 1 });
shippingMethodSchema.index({ sortOrder: 1 });

// Method to check if method is currently valid
// Method to check if method is currently valid
shippingMethodSchema.methods.isCurrentlyValid = function () {
  const now = new Date();

  // Get the configuration object based on the method type
  const config = this[this.type];

  // If no config exists, consider it valid
  if (!config) {
    return true;
  }

  // Check if validFrom and validUntil exist before using them
  if (!config.validFrom && !config.validUntil) {
    return true; // If no dates set, always valid
  }

  // If only validFrom is set
  if (config.validFrom && !config.validUntil) {
    return now >= config.validFrom;
  }

  // If only validUntil is set
  if (!config.validFrom && config.validUntil) {
    return now <= config.validUntil;
  }

  // If both are set
  if (config.validFrom && config.validUntil) {
    return now >= config.validFrom && now <= config.validUntil;
  }

  return true; // Default to valid
};

// Get assignment display text
shippingMethodSchema.methods.getAssignmentDisplay = function () {
  const config = this[this.type];

  if (!config) return 'All Products';

  switch (config.assignment) {
    case 'all_products':
      return 'All Products';
    case 'categories':
      return `Categories (${config.categories?.length || 0})`;
    case 'specific_products':
      return `Products (${config.products?.length || 0})`;
    default:
      return 'All Products';
  }
};

// models/shippingMethod.model.js - Enhanced calculateShippingCost method
shippingMethodSchema.methods.calculateShippingCost = function (orderData) {
  const { weight, orderValue, zone, items } = orderData;

  if (!this.isActive || !this.isCurrentlyValid()) {
    return { eligible: false, reason: 'Shipping method not available' };
  }

  // Check if method applies to the items in the order
  const productIds = items.map((item) => item.productId || item._id);
  const categoryIds = [
    ...new Set(items.map((item) => item.category).filter(Boolean)),
  ];

  const appliesToProducts = this.appliesToProducts(productIds);
  const appliesToCategories = this.appliesToCategories(categoryIds);

  if (!appliesToProducts && !appliesToCategories) {
    return {
      eligible: false,
      reason: 'Shipping method not applicable to these products',
    };
  }

  let cost = 0;
  let eligible = true;
  let reason = '';

  switch (this.type) {
    case 'flat_rate':
      const flatConfig = this.flatRate;

      // Check for zone-specific rate first
      const zoneRate = flatConfig.zoneRates.find(
        (zr) => zr.zone.toString() === zone.toString()
      );

      if (zoneRate) {
        // Use zone-specific rate
        if (
          zoneRate.freeShipping.enabled &&
          orderValue >= zoneRate.freeShipping.minimumOrderAmount
        ) {
          cost = 0;
          reason = `Free shipping on orders over ${zoneRate.freeShipping.minimumOrderAmount} in this zone`;
        } else {
          cost = zoneRate.cost;
        }
      } else if (flatConfig.zoneRates.length === 0) {
        // No zone-specific rates, use default for all zones
        if (
          flatConfig.freeShipping.enabled &&
          orderValue >= flatConfig.freeShipping.minimumOrderAmount
        ) {
          cost = 0;
          reason = `Free shipping on orders over ${flatConfig.freeShipping.minimumOrderAmount}`;
        } else {
          cost = flatConfig.defaultCost || flatConfig.cost || 0;
        }
      } else {
        // Zone-specific rates exist but this zone is not covered
        eligible = false;
        reason = 'Flat rate shipping not available to your zone';
      }
      break;

    case 'table_shipping':
      const tableConfig = this.tableShipping;
      const tableZoneRate = tableConfig.zoneRates.find(
        (zr) => zr.zone.toString() === zone.toString()
      );

      if (!tableZoneRate) {
        eligible = false;
        reason = 'Table shipping not available to your zone';
        break;
      }

      const weightRange = tableZoneRate.weightRanges.find(
        (range) => weight >= range.minWeight && weight <= range.maxWeight
      );

      if (!weightRange) {
        const higherRange = tableZoneRate.weightRanges
          .filter((range) => weight < range.minWeight)
          .sort((a, b) => a.minWeight - b.minWeight)[0];

        if (higherRange) {
          cost = higherRange.shippingCost;
          reason = `Weight ${weight}kg exceeds standard range, using next tier`;
        } else {
          eligible = false;
          reason = `No shipping rate available for weight ${weight}kg in your zone`;
        }
      } else {
        cost = weightRange.shippingCost;
      }
      break;

    case 'pickup':
      const pickupConfig = this.pickup;
      cost = 0; // Always free for pickup

      // Check for zone-specific locations first
      const zoneLocations = pickupConfig.zoneLocations.find(
        (zl) => zl.zone.toString() === zone.toString()
      );

      if (zoneLocations) {
        // Use zone-specific locations
        const activeLocations = zoneLocations.locations.filter(
          (loc) => loc.isActive
        );
        if (activeLocations.length === 0) {
          eligible = false;
          reason = 'No active pickup locations in your zone';
        } else {
          reason = `${activeLocations.length} pickup location(s) available in your zone`;
        }
      } else if (pickupConfig.zoneLocations.length === 0) {
        // No zone-specific locations, use default for all zones
        const activeLocations = pickupConfig.defaultLocations.filter(
          (loc) => loc.isActive
        );
        if (activeLocations.length === 0) {
          eligible = false;
          reason = 'No active pickup locations available';
        } else {
          reason = `${activeLocations.length} pickup location(s) available`;
        }
      } else {
        // Zone-specific locations exist but this zone is not covered
        eligible = false;
        reason = 'Pickup not available in your zone';
      }
      break;

    default:
      eligible = false;
      reason = 'Invalid shipping method type';
  }

  return {
    eligible,
    cost: Math.round(cost * 100) / 100,
    reason,
    weightUsed: weight,
    orderValueUsed: orderValue,
    methodType: this.type,
  };
};

// Enhanced method to check if method applies to specific products with better validation
shippingMethodSchema.methods.appliesToProducts = function (productIds) {
  const config = this[this.type];

  if (!config) return false;

  if (config.assignment === 'all_products') {
    return true;
  }

  if (config.assignment === 'specific_products') {
    if (!config.products || config.products.length === 0) {
      return false;
    }
    return productIds.some((id) =>
      config.products.some(
        (productId) => productId.toString() === id.toString()
      )
    );
  }

  return false;
};

// Enhanced method to check if method applies to categories with better validation
shippingMethodSchema.methods.appliesToCategories = function (categoryIds) {
  const config = this[this.type];

  if (!config) return false;

  if (config.assignment === 'all_products') {
    return true;
  }

  if (config.assignment === 'categories') {
    if (!config.categories || config.categories.length === 0) {
      return false;
    }
    return categoryIds.some((id) =>
      config.categories.some((catId) => catId.toString() === id.toString())
    );
  }

  return false;
};

shippingMethodSchema.methods.getPickupLocationsForZone = function (zoneId) {
  if (this.type !== 'pickup') return [];

  const pickupConfig = this.pickup;

  // Check for zone-specific locations first
  const zoneLocations = pickupConfig.zoneLocations.find(
    (zl) => zl.zone.toString() === zoneId.toString()
  );

  if (zoneLocations) {
    return zoneLocations.locations.filter((loc) => loc.isActive);
  } else if (pickupConfig.zoneLocations.length === 0) {
    // No zone-specific locations, return default locations for all zones
    return pickupConfig.defaultLocations.filter((loc) => loc.isActive);
  } else {
    // Zone-specific locations exist but this zone is not covered
    return [];
  }
};

// Method to check if method is available in a specific zone
shippingMethodSchema.methods.isAvailableInZone = function (zoneId) {
  if (!this.isActive) return false;

  switch (this.type) {
    case 'flat_rate':
      const flatConfig = this.flatRate;
      if (flatConfig.zoneRates.length === 0) {
        return true; // Available in all zones
      }
      return flatConfig.zoneRates.some(
        (zr) => zr.zone.toString() === zoneId.toString()
      );

    case 'table_shipping':
      const tableConfig = this.tableShipping;
      return tableConfig.zoneRates.some(
        (zr) => zr.zone.toString() === zoneId.toString()
      );

    case 'pickup':
      const pickupConfig = this.pickup;
      if (pickupConfig.zoneLocations.length === 0) {
        return true; // Available in all zones
      }
      return pickupConfig.zoneLocations.some(
        (zl) => zl.zone.toString() === zoneId.toString()
      );

    default:
      return false;
  }
};

const ShippingMethodModel = mongoose.model(
  'ShippingMethod',
  shippingMethodSchema
);

export default ShippingMethodModel;
