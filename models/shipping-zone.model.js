// models/shipping-zone.model.js - FIXED VERSION with enhanced zone matching

import mongoose from 'mongoose';

const shippingZoneSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Zone name is required'],
      trim: true,
      unique: true,
    },
    code: {
      type: String,
      required: [true, 'Zone code is required'],
      unique: true,
      uppercase: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
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
        // Coverage type: 'all' means entire state, 'specific' means only certain LGAs
        coverage_type: {
          type: String,
          enum: ['all', 'specific'],
          default: 'all',
        },
        // All available LGAs in this state (for reference)
        available_lgas: [String],
        // LGAs covered by this zone (only used when coverage_type is 'specific')
        covered_lgas: [String],
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
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

// Indexes for better performance
shippingZoneSchema.index({ code: 1 });
shippingZoneSchema.index({ isActive: 1 });
shippingZoneSchema.index({ 'states.name': 1 });
shippingZoneSchema.index({ 'states.code': 1 });

// FIXED: Enhanced static method to find zone by state and city/LGA
shippingZoneSchema.statics.findZoneByCity = async function (
  city,
  state,
  lga = null
) {
  console.log(`🔍 Finding zone for: City=${city}, State=${state}, LGA=${lga}`);

  try {
    const zones = await this.find({ isActive: true });
    console.log(`Found ${zones.length} active zones to search`);

    for (const zone of zones) {
      console.log(`Checking zone: ${zone.name}`);

      // Find matching state in zone
      const stateMatch = zone.states.find(
        (zoneState) =>
          zoneState.name.toLowerCase().trim() === state.toLowerCase().trim()
      );

      if (stateMatch) {
        console.log(`State match found in zone ${zone.name}`);
        console.log(`Coverage type: ${stateMatch.coverage_type}`);

        // Check LGA coverage
        const isLocationCovered = zone.isLocationCovered(state, lga || city);

        if (isLocationCovered) {
          console.log(`✅ Location covered by zone: ${zone.name}`);
          return zone;
        } else {
          console.log(`❌ Location not covered by zone: ${zone.name}`);
        }
      }
    }

    console.log('❌ No matching zone found');
    return null;
  } catch (error) {
    console.error('Error finding zone by city:', error);
    return null;
  }
};

// FIXED: Enhanced static method to find zone by state only
shippingZoneSchema.statics.findZoneByState = async function (state) {
  console.log(`🔍 Finding zone for state: ${state}`);

  try {
    const zone = await this.findOne({
      isActive: true,
      'states.name': { $regex: new RegExp(`^${state}$`, 'i') },
    });

    if (zone) {
      console.log(`✅ Found zone by state: ${zone.name}`);
    } else {
      console.log(`❌ No zone found for state: ${state}`);
    }

    return zone;
  } catch (error) {
    console.error('Error finding zone by state:', error);
    return null;
  }
};

// FIXED: Enhanced instance method to check if location is covered
shippingZoneSchema.methods.isLocationCovered = function (state, lga) {
  console.log(`🔍 Checking coverage for: State=${state}, LGA=${lga}`);

  // Find the state in this zone
  const stateMatch = this.states.find(
    (zoneState) =>
      zoneState.name.toLowerCase().trim() === state.toLowerCase().trim()
  );

  if (!stateMatch) {
    console.log(`❌ State ${state} not found in zone ${this.name}`);
    return false;
  }

  console.log(
    `State found: ${stateMatch.name}, Coverage: ${stateMatch.coverage_type}`
  );

  // If coverage type is 'all', the entire state is covered
  if (stateMatch.coverage_type === 'all') {
    console.log('✅ Zone covers entire state');
    return true;
  }

  // If coverage type is 'specific', check if LGA is in covered list
  if (stateMatch.coverage_type === 'specific') {
    if (!lga) {
      console.log('❌ LGA required for specific coverage but not provided');
      return false;
    }

    const lgaCovered = stateMatch.covered_lgas?.some(
      (zoneLga) => zoneLga.toLowerCase().trim() === lga.toLowerCase().trim()
    );

    console.log(`LGA coverage check: ${lgaCovered}`);
    console.log('Covered LGAs:', stateMatch.covered_lgas);

    return lgaCovered;
  }

  // Fallback: check if LGA exists in available LGAs (for backward compatibility)
  if (lga && stateMatch.available_lgas?.length > 0) {
    const lgaExists = stateMatch.available_lgas.some(
      (zoneLga) => zoneLga.toLowerCase().trim() === lga.toLowerCase().trim()
    );

    console.log(`LGA exists in available list: ${lgaExists}`);
    return lgaExists;
  }

  console.log('❌ Unable to determine coverage');
  return false;
};

// Instance method to get coverage stats
shippingZoneSchema.methods.getCoverageStats = function () {
  let totalStates = this.states.length;
  let totalLgasCovered = 0;
  let statesWithFullCoverage = 0;

  this.states.forEach((state) => {
    if (state.coverage_type === 'all') {
      statesWithFullCoverage++;
      totalLgasCovered += state.available_lgas?.length || 0;
    } else {
      totalLgasCovered += state.covered_lgas?.length || 0;
    }
  });

  return {
    totalStates,
    statesWithFullCoverage,
    statesWithPartialCoverage: totalStates - statesWithFullCoverage,
    totalLgasCovered,
  };
};

// Virtual for coverage summary
shippingZoneSchema.virtual('coverageSummary').get(function () {
  const stats = this.getCoverageStats();
  return `${stats.totalStates} states, ${stats.totalLgasCovered} LGAs covered`;
});

// FIXED: Pre-save middleware to validate states against Nigeria data
shippingZoneSchema.pre('save', async function (next) {
  try {
    // Import Nigeria states data for validation
    const { nigeriaStatesLgas } = await import(
      '../data/nigeria-states-lgas.js'
    );

    // Validate each state in the zone
    for (const state of this.states) {
      const nigeriaState = nigeriaStatesLgas.find(
        (ns) => ns.state.toLowerCase() === state.name.toLowerCase()
      );

      if (!nigeriaState) {
        throw new Error(
          `Invalid state: ${state.name}. Must be a valid Nigerian state.`
        );
      }

      // Validate covered LGAs if coverage is specific
      if (
        state.coverage_type === 'specific' &&
        state.covered_lgas?.length > 0
      ) {
        for (const lga of state.covered_lgas) {
          const lgaExists = nigeriaState.lga.some(
            (nl) => nl.toLowerCase() === lga.toLowerCase()
          );

          if (!lgaExists) {
            throw new Error(`Invalid LGA: ${lga} for state: ${state.name}`);
          }
        }
      }

      // Ensure available_lgas is populated with actual data
      if (!state.available_lgas || state.available_lgas.length === 0) {
        state.available_lgas = [...nigeriaState.lga];
      }
    }

    next();
  } catch (error) {
    next(error);
  }
});

const ShippingZoneModel = mongoose.model('ShippingZone', shippingZoneSchema);

export default ShippingZoneModel;
