// models/shippingMethod.model.js - FIXED VERSION with enhanced assignment logic
//
// COUNTRY-SCOPED: this model carries the countryScopedPlugin (see
// core/countryScopedPlugin.js), so every method belongs to exactly one
// country. A COUNTRY-scoped Logistics admin's queries are auto-filtered to
// their own assignedCountry — they can create/see/edit only their own
// country's methods, independently of every other country's Logistics
// admin. GLOBAL admins (IT/DIRECTOR) see and manage methods across every
// country.
import mongoose from "mongoose";
import countryScopedPlugin from "../core/countryScopedPlugin.js";

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
      uppercase: true,
      trim: true,
      // NOT globally unique any more — unique per country (see the
      // compound index below), so two countries can each have a method
      // coded e.g. "STD" independently.
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
            // When true, this zone rate is hidden from checkout entirely
            // (not just charged normally) for orders under the minimum -
            // forcing the customer to pick a different shipping method.
            hideWhenBelowMinimum: { type: Boolean, default: false },
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
        // Same idea as above, for the method-wide (non zone-specific) threshold.
        hideWhenBelowMinimum: { type: Boolean, default: false },
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
              // Base carrier/handling cost for this weight band, before
              // markup.
              baseCost: { type: Number, required: true, default: 0 },
              // "Store-up" — a stock/inventory markup layered on top of
              // baseCost for this weight band (e.g. 10 means +10%).
              // Lets Logistics account for warehousing/handling overhead
              // per weight tier without hand-computing it into baseCost.
              stockMarkupPercent: { type: Number, default: 0, min: 0 },
              // shippingCost is the FINAL customer-facing cost
              // (baseCost + baseCost * stockMarkupPercent / 100). Kept as
              // its own stored field — NOT auto-recomputed on save — so
              // existing callers of calculateShippingCost() (checkout,
              // manual orders) and existing documents that only ever set
              // shippingCost directly (baseCost/stockMarkupPercent = 0)
              // keep working unchanged. Callers that DO want the markup
              // applied (e.g. the Togo seed script, or a future admin-UI
              // rate form) must compute
              // shippingCost = baseCost * (1 + stockMarkupPercent / 100)
              // themselves before saving.
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

// Country-scope this model: adds+indexes countryCode, auto-stamps new
// methods from the request context, and auto-filters every query for
// COUNTRY-scoped admins. See core/countryScopedPlugin.js.
shippingMethodSchema.plugin(countryScopedPlugin);

// Indexes
shippingMethodSchema.index({ type: 1 });
shippingMethodSchema.index({ isActive: 1 });
shippingMethodSchema.index({ sortOrder: 1 });
// Per-country uniqueness (replaces the old globally-unique code) — Togo's
// Logistics admin and Benin's Logistics admin can each have their own
// method coded e.g. "STD" without colliding.
shippingMethodSchema.index({ countryCode: 1, code: 1 }, { unique: true });

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
      let matchedZoneRate = null;

      console.log(`💵 Flat rate base cost: ${baseCost}`);
      console.log(`[SHIP-DEBUG][${this.name}] calculateShippingCost called with:`, {
        zoneParam: zone ? zone.toString() : "none",
        orderValue,
        configuredZoneRateCount: config.zoneRates?.length || 0,
        configuredZoneIds: (config.zoneRates || []).map((zr) =>
          zr.zone ? zr.zone.toString() : "MISSING",
        ),
      });

      // Check for zone-specific rate
      if (zone && config.zoneRates?.length > 0) {
        matchedZoneRate = config.zoneRates.find(
          (zr) => zr.zone && zr.zone.toString() === zone.toString(),
        );
        if (matchedZoneRate) {
          baseCost = matchedZoneRate.cost;
          console.log(`💵 Using zone-specific rate: ${baseCost}`);
          console.log(
            `[SHIP-DEBUG][${this.name}] Matched zone rate:`,
            {
              zoneId: matchedZoneRate.zone.toString(),
              cost: matchedZoneRate.cost,
              freeShipping: matchedZoneRate.freeShipping,
            },
          );
        } else {
          console.log(
            `[SHIP-DEBUG][${this.name}] ⚠️ No zone rate matches zone "${zone.toString()}" ` +
              `- none of the configured zone IDs above matched it. Falling back to baseCost=${baseCost} ` +
              `and ALL zone-specific free-shipping/hide rules will be skipped.`,
          );
        }
      } else if (!zone) {
        console.log(
          `[SHIP-DEBUG][${this.name}] ⚠️ No zone was passed in at all - checkout couldn't resolve ` +
            `a shipping zone for this address, so zone-specific rates/rules never get checked.`,
        );
      }

      // Zone-specific free shipping threshold takes precedence over the
      // method-wide one when this zone has its own rate configured.
      const zoneFreeShipping = matchedZoneRate?.freeShipping;
      if (zoneFreeShipping?.enabled) {
        const qualifies = orderValue >= zoneFreeShipping.minimumOrderAmount;
        console.log(
          `[SHIP-DEBUG][${this.name}] Zone-specific free shipping check:`,
          {
            enabled: zoneFreeShipping.enabled,
            minimumOrderAmount: zoneFreeShipping.minimumOrderAmount,
            orderValue,
            qualifies,
            hideWhenBelowMinimum: zoneFreeShipping.hideWhenBelowMinimum,
          },
        );

        if (qualifies) {
          return {
            eligible: true,
            cost: 0,
            reason: `Free shipping for this zone (order over ${zoneFreeShipping.minimumOrderAmount})`,
          };
        }

        if (zoneFreeShipping.hideWhenBelowMinimum) {
          // Method is hidden entirely (not charged) until the threshold is met.
          console.log(
            `[SHIP-DEBUG][${this.name}] ✅ Returning eligible:false (zone-specific hide rule)`,
          );
          return {
            eligible: false,
            cost: 0,
            reason: `Only available for orders over ${zoneFreeShipping.minimumOrderAmount} in this zone`,
          };
        }
        // Otherwise fall through: charge the normal zone cost below threshold.
      }

      // Method-wide free shipping threshold (independent of the zone-specific one above)
      const globalFreeShipping = config.freeShipping;
      if (globalFreeShipping?.enabled) {
        const qualifies = orderValue >= globalFreeShipping.minimumOrderAmount;
        console.log(
          `[SHIP-DEBUG][${this.name}] Method-wide free shipping check:`,
          {
            enabled: globalFreeShipping.enabled,
            minimumOrderAmount: globalFreeShipping.minimumOrderAmount,
            orderValue,
            qualifies,
            hideWhenBelowMinimum: globalFreeShipping.hideWhenBelowMinimum,
          },
        );

        if (qualifies) {
          return {
            eligible: true,
            cost: 0,
            reason: `Free shipping (order over ${globalFreeShipping.minimumOrderAmount})`,
          };
        }

        if (globalFreeShipping.hideWhenBelowMinimum) {
          console.log(
            `[SHIP-DEBUG][${this.name}] ✅ Returning eligible:false (method-wide hide rule)`,
          );
          return {
            eligible: false,
            cost: 0,
            reason: `Only available for orders over ${globalFreeShipping.minimumOrderAmount}`,
          };
        }
        // Otherwise fall through: charge the normal cost below threshold.
      }

      console.log(
        `[SHIP-DEBUG][${this.name}] Falling through to base cost: ${baseCost} ` +
          `(no free-shipping rule matched/qualified)`,
      );

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
