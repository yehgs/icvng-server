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
      lowercase: true,
      trim: true,
    },
    mobile: {
      type: String,
      required: [true, 'Mobile number is required'],
    },
    image: {
      type: String,
      default: '',
    },
    address: {
      street: String,
      city: String,
      state: String,
      lga: String, // Added LGA field
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
    registrationNumber: {
      type: String,
      required: function () {
        return this.customerType === 'BTB';
      },
      sparse: true,
    },
    createdBy: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: function () {
        return this.customerMode === 'OFFLINE';
      },
    },
    assignedTo: [
      {
        type: mongoose.Schema.ObjectId,
        ref: 'User',
      },
    ],
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
    isFeatured: {
      type: Boolean,
      default: false,
    },
    featuredAt: {
      type: Date,
    },
    featuredBy: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
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
customerSchema.index({ assignedTo: 1 });
customerSchema.index({ customerType: 1 });
customerSchema.index({ customerMode: 1 });
customerSchema.index({ status: 1 });
customerSchema.index({ registrationNumber: 1 }, { sparse: true });
customerSchema.index({ createdAt: -1 });
customerSchema.index({ isFeatured: 1, status: 1 }); // For featured customers query

// Virtual to get full name for BTB customers
customerSchema.virtual('displayName').get(function () {
  if (this.customerType === 'BTB' && this.companyName) {
    return `${this.companyName} (${this.name})`;
  }
  return this.name;
});

// Ensure virtuals are included in JSON
customerSchema.set('toJSON', { virtuals: true });
customerSchema.set('toObject', { virtuals: true });

const CustomerModel = mongoose.model('Customer', customerSchema);

export default CustomerModel;