// models/shippingMethod.model.js - FIXED VERSION with enhanced assignment logic
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

    // Table shipping configuration (zone-based with weight)
    tableShipping: {
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
      // Zone-based weight rates
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
              lga: {
                type: String,
                required: true, // FIXED: Make LGA required for Nigerian addresses
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
          lga: {
            type: String,
            required: true, // FIXED: Make LGA required for Nigerian addresses
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

// FIXED: Enhanced method to check if method is currently valid
shippingMethodSchema.methods.isCurrentlyValid = function () {
  const now = new Date();
  const config = this[this.type];

  if (!config) {
    return true; // If no config exists, consider it valid
  }

  // Check validity period
  if (config.validFrom && now < config.validFrom) {
    return false; // Not yet valid
  }

  if (config.validUntil && now > config.validUntil) {
    return false; // Expired
  }

  return true;
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

// FIXED: Enhanced calculateShippingCost method
shippingMethodSchema.methods.calculateShippingCost = function (orderData) {
  const { weight, orderValue, zone, items } = orderData;

  if (!this.isActive || !this.isCurrentlyValid()) {
    return { eligible: false, reason: 'Shipping method not available' };
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

// FIXED: Enhanced method to check if method applies to specific products
shippingMethodSchema.methods.appliesToProducts = function (productIds) {
  const config = this[this.type];

  if (!config) {
    return true; // If no config, apply to all products
  }

  // FIXED: If assignment is all_products OR no specific assignment configured, apply to all
  if (
    config.assignment === 'all_products' ||
    (!config.assignment &&
      !config.categories?.length &&
      !config.products?.length)
  ) {
    return true;
  }

  if (config.assignment === 'specific_products') {
    // FIXED: If no products specified, apply to all products
    if (!config.products || config.products.length === 0) {
      return true;
    }
    return productIds.some((id) =>
      config.products.some(
        (productId) => productId.toString() === id.toString()
      )
    );
  }

  return false;
};

// FIXED: Enhanced method to check if method applies to categories
shippingMethodSchema.methods.appliesToCategories = function (categoryIds) {
  const config = this[this.type];

  if (!config) {
    return true; // If no config, apply to all products
  }

  // FIXED: If assignment is all_products OR no specific assignment configured, apply to all
  if (
    config.assignment === 'all_products' ||
    (!config.assignment &&
      !config.categories?.length &&
      !config.products?.length)
  ) {
    return true;
  }

  if (config.assignment === 'categories') {
    // FIXED: If no categories specified, apply to all products
    if (!config.categories || config.categories.length === 0) {
      return true;
    }
    return categoryIds.some((id) =>
      config.categories.some((catId) => catId.toString() === id.toString())
    );
  }

  return false;
};

// Get pickup locations for a specific zone
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

// FIXED: Enhanced method to check if method is available in a specific zone
shippingMethodSchema.methods.isAvailableInZone = function (zoneId) {
  if (!this.isActive) return false;

  switch (this.type) {
    case 'flat_rate':
      const flatConfig = this.flatRate;
      if (!flatConfig.zoneRates || flatConfig.zoneRates.length === 0) {
        return true; // Available in all zones when no zone-specific rates
      }
      return flatConfig.zoneRates.some(
        (zr) => zr.zone.toString() === zoneId.toString()
      );

    case 'table_shipping':
      const tableConfig = this.tableShipping;
      if (!tableConfig.zoneRates || tableConfig.zoneRates.length === 0) {
        return false; // Table shipping requires zone rates
      }
      return tableConfig.zoneRates.some(
        (zr) => zr.zone.toString() === zoneId.toString()
      );

    case 'pickup':
      const pickupConfig = this.pickup;
      if (
        !pickupConfig.zoneLocations ||
        pickupConfig.zoneLocations.length === 0
      ) {
        // No zone-specific locations, check if default locations exist
        return (
          pickupConfig.defaultLocations &&
          pickupConfig.defaultLocations.length > 0
        );
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
