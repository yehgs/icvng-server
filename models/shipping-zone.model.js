import mongoose from 'mongoose';
import { nigeriaStatesLgas } from '../data/nigeria-states-lgas.js';

const shippingZoneSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Zone name is required'],
      unique: true,
      trim: true,
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

    // Enhanced Nigerian states structure with LGA coverage options
    states: [
      {
        name: {
          type: String,
          required: true,
          trim: true,
        },
        code: {
          type: String,
          required: true,
          uppercase: true,
          trim: true,
          maxlength: 3,
        },
        capital: {
          type: String,
          required: true,
          trim: true,
        },

        // Coverage type: 'all' means all LGAs, 'specific' means selected LGAs only
        coverage_type: {
          type: String,
          enum: ['all', 'specific'],
          default: 'all',
        },

        // All available LGAs in this state (for reference)
        available_lgas: [
          {
            name: {
              type: String,
              required: true,
              trim: true,
            },
            major_towns: [String],
            postal_codes: [String],
          },
        ],

        // Covered LGAs (only used when coverage_type is 'specific')
        covered_lgas: [
          {
            name: {
              type: String,
              required: true,
              trim: true,
            },
            major_towns: [String],
            postal_codes: [String],
            // Individual LGA settings
            delivery_options: {
              standard_delivery: {
                available: { type: Boolean, default: true },
                estimated_days: { type: Number, default: 3 },
              },
              express_delivery: {
                available: { type: Boolean, default: false },
                estimated_days: { type: Number, default: 1 },
              },
            },
            special_requirements: [String],
          },
        ],

        // Geographic region (North, South, etc.)
        geopolitical_zone: {
          type: String,
          enum: [
            'North Central',
            'North East',
            'North West',
            'South East',
            'South South',
            'South West',
          ],
          required: true,
        },

        // Additional state metadata
        population: {
          type: Number,
          default: 0,
        },
        description: {
          type: String,
          default: '',
        },
      },
    ],

    // Zone characteristics
    zone_type: {
      type: String,
      enum: ['urban', 'rural', 'mixed'],
      default: 'mixed',
    },

    // Operational status
    isActive: {
      type: Boolean,
      default: true,
    },

    // Priority for shipping operations
    priority: {
      type: String,
      enum: ['high', 'medium', 'low'],
      default: 'medium',
    },

    // Sort order for admin display
    sortOrder: {
      type: Number,
      default: 0,
    },

    // Delivery capabilities
    delivery_options: {
      standard_delivery: {
        available: { type: Boolean, default: true },
        estimated_days: { type: Number, default: 3 },
      },
      express_delivery: {
        available: { type: Boolean, default: false },
        estimated_days: { type: Number, default: 1 },
      },
      pickup_points: {
        available: { type: Boolean, default: false },
        locations: [
          {
            name: String,
            address: String,
            lga: String,
            state: String,
            contact: String,
            operating_hours: String,
          },
        ],
      },
    },

    // Geographic and operational metadata
    coverage_area_km2: {
      type: Number,
      default: 0,
    },

    population_estimate: {
      type: Number,
      default: 0,
    },

    // Special handling requirements
    special_requirements: [
      {
        type: String,
        enum: [
          'cold_chain',
          'fragile_handling',
          'high_security',
          'bulk_delivery',
        ],
      },
    ],

    // Operational notes
    operational_notes: {
      type: String,
      maxlength: 1000,
      default: '',
    },

    // User tracking
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
shippingZoneSchema.index({ name: 1 });
shippingZoneSchema.index({ code: 1 });
shippingZoneSchema.index({ 'states.name': 1 });
shippingZoneSchema.index({ 'states.code': 1 });
shippingZoneSchema.index({ 'states.covered_lgas.name': 1 });
shippingZoneSchema.index({ 'states.available_lgas.name': 1 });
shippingZoneSchema.index({ 'states.geopolitical_zone': 1 });
shippingZoneSchema.index({ isActive: 1, priority: 1 });
shippingZoneSchema.index({ sortOrder: 1 });

// Static method to find zone by state name
shippingZoneSchema.statics.findZoneByState = function (stateName) {
  return this.findOne({
    'states.name': { $regex: new RegExp(`^${stateName}$`, 'i') },
    isActive: true,
  }).populate('createdBy updatedBy', 'name email');
};

// Static method to find zone by LGA with coverage check
shippingZoneSchema.statics.findZoneByLGA = function (
  lgaName,
  stateName = null
) {
  const query = {
    isActive: true,
    $or: [
      // Check if state has 'all' coverage
      {
        'states.coverage_type': 'all',
        'states.available_lgas.name': {
          $regex: new RegExp(`^${lgaName}$`, 'i'),
        },
      },
      // Check if LGA is specifically covered
      {
        'states.coverage_type': 'specific',
        'states.covered_lgas.name': { $regex: new RegExp(`^${lgaName}$`, 'i') },
      },
    ],
  };

  if (stateName) {
    query['states.name'] = { $regex: new RegExp(`^${stateName}$`, 'i') };
  }

  return this.findOne(query);
};

