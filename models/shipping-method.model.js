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

  console.log(`🧮 Calculating shipping cost for method: ${this.name}`);
  console.log(`Parameters:`, { weight, orderValue, zone: zone.toString() });

  if (!this.isActive || !this.isCurrentlyValid()) {
    console.log('❌ Method not active or not valid');
    return { eligible: false, reason: 'Shipping method not available' };
  }

  let cost = 0;
  let eligible = true;
  let reason = '';

  switch (this.type) {
    case 'flat_rate':
      console.log('📦 Processing flat rate method');
      const flatConfig = this.flatRate;

      // Check for zone-specific rate first
      const zoneRate = flatConfig.zoneRates?.find(
        (zr) => zr.zone.toString() === zone.toString()
      );

      console.log(`Zone rate found: ${!!zoneRate}`);

      if (zoneRate) {
        console.log(`Using zone-specific rate: ${zoneRate.cost}`);
        // Use zone-specific rate
        if (
          zoneRate.freeShipping?.enabled &&
          orderValue >= zoneRate.freeShipping.minimumOrderAmount
        ) {
          cost = 0;
          reason = `Free shipping on orders over ₦${zoneRate.freeShipping.minimumOrderAmount} in this zone`;
          console.log('✅ Free shipping applied (zone-specific)');
        } else {
          cost = zoneRate.cost;
          console.log(`✅ Zone rate applied: ₦${cost}`);
        }
      } else if (!flatConfig.zoneRates || flatConfig.zoneRates.length === 0) {
        console.log('Using default rate for all zones');
        // No zone-specific rates, use default for all zones
        if (
          flatConfig.freeShipping?.enabled &&
          orderValue >= flatConfig.freeShipping.minimumOrderAmount
        ) {
          cost = 0;
          reason = `Free shipping on orders over ₦${flatConfig.freeShipping.minimumOrderAmount}`;
          console.log('✅ Free shipping applied (default)');
        } else {
          cost = flatConfig.defaultCost || flatConfig.cost || 0;
          console.log(`✅ Default rate applied: ₦${cost}`);
        }
      } else {
        console.log(
          '❌ Zone-specific rates exist but this zone is not covered'
        );
        // Zone-specific rates exist but this zone is not covered
        eligible = false;
        reason = 'Flat rate shipping not available to your zone';
      }
      break;

    case 'table_shipping':
      console.log('📊 Processing table shipping method');
      const tableConfig = this.tableShipping;
      const tableZoneRate = tableConfig.zoneRates?.find(
        (zr) => zr.zone.toString() === zone.toString()
      );

      console.log(`Table zone rate found: ${!!tableZoneRate}`);

      if (!tableZoneRate) {
        console.log('❌ No zone rate found for table shipping');
        eligible = false;
        reason = 'Table shipping not available to your zone';
        break;
      }

      console.log(
        `Weight ranges available: ${tableZoneRate.weightRanges?.length || 0}`
      );

      const weightRange = tableZoneRate.weightRanges?.find(
        (range) => weight >= range.minWeight && weight <= range.maxWeight
      );

      if (!weightRange) {
        console.log(`❌ No weight range found for ${weight}kg`);

        // Try to find the next higher range
        const higherRange = tableZoneRate.weightRanges
          ?.filter((range) => weight < range.minWeight)
          .sort((a, b) => a.minWeight - b.minWeight)[0];

        if (higherRange) {
          cost = higherRange.shippingCost;
          reason = `Weight ${weight}kg exceeds standard range, using next tier (₦${cost})`;
          console.log(`✅ Using higher weight tier: ₦${cost}`);
        } else {
          eligible = false;
          reason = `No shipping rate available for weight ${weight}kg in your zone`;
          console.log('❌ No suitable weight range found');
        }
      } else {
        cost = weightRange.shippingCost;
        reason = `Weight-based rate for ${weight}kg (${weightRange.minWeight}-${weightRange.maxWeight}kg range)`;
        console.log(
          `✅ Weight range matched: ${weightRange.minWeight}-${weightRange.maxWeight}kg, cost: ₦${cost}`
        );
      }
      break;

    case 'pickup':
      console.log('🏪 Processing pickup method');
      const pickupConfig = this.pickup;
      cost = 0; // Always free for pickup

      // Check for zone-specific locations first
      const zoneLocations = pickupConfig.zoneLocations?.find(
        (zl) => zl.zone.toString() === zone.toString()
      );

      console.log(`Zone-specific locations found: ${!!zoneLocations}`);

      if (zoneLocations) {
        // Use zone-specific locations
        const activeLocations =
          zoneLocations.locations?.filter((loc) => loc.isActive !== false) ||
          [];

        console.log(`Active zone locations: ${activeLocations.length}`);

        if (activeLocations.length === 0) {
          eligible = false;
          reason = 'No active pickup locations in your zone';
          console.log('❌ No active locations in zone');
        } else {
          reason = `${activeLocations.length} pickup location(s) available in your zone`;
          console.log(
            `✅ ${activeLocations.length} pickup locations available`
          );
        }
      } else if (
        !pickupConfig.zoneLocations ||
        pickupConfig.zoneLocations.length === 0
      ) {
        console.log('Using default locations for all zones');
        // No zone-specific locations, use default for all zones
        const activeLocations =
          pickupConfig.defaultLocations?.filter(
            (loc) => loc.isActive !== false
          ) || [];

        console.log(`Active default locations: ${activeLocations.length}`);

        if (activeLocations.length === 0) {
          eligible = false;
          reason = 'No active pickup locations available';
          console.log('❌ No active default locations');
        } else {
          reason = `${activeLocations.length} pickup location(s) available`;
          console.log(
            `✅ ${activeLocations.length} default pickup locations available`
          );
        }
      } else {
        console.log(
          '❌ Zone-specific locations exist but this zone is not covered'
        );
        // Zone-specific locations exist but this zone is not covered
        eligible = false;
        reason = 'Pickup not available in your zone';
      }
      break;

    default:
      console.log(`❌ Invalid method type: ${this.type}`);
      eligible = false;
      reason = 'Invalid shipping method type';
  }

  const result = {
    eligible,
    cost: Math.round(cost * 100) / 100,
    reason,
    weightUsed: weight,
    orderValueUsed: orderValue,
    methodType: this.type,
  };

  console.log(`🧮 Calculation result:`, result);
  return result;
};

