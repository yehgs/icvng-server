// models/address.model.js - Enhanced Nigeria-focused address model
import mongoose from 'mongoose';
import { nigeriaStatesLgas } from '../data/nigeria-states-lgas.js';

const addressSchema = new mongoose.Schema(
  {
    // Primary address fields aligned with Nigerian addressing system
    address_line: {
      type: String,
      required: [true, 'Address line is required'],
      trim: true,
      maxlength: [500, 'Address line cannot exceed 500 characters'],
    },
    address_line_2: {
      type: String,
      trim: true,
      maxlength: [200, 'Address line 2 cannot exceed 200 characters'],
      default: '',
    },

    // Nigerian administrative divisions
    state: {
      type: String,
      required: [true, 'State is required'],
      trim: true,
      validate: {
        validator: function (value) {
          // Will be validated against Nigerian states data
          return value && value.length > 0;
        },
        message: 'Please select a valid Nigerian state',
      },
    },
    state_code: {
      type: String,
      required: [true, 'State code is required'],
      uppercase: true,
      trim: true,
      maxlength: [3, 'State code cannot exceed 3 characters'],
    },

    lga: {
      type: String,
      required: [true, 'Local Government Area is required'],
      trim: true,
      validate: {
        validator: function (value) {
          return value && value.length > 0;
        },
        message: 'Please select a valid Local Government Area',
      },
    },

    // City/Town (often same as LGA but can be more specific)
    city: {
      type: String,
      required: [true, 'City/Town is required'],
      trim: true,
    },

    // Area/Ward (sub-division within LGA)
    area: {
      type: String,
      trim: true,
      default: '',
    },

    // Postal code (Nigerian postal codes)
    postal_code: {
      type: String,
      required: [true, 'Postal code is required'],
      trim: true,
      validate: {
        validator: function (value) {
          // Nigerian postal codes are 6 digits
          return /^\d{6}$/.test(value);
        },
        message: 'Postal code must be 6 digits',
      },
    },

    // Fixed to Nigeria only
    country: {
      type: String,
      default: 'Nigeria',
      immutable: true, // Cannot be changed
    },

    // Contact information
    mobile: {
      type: String,
      required: [true, 'Mobile number is required'],
      trim: true,
      validate: {
        validator: function (value) {
          // Nigerian mobile number format: +234XXXXXXXXXX or 0XXXXXXXXXXX
          const nigerianMobileRegex = /^(\+234|0)[789][01]\d{8}$/;
          return nigerianMobileRegex.test(value.replace(/\s/g, ''));
        },
        message: 'Please provide a valid Nigerian mobile number',
      },
    },

    landline: {
      type: String,
      trim: true,
      default: '',
      validate: {
        validator: function (value) {
          if (!value) return true; // Optional field
          // Nigerian landline format
          const landlineRegex = /^(\+234|0)[1-9]\d{7,9}$/;
          return landlineRegex.test(value.replace(/\s/g, ''));
        },
        message: 'Please provide a valid Nigerian landline number',
      },
    },

    // Address classification
    address_type: {
      type: String,
      enum: ['home', 'office', 'warehouse', 'pickup_point', 'other'],
      default: 'home',
    },

    // Primary address flag
    is_primary: {
      type: Boolean,
      default: false,
    },

    // Delivery preferences
    delivery_instructions: {
      type: String,
      trim: true,
      maxlength: [500, 'Delivery instructions cannot exceed 500 characters'],
      default: '',
    },

    // Landmark for easier identification
    landmark: {
      type: String,
      trim: true,
      maxlength: [200, 'Landmark cannot exceed 200 characters'],
      default: '',
    },

    // Geo-coordinates for precise delivery
    coordinates: {
      latitude: {
        type: Number,
        min: [-90, 'Latitude must be between -90 and 90'],
        max: [90, 'Latitude must be between -90 and 90'],
      },
      longitude: {
        type: Number,
        min: [-180, 'Longitude must be between -180 and 180'],
        max: [180, 'Longitude must be between -180 and 180'],
      },
    },

    // Status and validation
    status: {
      type: Boolean,
      default: true,
    },

    // Address verification status
    is_verified: {
      type: Boolean,
      default: false,
    },

    verified_at: {
      type: Date,
    },

    verified_by: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
    },

    // User reference
    userId: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
    },

    // Shipping zone reference (auto-populated)
    shipping_zone: {
      type: mongoose.Schema.ObjectId,
      ref: 'ShippingZone',
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for better performance
addressSchema.index({ userId: 1, is_primary: 1 });
addressSchema.index({ state: 1, lga: 1 });
addressSchema.index({ postal_code: 1 });
addressSchema.index({ shipping_zone: 1 });
addressSchema.index({ status: 1 });

// Pre-save middleware to ensure only one primary address per user
addressSchema.pre('save', async function (next) {
  if (this.is_primary && this.isModified('is_primary')) {
    // Remove primary flag from other addresses of the same user
    await this.constructor.updateMany(
      { userId: this.userId, _id: { $ne: this._id } },
      { is_primary: false }
    );
  }
  next();
});

// Post-save middleware to auto-assign shipping zone
addressSchema.post('save', async function (doc) {
  if (!doc.shipping_zone) {
    try {
      const ShippingZoneModel = mongoose.model('ShippingZone');
      const zone = await ShippingZoneModel.findZoneByState(doc.state);

      if (zone) {
        await this.constructor.findByIdAndUpdate(doc._id, {
          shipping_zone: zone._id,
        });
      }
    } catch (error) {
      console.error('Error auto-assigning shipping zone:', error);
    }
  }
});

// Virtual for full address
addressSchema.virtual('full_address').get(function () {
  const parts = [
    this.address_line,
    this.address_line_2,
    this.area,
    this.city,
    this.lga,
    this.state,
    this.postal_code,
    this.country,
  ].filter(Boolean);

  return parts.join(', ');
});

// Virtual for formatted mobile
addressSchema.virtual('formatted_mobile').get(function () {
  if (!this.mobile) return '';

  // Format Nigerian mobile number
  let cleaned = this.mobile.replace(/\D/g, '');
  if (cleaned.startsWith('234')) {
    cleaned = '+' + cleaned;
  } else if (cleaned.startsWith('0')) {
    cleaned = '+234' + cleaned.substring(1);
  } else {
    cleaned = '+234' + cleaned;
  }

  return cleaned;
});

// Static method to get user's primary address
addressSchema.statics.getPrimaryAddress = function (userId) {
  return this.findOne({ userId, is_primary: true, status: true });
};

// Static method to get addresses by shipping zone
addressSchema.statics.getByShippingZone = function (zoneId) {
  return this.find({ shipping_zone: zoneId, status: true })
    .populate('userId', 'name email')
    .sort({ createdAt: -1 });
};

// Instance method to validate Nigerian address using local data
addressSchema.methods.validateNigerianAddress = async function () {
  try {
    // Validate state
    const stateData = nigeriaStatesLgas.find(
      (state) => state.state.toLowerCase() === this.state.toLowerCase()
    );

    if (!stateData) {
      throw new Error(`Invalid state: ${this.state}`);
    }

    // Validate LGA
    const lgaExists = stateData.lga.some(
      (lga) => lga.toLowerCase() === this.lga.toLowerCase()
    );

    if (!lgaExists) {
      throw new Error(`Invalid LGA: ${this.lga} for state: ${this.state}`);
    }

    return true;
  } catch (error) {
    throw new Error(`Address validation failed: ${error.message}`);
  }
};

// Instance method to format for shipping label
addressSchema.methods.getShippingLabel = function () {
  return {
    name: this.userId?.name || 'Customer',
    address_line_1: this.address_line,
    address_line_2: this.address_line_2 || '',
    city: this.city,
    lga: this.lga,
    state: this.state,
    postal_code: this.postal_code,
    country: this.country,
    mobile: this.formatted_mobile,
    landmark: this.landmark || '',
    delivery_instructions: this.delivery_instructions || '',
  };
};

const AddressModel = mongoose.model('address', addressSchema);

export default AddressModel;
