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
      default: 'India',
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
    customerId: {
      type: mongoose.Schema.ObjectId,
      ref: 'Customer',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const AddressModel = mongoose.model('address', addressSchema);

export default AddressModel;