// FIXED: Enhanced method to check if method applies to specific products
shippingMethodSchema.methods.appliesToProducts = function (productIds) {
  const config = this[this.type];

  console.log(`🎯 Checking if method ${this.name} applies to products`);
  console.log(`Product IDs to check: ${productIds.length}`);

  if (!config) {
    console.log('✅ No config found, applying to all products');
    return true;
  }

  console.log(`Assignment type: ${config.assignment}`);
  console.log(`Assigned products count: ${config.products?.length || 0}`);

  // If assignment is all_products OR no specific assignment configured, apply to all
  if (
    config.assignment === 'all_products' ||
    (!config.assignment &&
      !config.categories?.length &&
      !config.products?.length)
  ) {
    console.log('✅ Applies to all products');
    return true;
  }

  if (config.assignment === 'specific_products') {
    // If no products specified, apply to all products
    if (!config.products || config.products.length === 0) {
      console.log('✅ No specific products assigned, applies to all');
      return true;
    }

    const matches = productIds.some((id) =>
      config.products.some(
        (productId) => productId.toString() === id.toString()
      )
    );

    console.log(`Product assignment match: ${matches}`);
    return matches;
  }

  console.log('❌ Does not apply based on product assignment');
  return false;
};

shippingMethodSchema.methods.appliesToCategories = function (categoryIds) {
  const config = this[this.type];

  console.log(`🎯 Checking if method ${this.name} applies to categories`);
  console.log(`Category IDs to check: ${categoryIds.length}`);

  if (!config) {
    console.log('✅ No config found, applying to all products');
    return true;
  }

  console.log(`Assignment type: ${config.assignment}`);
  console.log(`Assigned categories count: ${config.categories?.length || 0}`);

  // If assignment is all_products OR no specific assignment configured, apply to all
  if (
    config.assignment === 'all_products' ||
    (!config.assignment &&
      !config.categories?.length &&
      !config.products?.length)
  ) {
    console.log('✅ Applies to all products/categories');
    return true;
  }

  if (config.assignment === 'categories') {
    // If no categories specified, apply to all products
    if (!config.categories || config.categories.length === 0) {
      console.log('✅ No specific categories assigned, applies to all');
      return true;
    }

    const matches = categoryIds.some((id) =>
      config.categories.some((catId) => catId.toString() === id.toString())
    );

    console.log(`Category assignment match: ${matches}`);
    return matches;
  }

  console.log('❌ Does not apply based on category assignment');
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
  if (!this.isActive) {
    console.log(`Method ${this.name} is not active`);
    return false;
  }

  const zoneIdStr = zoneId.toString();
  console.log(
    `Checking if method ${this.name} (${this.type}) is available in zone ${zoneIdStr}`
  );

  switch (this.type) {
    case 'flat_rate':
      const flatConfig = this.flatRate;

      console.log(
        `Flat rate zone rates count: ${flatConfig.zoneRates?.length || 0}`
      );

      if (!flatConfig.zoneRates || flatConfig.zoneRates.length === 0) {
        console.log('✅ No zone-specific rates, available in all zones');
        return true; // Available in all zones when no zone-specific rates
      }

      const flatRateMatch = flatConfig.zoneRates.some((zr) => {
        const match = zr.zone.toString() === zoneIdStr;
        console.log(
          `Checking zone rate: ${zr.zone} === ${zoneIdStr} = ${match}`
        );
        return match;
      });

      console.log(`Flat rate zone match result: ${flatRateMatch}`);
      return flatRateMatch;

    case 'table_shipping':
      const tableConfig = this.tableShipping;

      console.log(
        `Table shipping zone rates count: ${tableConfig.zoneRates?.length || 0}`
      );

      if (!tableConfig.zoneRates || tableConfig.zoneRates.length === 0) {
        console.log('❌ Table shipping requires zone rates but none found');
        return false; // Table shipping requires zone rates
      }

      const tableShippingMatch = tableConfig.zoneRates.some((zr) => {
        const match = zr.zone.toString() === zoneIdStr;
        console.log(
          `Checking table zone rate: ${zr.zone} === ${zoneIdStr} = ${match}`
        );

        // Also check if zone has valid weight ranges
        if (match && (!zr.weightRanges || zr.weightRanges.length === 0)) {
          console.log('❌ Zone rate found but no weight ranges configured');
          return false;
        }

        return match;
      });

      console.log(`Table shipping zone match result: ${tableShippingMatch}`);
      return tableShippingMatch;

    case 'pickup':
      const pickupConfig = this.pickup;

      console.log(
        `Pickup zone locations count: ${
          pickupConfig.zoneLocations?.length || 0
        }`
      );
      console.log(
        `Pickup default locations count: ${
          pickupConfig.defaultLocations?.length || 0
        }`
      );

      if (
        !pickupConfig.zoneLocations ||
        pickupConfig.zoneLocations.length === 0
      ) {
        // No zone-specific locations, check if default locations exist
        const hasActiveDefaultLocations =
          pickupConfig.defaultLocations &&
          pickupConfig.defaultLocations.some((loc) => loc.isActive !== false);

        console.log(
          `Has active default locations: ${hasActiveDefaultLocations}`
        );
        return hasActiveDefaultLocations;
      }

      // Check if zone has specific locations
      const pickupZoneMatch = pickupConfig.zoneLocations.some((zl) => {
        const match = zl.zone.toString() === zoneIdStr;
        console.log(
          `Checking pickup zone location: ${zl.zone} === ${zoneIdStr} = ${match}`
        );

        if (match) {
          // Check if zone has active locations
          const hasActiveLocations =
            zl.locations && zl.locations.some((loc) => loc.isActive !== false);
          console.log(`Zone has active locations: ${hasActiveLocations}`);
          return hasActiveLocations;
        }

        return false;
      });

      console.log(`Pickup zone match result: ${pickupZoneMatch}`);
      return pickupZoneMatch;

    default:
      console.log(`❌ Unknown method type: ${this.type}`);
      return false;
  }
};
const ShippingMethodModel = mongoose.model(
  'ShippingMethod',
  shippingMethodSchema
);

export default ShippingMethodModel;
