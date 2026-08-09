// models/shipping-zone.model.js - FIXED VERSION
//
// COUNTRY-SCOPED: this model carries the countryScopedPlugin (see
// core/countryScopedPlugin.js), so every zone belongs to exactly one
// country (countryCode, added by the plugin). A COUNTRY-scoped Logistics
// admin's queries are auto-filtered to their own assignedCountry — they
// can create/see/edit only their own country's zones, independently of
// every other country's Logistics admin. GLOBAL admins (IT/DIRECTOR) see
// and manage zones across every country.
import mongoose from "mongoose";
import countryScopedPlugin, { withLegacyFallback } from "../core/countryScopedPlugin.js";

const shippingZoneSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Zone name is required"],
      trim: true,
      // NOT globally unique any more — two different countries' Logistics
      // teams must be able to both create a zone named e.g. "Zone A"
      // independently. Uniqueness is enforced per-country below.
    },
    code: {
      type: String,
      required: [true, "Zone code is required"],
      uppercase: true,
      trim: true,
      // Same reasoning as `name` — unique per country, not globally.
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

// Country-scope this model: adds+indexes countryCode, auto-stamps new
// zones from the request context, and auto-filters every query for
// COUNTRY-scoped admins. See core/countryScopedPlugin.js.
shippingZoneSchema.plugin(countryScopedPlugin);

// Indexes
shippingZoneSchema.index({ isActive: 1 });
shippingZoneSchema.index({ "states.name": 1 });
// Per-country uniqueness (replaces the old globally-unique name/code) —
// Togo's Logistics admin and Benin's Logistics admin can each have their
// own "Zone A" / code "ZOA" without colliding.
shippingZoneSchema.index({ countryCode: 1, name: 1 }, { unique: true });
shippingZoneSchema.index({ countryCode: 1, code: 1 }, { unique: true });

// Static method to find zone by state and LGA. `countryCode` is now
// REQUIRED (not optional) — without it, two countries sharing a
// state/region name (e.g. Nigeria's "Plateau State" and Benin's "Plateau"
// department) would silently cross-match a customer's address to the
// wrong country's zone, at the wrong currency/cost. Every caller
// (checkout, bank-transfer, manual order shipping) now passes
// request.countryCode, resolved by the countryDetect middleware from the
// storefront domain.
shippingZoneSchema.statics.findZoneByCity = async function (
  city,
  state,
  lga = null,
  countryCode = null,
) {
  // HOTFIX (2026-08-09): withLegacyFallback matches both the given
  // countryCode AND documents that predate the countryCode field
  // entirely (a flat { countryCode } filter matched zero pre-existing
  // zones and broke checkout completely — see
  // core/countryScopedPlugin.js's own comment for the full story).
  const query = { isActive: true, ...(countryCode ? withLegacyFallback(countryCode) : {}) };
  const zones = await this.find(query);

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

// Pre-save validation — validated against THIS zone's own country, not
// hardcoded to Nigeria. Previously this always checked `state.name`
// against nigeria-states-lgas.js directly, which meant saving a Togo,
// Benin, or Italy zone always failed with "Must be a valid Nigerian
// state" even when every other layer (route, controller) was otherwise
// happy to create it for that country.
shippingZoneSchema.pre("save", async function (next) {
  try {
    const { getDivisionsForCountry } = await import(
      "../utils/countryGeoData.js"
    );
    const divisions = getDivisionsForCountry(this.countryCode);

    for (const state of this.states) {
      const match = divisions.find(
        (d) => d.state.toLowerCase() === state.name.toLowerCase(),
      );

      if (!match) {
        throw new Error(
          `Invalid state/region: ${state.name}. Must be a valid division of ${this.countryCode}.`,
        );
      }

      // Validate covered LGAs if coverage is specific
      if (
        state.coverage_type === "specific" &&
        state.covered_lgas?.length > 0
      ) {
        for (const lga of state.covered_lgas) {
          const lgaExists = match.lga.some(
            (nl) => nl.toLowerCase() === lga.toLowerCase(),
          );

          if (!lgaExists) {
            throw new Error(`Invalid LGA/prefecture: ${lga} for state: ${state.name}`);
          }
        }
      }

      // Ensure available_lgas is populated
      if (!state.available_lgas || state.available_lgas.length === 0) {
        state.available_lgas = [...match.lga];
      }
    }

    next();
  } catch (error) {
    next(error);
  }
});

const ShippingZoneModel = mongoose.model("ShippingZone", shippingZoneSchema);

export default ShippingZoneModel;
