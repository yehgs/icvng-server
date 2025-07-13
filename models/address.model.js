import mongoose from 'mongoose';

const addressSchema = new mongoose.Schema(
  {
    address_line: {
      type: String,
      default: '',
    },
    address_line_2: {
      type: String,
      default: '',
    },
    city: {
      type: String,
      default: '',
    },
    state: {
      type: String,
      default: '',
    },
    pincode: {
      type: String,
    },
    country: {
      type: String,
      default: 'Nigeria', // Changed from India to Nigeria since your system uses NGN
    },
    mobile: {
      type: String,
      default: null,
    },
    landline: {
      type: String,
      default: null,
    },
    address_type: {
      type: String,
      enum: ['billing', 'shipping', 'office', 'warehouse', 'home'],
      default: 'billing',
    },
    is_primary: {
      type: Boolean,
      default: false,
    },
    status: {
      type: Boolean,
      default: true,
    },
    // Fixed field name to match your controller
    userId: {
      type: mongoose.Schema.ObjectId,
      ref: 'User', // Changed from Customer to User to match your system
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const AddressModel = mongoose.model('address', addressSchema);

export default AddressModel;
