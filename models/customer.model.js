// models/customer.model.js
import mongoose from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

const customerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Customer name is required'],
    },
    email: {
      type: String,
      required: [true, 'Customer email is required'],
      unique: true,
    },
    mobile: {
      type: String,
      required: [true, 'Mobile number is required'],
    },
    address: {
      street: String,
      city: String,
      state: String,
      country: { type: String, default: 'Nigeria' },
      postalCode: String,
    },
    customerType: {
      type: String,
      enum: ['BTC', 'BTB'],
      required: [true, 'Customer type is required'],
    },
    customerMode: {
      type: String,
      enum: ['ONLINE', 'OFFLINE'],
      required: [true, 'Customer mode is required'],
    },
    companyName: {
      type: String,
      required: function () {
        return this.customerType === 'BTB';
      },
    },
    taxNumber: {
      type: String,
      required: function () {
        return this.customerType === 'BTB';
      },
    },
    createdBy: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: function () {
        return this.customerMode === 'OFFLINE';
      },
    },
    isWebsiteCustomer: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'],
      default: 'ACTIVE',
    },
    notes: {
      type: String,
      default: '',
    },
    totalOrders: {
      type: Number,
      default: 0,
    },
    totalOrderValue: {
      type: Number,
      default: 0,
    },
    lastOrderDate: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Add pagination plugin
customerSchema.plugin(mongoosePaginate);

// Create indexes
customerSchema.index({ email: 1 });
customerSchema.index({ createdBy: 1 });
customerSchema.index({ customerType: 1 });
customerSchema.index({ customerMode: 1 });
customerSchema.index({ status: 1 });
customerSchema.index({ createdAt: -1 });

// Virtual to get full name for BTB customers
customerSchema.virtual('displayName').get(function () {
  if (this.customerType === 'BTB' && this.companyName) {
    return `${this.companyName} (${this.name})`;
  }
  return this.name;
});

const CustomerModel = mongoose.model('Customer', customerSchema);

export default CustomerModel;
