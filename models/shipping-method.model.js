// models/shippingMethod.model.js - FIXED VERSION with enhanced assignment logic
import mongoose from "mongoose";

const shippingMethodSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Shipping method name is required"],
      trim: true,
    },
    code: {
      type: String,
      required: [true, "Shipping method code is required"],
      unique: true,
      uppercase: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    type: {
      type: String,
      enum: ["flat_rate", "table_shipping", "pickup"],
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
      zoneRates: [
        {
          zone: {
            type: mongoose.Schema.ObjectId,
            ref: "ShippingZone",
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
      defaultCost: {
        type: Number,
        default: 0,
      },
      assignment: {
        type: String,
        enum: ["all_products", "categories", "specific_products"],
        default: "all_products",
      },
      categories: [
        {
          type: mongoose.Schema.ObjectId,
          ref: "Category",
        },
      ],
      products: [
        {
          type: mongoose.Schema.ObjectId,
          ref: "Product",
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
        enum: ["all_products", "categories", "specific_products"],
        default: "all_products",
      },
      categories: [
        {
          type: mongoose.Schema.ObjectId,
          ref: "Category",
        },
      ],
      products: [
        {
          type: mongoose.Schema.ObjectId,
          ref: "Product",
        },
      ],
      zoneRates: [
        {
          zone: {
            type: mongoose.Schema.ObjectId,
            ref: "ShippingZone",
            required: true,
          },
          weightRanges: [
            {
              minWeight: { type: Number, required: true },
              maxWeight: { type: Number, required: true },
              shippingCost: { type: Number, required: true },
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
      zoneLocations: [
        {
          zone: {
            type: mongoose.Schema.ObjectId,
            ref: "ShippingZone",
            required: true,
          },
          locations: [
            {
              name: { type: String, required: true },
              address: { type: String, required: true },
              city: { type: String, required: true },
              state: { type: String, required: true },
              lga: { type: String, required: true },
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
              isActive: { type: Boolean, default: true },
            },
          ],
        },
      ],
      defaultLocations: [
        {
          name: { type: String, required: true },
          address: { type: String, required: true },
          city: { type: String, required: true },
          state: { type: String, required: true },
          lga: { type: String, required: true },
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
          isActive: { type: Boolean, default: true },
        },
      ],
      cost: {
        type: Number,
        default: 0,
      },
      assignment: {
        type: String,
        enum: ["all_products", "categories", "specific_products"],
        default: "all_products",
      },
      categories: [
        {
          type: mongoose.Schema.ObjectId,
          ref: "Category",
        },
      ],
      products: [
        {
          type: mongoose.Schema.ObjectId,
          ref: "Product",
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
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
shippingMethodSchema.index({ type: 1 });
shippingMethodSchema.index({ isActive: 1 });
shippingMethodSchema.index({ sortOrder: 1 });

// Check if method is currently valid
shippingMethodSchema.methods.isCurrentlyValid = function () {
  const now = new Date();

  // Get the correct config based on type
  const configKeyMap = {
    flat_rate: "flatRate",
    table_shipping: "tableShipping",
    pickup: "pickup",
  };

  const configKey = configKeyMap[this.type];
  const config = this[configKey];

  if (!config) return true; // If no config, consider it valid

  if (config.validFrom && now < config.validFrom) {
    return false;
  }

  if (config.validUntil && now > config.validUntil) {
    return false;
  }

  return true;
};

// Get assignment display text
shippingMethodSchema.methods.getAssignmentDisplay = function () {
  const configKeyMap = {
    flat_rate: "flatRate",
    table_shipping: "tableShipping",
    pickup: "pickup",
  };

  const configKey = configKeyMap[this.type];
  const config = this[configKey];

  if (!config) return "All Products";

  switch (config.assignment) {
    case "all_products":
      return "All Products";
    case "categories":
      return `Categories (${config.categories?.length || 0})`;
    case "specific_products":
      return `Products (${config.products?.length || 0})`;
    default:
      return "All Products";
  }
};

// ✅ KEEP ONLY THIS ONE - Enhanced calculateShippingCost method
shippingMethodSchema.methods.calculateShippingCost = function ({
  weight,
  orderValue,
  zone,
  items = [],
}) {
  // CRITICAL FIX: Map type to correct config key
  const configKeyMap = {
    flat_rate: "flatRate",
    table_shipping: "tableShipping",
    pickup: "pickup",
  };

  const configKey = configKeyMap[this.type] || this.type;
  const config = this[configKey];

  console.log(`💰 calculateShippingCost called for ${this.name}`);
  console.log(
    `Type: ${this.type}, Config Key: ${configKey}, Has Config: ${!!config}`,
  );

  if (!config) {
    console.log("❌ No config found!");
    return {
      eligible: false,
      cost: 0,
      reason: "Invalid method configuration",
    };
  }

  try {
    // PICKUP METHOD
    if (this.type === "pickup") {
      const hasDefaultLocations = config.defaultLocations?.length > 0;
      const hasZoneLocations = config.zoneLocations?.length > 0;

      if (hasDefaultLocations || hasZoneLocations) {
        return {
          eligible: true,
          cost: config.cost || 0,
          reason: "Free pickup available",
        };
      }

      return {
        eligible: false,
        cost: 0,
        reason: "No pickup locations available",
      };
    }

    // FLAT_RATE METHOD
    if (this.type === "flat_rate") {
      let baseCost = config.defaultCost || config.cost || 0;

      console.log(`💵 Flat rate base cost: ${baseCost}`);

      // Check for zone-specific rate
      if (zone && config.zoneRates?.length > 0) {
        const zoneRate = config.zoneRates.find(
          (zr) => zr.zone && zr.zone.toString() === zone.toString(),
        );
        if (zoneRate) {
          baseCost = zoneRate.cost;
          console.log(`💵 Using zone-specific rate: ${baseCost}`);
        }
      }

      // Check free shipping threshold
      if (
        config.freeShipping?.enabled &&
        orderValue >= config.freeShipping.minimumOrderAmount
      ) {
        return {
          eligible: true,
          cost: 0,
          reason: `Free shipping (order over ${config.freeShipping.minimumOrderAmount})`,
        };
      }

      return {
        eligible: true,
        cost: baseCost,
        reason:
          baseCost === 0 ? "Free flat rate shipping" : "Flat rate shipping",
      };
    }

    // TABLE_SHIPPING METHOD
    if (this.type === "table_shipping") {
      console.log(`📊 Table shipping - checking zone: ${zone}`);

      if (!zone) {
        return {
          eligible: false,
          cost: 0,
          reason: "Zone required for table shipping",
        };
      }

      // Find zone rate configuration
      const zoneRate = config.zoneRates?.find(
        (zr) => zr.zone && zr.zone.toString() === zone.toString(),
      );

      console.log(`Zone rate found: ${!!zoneRate}`);

      if (!zoneRate || !zoneRate.weightRanges?.length) {
        return {
          eligible: false,
          cost: 0,
          reason: "No shipping rates configured for this zone",
        };
      }

      // Find matching weight range
      console.log(`Looking for weight range for ${weight}kg`);
      const weightRange = zoneRate.weightRanges.find(
        (wr) => weight >= wr.minWeight && weight <= wr.maxWeight,
      );

      if (!weightRange) {
        console.log(`❌ No weight range found for ${weight}kg`);
        return {
          eligible: false,
          cost: 0,
          reason: `No shipping rate for weight ${weight}kg`,
        };
      }

      console.log(
        `✅ Found weight range: ${weightRange.minWeight}-${weightRange.maxWeight}kg = ${weightRange.shippingCost}`,
      );

      return {
        eligible: true,
        cost: weightRange.shippingCost,
        reason: `Table rate for ${weight}kg`,
      };
    }

    return {
      eligible: false,
      cost: 0,
      reason: "Unknown shipping method type",
    };
  } catch (error) {
    console.error("Error calculating shipping cost:", error);
    return {
      eligible: false,
      cost: 0,
      reason: "Error calculating shipping cost",
    };
  }
};

// Enhanced method to check if method applies to specific products
shippingMethodSchema.methods.appliesToProducts = function (productIds) {
  const configKeyMap = {
    flat_rate: "flatRate",
    table_shipping: "tableShipping",
    pickup: "pickup",
  };

  const configKey = configKeyMap[this.type];
  const config = this[configKey];

  if (!config) {
    return true;
  }

  if (
    config.assignment === "all_products" ||
    (!config.assignment &&
      !config.categories?.length &&
      !config.products?.length)
  ) {
    return true;
  }

  if (config.assignment === "specific_products") {
    if (!config.products || config.products.length === 0) {
      return true;
    }

    return productIds.some((id) =>
      config.products.some(
        (productId) => productId.toString() === id.toString(),
      ),
    );
  }

  return false;
};

// Enhanced method to check if method applies to categories
shippingMethodSchema.methods.appliesToCategories = function (categoryIds) {
  const configKeyMap = {
    flat_rate: "flatRate",
    table_shipping: "tableShipping",
    pickup: "pickup",
  };

  const configKey = configKeyMap[this.type];
  const config = this[configKey];

  if (!config) {
    return true;
  }

  if (
    config.assignment === "all_products" ||
    (!config.assignment &&
      !config.categories?.length &&
      !config.products?.length)
  ) {
    return true;
  }

  if (config.assignment === "categories") {
    if (!config.categories || config.categories.length === 0) {
      return true;
    }
    return categoryIds.some((id) =>
      config.categories.some((catId) => catId.toString() === id.toString()),
    );
  }

  return false;
};

// Get pickup locations for a specific zone
shippingMethodSchema.methods.getPickupLocationsForZone = function (zoneId) {
  if (this.type !== "pickup") {
    return [];
  }

  const config = this.pickup;
  if (!config) {
    return [];
  }

  const locations = [];

  if (zoneId && config.zoneLocations?.length > 0) {
    const zoneLocation = config.zoneLocations.find(
      (zl) => zl.zone && zl.zone.toString() === zoneId.toString(),
    );

    if (zoneLocation?.locations?.length > 0) {
      locations.push(...zoneLocation.locations);
    }
  }

  if (config.defaultLocations?.length > 0) {
    locations.push(...config.defaultLocations);
  }

  return locations;
};

// Enhanced method to check if method is available in a specific zone
shippingMethodSchema.methods.isAvailableInZone = function (zoneId) {
  const configKeyMap = {
    flat_rate: "flatRate",
    table_shipping: "tableShipping",
    pickup: "pickup",
  };

  const configKey = configKeyMap[this.type] || this.type;
  const config = this[configKey];

  if (!config) {
    return false;
  }

  if (this.type === "pickup") {
    const hasDefaultLocations = config.defaultLocations?.length > 0;
    const hasZoneLocations = config.zoneLocations?.length > 0;

    if (hasDefaultLocations) {
      return true;
    }

    if (hasZoneLocations && zoneId) {
      const zoneLocation = config.zoneLocations.find(
        (zl) => zl.zone && zl.zone.toString() === zoneId.toString(),
      );
      return zoneLocation && zoneLocation.locations?.length > 0;
    }

    return false;
  }

  if (this.type === "flat_rate") {
    if (!zoneId) return false;

    const hasZoneRate = config.zoneRates?.some(
      (zr) => zr.zone && zr.zone.toString() === zoneId.toString(),
    );

    const hasDefaultCost =
      config.defaultCost !== undefined && config.defaultCost !== null;

    return hasZoneRate || hasDefaultCost;
  }

  if (this.type === "table_shipping") {
    if (!zoneId) return false;

    return config.zoneRates?.some(
      (zr) => zr.zone && zr.zone.toString() === zoneId.toString(),
    );
  }

  return false;
};

const ShippingMethodModel = mongoose.model(
  "ShippingMethod",
  shippingMethodSchema,
);

export default ShippingMethodModel;