// Static method to find zone by city (checks LGA and major towns) with coverage
shippingZoneSchema.statics.findZoneByCity = function (
  cityName,
  stateName = null
) {
  const query = {
    isActive: true,
    $or: [
      // Check if state has 'all' coverage
      {
        'states.coverage_type': 'all',
        $or: [
          {
            'states.available_lgas.name': { $regex: new RegExp(cityName, 'i') },
          },
          {
            'states.available_lgas.major_towns': {
              $regex: new RegExp(cityName, 'i'),
            },
          },
        ],
      },
      // Check if city is in specifically covered LGAs
      {
        'states.coverage_type': 'specific',
        $or: [
          { 'states.covered_lgas.name': { $regex: new RegExp(cityName, 'i') } },
          {
            'states.covered_lgas.major_towns': {
              $regex: new RegExp(cityName, 'i'),
            },
          },
        ],
      },
    ],
  };

  if (stateName) {
    query['states.name'] = { $regex: new RegExp(`^${stateName}$`, 'i') };
  }

  return this.findOne(query);
};

// Instance method to add Nigerian state with LGA options
shippingZoneSchema.methods.addNigerianState = async function (stateData) {
  try {
    // Validate state exists in local data
    const stateInfo = nigeriaStatesLgas.find(
      (state) => state.state.toLowerCase() === stateData.name.toLowerCase()
    );

    if (!stateInfo) {
      throw new Error(
        `State ${stateData.name} not found in Nigerian states data`
      );
    }

    // Build available LGAs array
    const availableLgas = stateInfo.lga.map((lgaName) => ({
      name: lgaName,
      major_towns: [lgaName], // Default to LGA name, can be enhanced
      postal_codes: [], // You can populate this with actual postal codes
    }));

    // Build covered LGAs array (if specific coverage)
    let coveredLgas = [];
    if (stateData.coverage_type === 'specific' && stateData.covered_lgas) {
      coveredLgas = stateData.covered_lgas.map((lgaName) => {
        const availableLga = availableLgas.find(
          (lga) => lga.name.toLowerCase() === lgaName.toLowerCase()
        );

        if (!availableLga) {
          throw new Error(
            `LGA ${lgaName} not found in ${stateData.name} state`
          );
        }

        return {
          name: availableLga.name,
          major_towns: availableLga.major_towns,
          postal_codes: availableLga.postal_codes,
          delivery_options: {
            standard_delivery: {
              available: true,
              estimated_days: 3,
            },
            express_delivery: {
              available: false,
              estimated_days: 1,
            },
          },
          special_requirements: [],
        };
      });
    }

    // Add state to zone
    const newState = {
      name: stateInfo.state,
      code: stateInfo.state.substring(0, 2).toUpperCase(),
      capital: stateInfo.capital,
      coverage_type: stateData.coverage_type || 'all',
      available_lgas: availableLgas,
      covered_lgas: coveredLgas,
      geopolitical_zone: stateInfo.region,
      population: stateInfo.population,
      description: stateInfo.description || '',
    };

    // Check if state already exists
    const existingState = this.states.find(
      (s) => s.name.toLowerCase() === newState.name.toLowerCase()
    );

    if (existingState) {
      throw new Error(`State ${newState.name} already exists in this zone`);
    }

    this.states.push(newState);
    await this.save();

    return newState;
  } catch (error) {
    throw new Error(`Failed to add state: ${error.message}`);
  }
};

// Instance method to update state LGA coverage
shippingZoneSchema.methods.updateStateCoverage = async function (
  stateName,
  coverageType,
  coveredLgas = []
) {
  try {
    const state = this.states.find(
      (s) => s.name.toLowerCase() === stateName.toLowerCase()
    );

    if (!state) {
      throw new Error(`State ${stateName} not found in this zone`);
    }

    state.coverage_type = coverageType;

    if (coverageType === 'specific') {
      // Validate all specified LGAs exist in available_lgas
      const validLgas = coveredLgas.map((lgaName) => {
        const availableLga = state.available_lgas.find(
          (lga) => lga.name.toLowerCase() === lgaName.toLowerCase()
        );

        if (!availableLga) {
          throw new Error(`LGA ${lgaName} not found in ${stateName} state`);
        }

        return {
          name: availableLga.name,
          major_towns: availableLga.major_towns,
          postal_codes: availableLga.postal_codes,
          delivery_options: {
            standard_delivery: {
              available: true,
              estimated_days: 3,
            },
            express_delivery: {
              available: false,
              estimated_days: 1,
            },
          },
          special_requirements: [],
        };
      });

      state.covered_lgas = validLgas;
    } else {
      // Clear covered_lgas for 'all' coverage
      state.covered_lgas = [];
    }

    await this.save();
    return state;
  } catch (error) {
    throw new Error(`Failed to update state coverage: ${error.message}`);
  }
};

