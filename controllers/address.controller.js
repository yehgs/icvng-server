// controllers/address.controller.js - Enhanced with Nigerian address validation using local data
import AddressModel from '../models/address.model.js';
import UserModel from '../models/user.model.js';
import ShippingZoneModel from '../models/shipping-zone.model.js';
import { nigeriaStatesLgas } from '../data/nigeria-states-lgas.js';

// Helper function to get Nigerian states and LGAs using local data
export const getNigerianLocationData = async (request, response) => {
  try {
    const { type, state } = request.query;   

    switch (type) {
      case 'states':
        const states = nigeriaStatesLgas.map((stateInfo) => ({
          name: stateInfo.state,
          capital: stateInfo.capital,
          code: stateInfo.state.substring(0, 2).toUpperCase(),
          region: stateInfo.region,
          population: stateInfo.population,
          description: stateInfo.description,
        }));

        return response.json({
          message: 'Nigerian states retrieved successfully',
          data: states,
          error: false,
          success: true,
        });

      case 'lgas':
        if (!state) {
          return response.status(400).json({
            message: 'State parameter is required for LGAs',
            error: true,
            success: false,
          });
        }

        const stateData = nigeriaStatesLgas.find(
          (s) => s.state.toLowerCase() === state.toLowerCase()
        );

        if (!stateData) {
          return response.status(400).json({
            message: `Invalid state name: ${state}`,
            error: true,
            success: false,
          });
        }

        const lgas = stateData.lga.map((lgaName) => ({
          name: lgaName,
          state: state,
        }));

        return response.json({
          message: 'LGAs retrieved successfully',
          data: lgas,
          error: false,
          success: true,
        });

      case 'all':
        const allData = nigeriaStatesLgas.map((stateData) => ({
          state: stateData.state,
          capital: stateData.capital,
          code: stateData.state.substring(0, 2).toUpperCase(),
          region: stateData.region,
          population: stateData.population,
          description: stateData.description,
          lgas: stateData.lga.map((lgaName) => ({
            name: lgaName,
          })),
        }));

        return response.json({
          message: 'All Nigerian location data retrieved successfully',
          data: allData,
          error: false,
          success: true,
        });

      default:
        return response.status(400).json({
          message: 'Invalid type. Use: states, lgas, or all',
          error: true,
          success: false,
        });
    }
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// Validate Nigerian address data using local data
const validateNigerianAddressData = async (addressData) => {
  const { state, lga, postal_code, mobile } = addressData;

  // Validate state using local data
  const validState = nigeriaStatesLgas.find(
    (s) => s.state.toLowerCase() === state.toLowerCase()
  );

  if (!validState) {
    throw new Error(
      `Invalid state: ${state}. Please select a valid Nigerian state.`
    );
  }

  // Validate LGA using local data
  const validLGA = validState.lga.find(
    (lgaName) => lgaName.toLowerCase() === lga.toLowerCase()
  );

  if (!validLGA) {
    throw new Error(
      `Invalid LGA: ${lga} for state: ${state}. Please select a valid LGA.`
    );
  }

  // Validate postal code format (6 digits for Nigeria)
  if (postal_code && !/^\d{6}$/.test(postal_code)) {
    throw new Error('Postal code must be exactly 6 digits.');
  }

  // Validate Nigerian mobile number
  if (mobile) {
    const cleanMobile = mobile.replace(/\s/g, '');
    const nigerianMobileRegex = /^(\+234|0)[789][01]\d{8}$/;
    if (!nigerianMobileRegex.test(cleanMobile)) {
      throw new Error(
        'Please provide a valid Nigerian mobile number (e.g., +2348012345678 or 08012345678).'
      );
    }
  }

  return true;
};

// Get geopolitical zone for a state using local data
const getGeopoliticalZone = (stateName) => {
  const stateData = nigeriaStatesLgas.find(
    (s) => s.state.toLowerCase() === stateName.toLowerCase()
  );

  return stateData ? stateData.region : 'North Central'; // Default fallback
};

// Create address with Nigerian validation
export const addAddressController = async (request, response) => {
  try {
    const userId = request.userId;
    const {
      address_line,
      address_line_2,
      city,
      state,
      lga,
      area,
      postal_code,
      mobile,
      landline,
      address_type,
      is_primary,
      delivery_instructions,
      landmark,
      coordinates,
    } = request.body;

    // Validate required fields
    if (!address_line || !city || !state || !lga || !postal_code || !mobile) {
      return response.status(400).json({
        message:
          'Address line, city, state, LGA, postal code, and mobile number are required',
        error: true,
        success: false,
      });
    }

    // Validate Nigerian address data using local data
    await validateNigerianAddressData({ state, lga, postal_code, mobile });

    // Get state code and additional info
    const stateCode = state.substring(0, 2).toUpperCase();
    const geopoliticalZone = getGeopoliticalZone(state);

    // Create address data
    const addressData = {
      address_line: address_line.trim(),
      address_line_2: address_line_2?.trim() || '',
      city: city.trim(),
      state: state.trim(),
      state_code: stateCode,
      lga: lga.trim(),
      area: area?.trim() || '',
      postal_code: postal_code.trim(),
      country: 'Nigeria',
      mobile: mobile.trim(),
      landline: landline?.trim() || '',
      address_type: address_type || 'home',
      is_primary: is_primary || false,
      delivery_instructions: delivery_instructions?.trim() || '',
      landmark: landmark?.trim() || '',
      userId,
    };

    // Add coordinates if provided
    if (coordinates?.latitude && coordinates?.longitude) {
      addressData.coordinates = {
        latitude: parseFloat(coordinates.latitude),
        longitude: parseFloat(coordinates.longitude),
      };
    }

    const createAddress = new AddressModel(addressData);

    // Additional validation using the model method
    await createAddress.validateNigerianAddress();

    const savedAddress = await createAddress.save();

    // Add address to user's address list
    await UserModel.findByIdAndUpdate(userId, {
      $push: { address_details: savedAddress._id },
    });

    // Auto-assign shipping zone
    try {
      const shippingZone = await ShippingZoneModel.findZoneByState(state);
      if (shippingZone) {
        await AddressModel.findByIdAndUpdate(savedAddress._id, {
          shipping_zone: shippingZone._id,
        });
      }
    } catch (zoneError) {
      console.error('Error auto-assigning shipping zone:', zoneError);
    }

    // Populate the saved address for response
    const populatedAddress = await AddressModel.findById(savedAddress._id)
      .populate('shipping_zone', 'name code')
      .populate('userId', 'name email');

    return response.json({
      message: 'Address created successfully',
      error: false,
      success: true,
      data: populatedAddress,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// Get user addresses with shipping zone info
export const getAddressController = async (request, response) => {
  try {
    const userId = request.userId;

    const addresses = await AddressModel.find({ userId, status: true })
      .populate('shipping_zone', 'name code delivery_options')
      .sort({ is_primary: -1, createdAt: -1 });

    return response.json({
      data: addresses,
      message: 'Address list retrieved successfully',
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// Update address with Nigerian validation
export const updateAddressController = async (request, response) => {
  try {
    const userId = request.userId;
    const {
      _id,
      address_line,
      address_line_2,
      city,
      state,
      lga,
      area,
      postal_code,
      mobile,
      landline,
      address_type,
      is_primary,
      delivery_instructions,
      landmark,
      coordinates,
    } = request.body;

    if (!_id) {
      return response.status(400).json({
        message: 'Address ID is required',
        error: true,
        success: false,
      });
    }

    // Find existing address
    const existingAddress = await AddressModel.findOne({ _id, userId });
    if (!existingAddress) {
      return response.status(404).json({
        message: 'Address not found',
        error: true,
        success: false,
      });
    }

    // Validate Nigerian address data if state or LGA changed
    if (state || lga || postal_code || mobile) {
      const dataToValidate = {
        state: state || existingAddress.state,
        lga: lga || existingAddress.lga,
        postal_code: postal_code || existingAddress.postal_code,
        mobile: mobile || existingAddress.mobile,
      };
      await validateNigerianAddressData(dataToValidate);
    }

    // Prepare update data
    const updateData = {
      updatedAt: new Date(),
    };

    if (address_line) updateData.address_line = address_line.trim();
    if (address_line_2 !== undefined)
      updateData.address_line_2 = address_line_2.trim();
    if (city) updateData.city = city.trim();
    if (state) {
      updateData.state = state.trim();
      updateData.state_code = state.substring(0, 2).toUpperCase();
    }
    if (lga) updateData.lga = lga.trim();
    if (area !== undefined) updateData.area = area.trim();
    if (postal_code) updateData.postal_code = postal_code.trim();
    if (mobile) updateData.mobile = mobile.trim();
    if (landline !== undefined) updateData.landline = landline.trim();
    if (address_type) updateData.address_type = address_type;
    if (is_primary !== undefined) updateData.is_primary = is_primary;
    if (delivery_instructions !== undefined)
      updateData.delivery_instructions = delivery_instructions.trim();
    if (landmark !== undefined) updateData.landmark = landmark.trim();

    // Update coordinates if provided
    if (coordinates?.latitude && coordinates?.longitude) {
      updateData.coordinates = {
        latitude: parseFloat(coordinates.latitude),
        longitude: parseFloat(coordinates.longitude),
      };
    }

    // Update shipping zone if state changed
    if (state && state !== existingAddress.state) {
      try {
        const shippingZone = await ShippingZoneModel.findZoneByState(state);
        if (shippingZone) {
          updateData.shipping_zone = shippingZone._id;
        }
      } catch (zoneError) {
        console.error('Error updating shipping zone:', zoneError);
      }
    }

    const updatedAddress = await AddressModel.findOneAndUpdate(
      { _id, userId },
      updateData,
      { new: true, runValidators: true }
    ).populate('shipping_zone', 'name code');

    return response.json({
      message: 'Address updated successfully',
      error: false,
      success: true,
      data: updatedAddress,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// Soft delete address
export const deleteAddressController = async (request, response) => {
  try {
    const userId = request.userId;
    const { _id } = request.body;

    if (!_id) {
      return response.status(400).json({
        message: 'Address ID is required',
        error: true,
        success: false,
      });
    }

    const disableAddress = await AddressModel.updateOne(
      { _id, userId },
      { status: false, updatedAt: new Date() }
    );

    if (disableAddress.matchedCount === 0) {
      return response.status(404).json({
        message: 'Address not found',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: 'Address removed successfully',
      error: false,
      success: true,
      data: disableAddress,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// Set primary address
export const setPrimaryAddressController = async (request, response) => {
  try {
    const userId = request.userId;
    const { _id } = request.body;

    if (!_id) {
      return response.status(400).json({
        message: 'Address ID is required',
        error: true,
        success: false,
      });
    }

    // Verify address belongs to user
    const address = await AddressModel.findOne({ _id, userId, status: true });
    if (!address) {
      return response.status(404).json({
        message: 'Address not found',
        error: true,
        success: false,
      });
    }

    // Remove primary flag from all user addresses
    await AddressModel.updateMany({ userId }, { is_primary: false });

    // Set this address as primary
    await AddressModel.findByIdAndUpdate(_id, { is_primary: true });

    return response.json({
      message: 'Primary address updated successfully',
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// Verify address (admin only)
export const verifyAddressController = async (request, response) => {
  try {
    const verifierId = request.userId;
    const { _id, is_verified } = request.body;

    if (!_id || is_verified === undefined) {
      return response.status(400).json({
        message: 'Address ID and verification status are required',
        error: true,
        success: false,
      });
    }

    const updateData = {
      is_verified,
      updatedAt: new Date(),
    };

    if (is_verified) {
      updateData.verified_at = new Date();
      updateData.verified_by = verifierId;
    } else {
      updateData.verified_at = null;
      updateData.verified_by = null;
    }

    const updatedAddress = await AddressModel.findByIdAndUpdate(
      _id,
      updateData,
      { new: true }
    ).populate('verified_by', 'name email');

    if (!updatedAddress) {
      return response.status(404).json({
        message: 'Address not found',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: `Address ${
        is_verified ? 'verified' : 'unverified'
      } successfully`,
      error: false,
      success: true,
      data: updatedAddress,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// Get addresses by shipping zone (admin only)
export const getAddressesByZoneController = async (request, response) => {
  try {
    const { zoneId, page = 1, limit = 20 } = request.query;

    if (!zoneId) {
      return response.status(400).json({
        message: 'Shipping zone ID is required',
        error: true,
        success: false,
      });
    }

    const skip = (page - 1) * limit;

    const [addresses, totalCount] = await Promise.all([
      AddressModel.find({ shipping_zone: zoneId, status: true })
        .populate('userId', 'name email mobile')
        .populate('shipping_zone', 'name code')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      AddressModel.countDocuments({ shipping_zone: zoneId, status: true }),
    ]);

    return response.json({
      message: 'Addresses retrieved successfully',
      data: addresses,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / limit),
        totalCount,
        hasNext: skip + addresses.length < totalCount,
        hasPrev: page > 1,
      },
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// Get address statistics (admin only)
export const getAddressStatsController = async (request, response) => {
  try {
    const stats = await AddressModel.aggregate([
      { $match: { status: true } },
      {
        $group: {
          _id: '$state',
          total_addresses: { $sum: 1 },
          verified_addresses: {
            $sum: { $cond: ['$is_verified', 1, 0] },
          },
          primary_addresses: {
            $sum: { $cond: ['$is_primary', 1, 0] },
          },
          unique_users: { $addToSet: '$userId' },
        },
      },
      {
        $addFields: {
          unique_user_count: { $size: '$unique_users' },
        },
      },
      {
        $project: {
          unique_users: 0,
        },
      },
      { $sort: { total_addresses: -1 } },
    ]);

    const totalStats = await AddressModel.aggregate([
      { $match: { status: true } },
      {
        $group: {
          _id: null,
          total_addresses: { $sum: 1 },
          total_verified: { $sum: { $cond: ['$is_verified', 1, 0] } },
          total_states: { $addToSet: '$state' },
          total_lgas: { $addToSet: { state: '$state', lga: '$lga' } },
          unique_users: { $addToSet: '$userId' },
        },
      },
      {
        $addFields: {
          total_state_count: { $size: '$total_states' },
          total_lga_count: { $size: '$total_lgas' },
          unique_user_count: { $size: '$unique_users' },
        },
      },
    ]);

    // Get geopolitical zone distribution
    const geopoliticalStats = await AddressModel.aggregate([
      { $match: { status: true } },
      {
        $group: {
          _id: '$state',
          count: { $sum: 1 },
        },
      },
    ]);

    // Map states to geopolitical zones
    const zoneDistribution = {};
    geopoliticalStats.forEach((stat) => {
      const zone = getGeopoliticalZone(stat._id);
      if (!zoneDistribution[zone]) {
        zoneDistribution[zone] = 0;
      }
      zoneDistribution[zone] += stat.count;
    });

    return response.json({
      message: 'Address statistics retrieved successfully',
      data: {
        by_state: stats,
        overall: totalStats[0] || {},
        geopolitical_distribution: zoneDistribution,
      },
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// Get Nigerian postal code suggestions (helper function)
export const getPostalCodeSuggestions = async (request, response) => {
  try {
    const { state, lga } = request.query;

    if (!state || !lga) {
      return response.status(400).json({
        message: 'State and LGA are required',
        error: true,
        success: false,
      });
    }

    // Validate state and LGA
    await validateNigerianAddressData({
      state,
      lga,
      postal_code: '123456',
      mobile: '08012345678',
    });

    // Basic postal code patterns for Nigerian states
    const postalCodePatterns = {
      Lagos: { prefix: '10', range: [1001, 1099] },
      FCT: { prefix: '90', range: [1, 999] },
      Kano: { prefix: '70', range: [1, 999] },
      Rivers: { prefix: '50', range: [1, 999] },
      Kaduna: { prefix: '80', range: [1, 999] },
      Oyo: { prefix: '20', range: [1, 999] },
      Delta: { prefix: '32', range: [1, 999] },
      Edo: { prefix: '30', range: [1, 999] },
      Ogun: { prefix: '11', range: [1, 999] },
      Ondo: { prefix: '34', range: [1, 999] },
      Osun: { prefix: '23', range: [1, 999] },
      Ekiti: { prefix: '36', range: [1, 999] },
      Kwara: { prefix: '24', range: [1, 999] },
      Kogi: { prefix: '27', range: [1, 999] },
      Benue: { prefix: '97', range: [1, 999] },
      Plateau: { prefix: '93', range: [1, 999] },
      Nasarawa: { prefix: '96', range: [1, 999] },
      Niger: { prefix: '92', range: [1, 999] },
      Taraba: { prefix: '66', range: [1, 999] },
      Adamawa: { prefix: '64', range: [1, 999] },
      Bauchi: { prefix: '74', range: [1, 999] },
      Borno: { prefix: '60', range: [1, 999] },
      Gombe: { prefix: '76', range: [1, 999] },
      Yobe: { prefix: '62', range: [1, 999] },
      Jigawa: { prefix: '72', range: [1, 999] },
      Katsina: { prefix: '82', range: [1, 999] },
      Kebbi: { prefix: '86', range: [1, 999] },
      Sokoto: { prefix: '84', range: [1, 999] },
      Zamfara: { prefix: '88', range: [1, 999] },
      Abia: { prefix: '44', range: [1, 999] },
      Anambra: { prefix: '42', range: [1, 999] },
      Ebonyi: { prefix: '48', range: [1, 999] },
      Enugu: { prefix: '40', range: [1, 999] },
      Imo: { prefix: '46', range: [1, 999] },
      'Akwa Ibom': { prefix: '52', range: [1, 999] },
      Bayelsa: { prefix: '56', range: [1, 999] },
      'Cross River': { prefix: '54', range: [1, 999] },
    };

    const pattern = postalCodePatterns[state];
    if (!pattern) {
      return response.json({
        message: 'Postal code suggestions retrieved',
        data: {
          suggestions: [`${state.substring(0, 2).toUpperCase()}0001`],
          pattern: 'XXYYYY format where XX is state code and YYYY is area code',
        },
        error: false,
        success: true,
      });
    }

    // Generate sample postal codes
    const suggestions = [];
    for (let i = 0; i < 5; i++) {
      const randomNum =
        Math.floor(Math.random() * (pattern.range[1] - pattern.range[0] + 1)) +
        pattern.range[0];
      suggestions.push(pattern.prefix + randomNum.toString().padStart(4, '0'));
    }

    return response.json({
      message: 'Postal code suggestions retrieved',
      data: {
        suggestions,
        pattern: `${pattern.prefix}YYYY format for ${state}`,
      },
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// Validate address format (helper function)
export const validateAddressFormat = async (request, response) => {
  try {
    const { state, lga, postal_code, mobile } = request.body;

    if (!state || !lga || !postal_code || !mobile) {
      return response.status(400).json({
        message: 'State, LGA, postal code, and mobile number are required',
        error: true,
        success: false,
      });
    }

    // Validate using our helper function
    await validateNigerianAddressData({ state, lga, postal_code, mobile });

    return response.json({
      message: 'Address format is valid',
      error: false,
      success: true,
      data: {
        state,
        lga,
        postal_code,
        mobile,
        geopolitical_zone: getGeopoliticalZone(state),
      },
    });
  } catch (error) {
    return response.status(400).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
