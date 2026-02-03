// models/shipping-zone.model.js - FIXED VERSION
import mongoose from "mongoose";

const shippingZoneSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Zone name is required"],
      trim: true,
      unique: true,
    },
    code: {
      type: String,
      required: [true, "Zone code is required"],
      unique: true,
      uppercase: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    states: [
      {
        name: {
          type: String,
          required: true,
        },
        code: {
          type: String,
          required: true,
          uppercase: true,
        },
        coverage_type: {
          type: String,
          enum: ["all", "specific"],
          default: "all",
        },
        available_lgas: [String],
        covered_lgas: [String],
      },
    ],
    zone_type: {
      type: String,
      enum: ["urban", "rural", "mixed"],
      default: "mixed",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    operational_notes: {
      type: String,
      default: "",
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
shippingZoneSchema.index({ isActive: 1 });
shippingZoneSchema.index({ "states.name": 1 });

// Static method to find zone by state and LGA
shippingZoneSchema.statics.findZoneByCity = async function (
  city,
  state,
  lga = null,
) {
  const zones = await this.find({ isActive: true });

  for (const zone of zones) {
    const stateMatch = zone.states.find(
      (zoneState) =>
        zoneState.name.toLowerCase().trim() === state.toLowerCase().trim(),
    );

    if (stateMatch) {
      const isLocationCovered = zone.isLocationCovered(state, lga || city);
      if (isLocationCovered) {
        return zone;
      }
    }
  }

  return null;
};

// Instance method to check if location is covered
shippingZoneSchema.methods.isLocationCovered = function (state, lga) {
  const stateMatch = this.states.find(
    (zoneState) =>
      zoneState.name.toLowerCase().trim() === state.toLowerCase().trim(),
  );

  if (!stateMatch) {
    return false;
  }

  if (stateMatch.coverage_type === "all") {
    return true;
  }

  if (stateMatch.coverage_type === "specific") {
    if (!lga) {
      return false;
    }

    return stateMatch.covered_lgas?.some(
      (zoneLga) => zoneLga.toLowerCase().trim() === lga.toLowerCase().trim(),
    );
  }

  return false;
};

// Pre-save validation
shippingZoneSchema.pre("save", async function (next) {
  try {
    const { nigeriaStatesLgas } =
      await import("../data/nigeria-states-lgas.js");

    for (const state of this.states) {
      const nigeriaState = nigeriaStatesLgas.find(
        (ns) => ns.state.toLowerCase() === state.name.toLowerCase(),
      );

      if (!nigeriaState) {
        throw new Error(
          `Invalid state: ${state.name}. Must be a valid Nigerian state.`,
        );
      }

      // Validate covered LGAs if coverage is specific
      if (
        state.coverage_type === "specific" &&
        state.covered_lgas?.length > 0
      ) {
        for (const lga of state.covered_lgas) {
          const lgaExists = nigeriaState.lga.some(
            (nl) => nl.toLowerCase() === lga.toLowerCase(),
          );

          if (!lgaExists) {
            throw new Error(`Invalid LGA: ${lga} for state: ${state.name}`);
          }
        }
      }

      // Ensure available_lgas is populated
      if (!state.available_lgas || state.available_lgas.length === 0) {
        state.available_lgas = [...nigeriaState.lga];
      }
    }

    next();
  } catch (error) {
    next(error);
  }
});

const ShippingZoneModel = mongoose.model("ShippingZone", shippingZoneSchema);

export default ShippingZoneModel;