// Instance method to check if location is covered
shippingZoneSchema.methods.isLocationCovered = function (stateName, lgaName) {
  const state = this.states.find(
    (s) => s.name.toLowerCase() === stateName.toLowerCase()
  );

  if (!state) {
    return false;
  }

  if (state.coverage_type === 'all') {
    // Check if LGA exists in available_lgas
    return state.available_lgas.some(
      (lga) => lga.name.toLowerCase() === lgaName.toLowerCase()
    );
  } else {
    // Check if LGA exists in covered_lgas
    return state.covered_lgas.some(
      (lga) => lga.name.toLowerCase() === lgaName.toLowerCase()
    );
  }
};

// Instance method to get delivery options for a location
shippingZoneSchema.methods.getDeliveryOptions = function (stateName, lgaName) {
  const state = this.states.find(
    (s) => s.name.toLowerCase() === stateName.toLowerCase()
  );

  if (!state) {
    return null;
  }

  if (!this.isLocationCovered(stateName, lgaName)) {
    return null;
  }

  let lgaDeliveryOptions = this.delivery_options; // Default zone options

  // If specific coverage, get LGA-specific options
  if (state.coverage_type === 'specific') {
    const coveredLga = state.covered_lgas.find(
      (lga) => lga.name.toLowerCase() === lgaName.toLowerCase()
    );

    if (coveredLga && coveredLga.delivery_options) {
      lgaDeliveryOptions = coveredLga.delivery_options;
    }
  }

  return {
    zone: {
      name: this.name,
      code: this.code,
    },
    state: {
      name: state.name,
      capital: state.capital,
      geopolitical_zone: state.geopolitical_zone,
      coverage_type: state.coverage_type,
    },
    lga: {
      name: lgaName,
    },
    delivery_options: lgaDeliveryOptions,
    special_requirements: this.special_requirements,
  };
};

// Virtual for total LGA coverage count
shippingZoneSchema.virtual('total_lgas_covered').get(function () {
  return this.states.reduce((sum, state) => {
    if (state.coverage_type === 'all') {
      return sum + state.available_lgas.length;
    } else {
      return sum + state.covered_lgas.length;
    }
  }, 0);
});

// Virtual for geopolitical zones covered
shippingZoneSchema.virtual('geopolitical_zones_covered').get(function () {
  return [...new Set(this.states.map((s) => s.geopolitical_zone))];
});

shippingZoneSchema.statics.findZoneByCity = async function (city, state) {
  try {
    console.log(`Looking for zone covering city: ${city}, state: ${state}`);

    // Get all active zones to debug
    const allZones = await this.find({ isActive: true });
    console.log(
      `Found ${allZones.length} active zones:`,
      allZones.map((z) => z.name)
    );

    // Since your pickup method uses defaultLocations (no zones),
    // it should work regardless of zone coverage
    // But let's see if there are any zones that could match Lagos

    for (const zone of allZones) {
      console.log(`Checking zone: ${zone.name}`);
      console.log('Zone states:', zone.states);

      // Check if state matches
      const stateMatch = zone.states.find(
        (s) =>
          s.name.toLowerCase().includes(state.toLowerCase()) ||
          state.toLowerCase().includes(s.name.toLowerCase())
      );

      if (stateMatch) {
        console.log(`State match found in zone ${zone.name}:`, stateMatch);

        // Check LGA coverage
        if (stateMatch.coverage_type === 'all') {
          console.log('Zone covers all LGAs in state');
          return zone;
        } else if (stateMatch.coverage_type === 'specific') {
          // Check specific LGA coverage if needed
          console.log('Zone has specific LGA coverage');
          return zone;
        }
      }
    }

    console.log('No matching zone found');
    return null;
  } catch (error) {
    console.error('Error in findZoneByCity:', error);
    return null;
  }
};

// Test function to check zone lookup
export const testZoneLookup = async (request, response) => {
  try {
    const { city = 'Lagos', state = 'Lagos' } = request.query;

    console.log(`Testing zone lookup for: ${city}, ${state}`);

    const zone = await ShippingZoneModel.findZoneByCity(city, state);

    return response.json({
      success: true,
      data: {
        searchCriteria: { city, state },
        foundZone: zone
          ? {
              id: zone._id,
              name: zone.name,
              code: zone.code,
              states: zone.states,
            }
          : null,
      },
    });
  } catch (error) {
    return response.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

const ShippingZoneModel = mongoose.model('ShippingZone', shippingZoneSchema);

export default ShippingZoneModel;
