import mongoose from 'mongoose';

const supplierSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    slug: {
      type: String,
      unique: true,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    phone: {
      type: String,
      required: true,
    },
    address: {
      street: String,
      city: String,
      state: String,
      country: String,
      zipCode: String,
    },
    contactPerson: {
      name: String,
      phone: String,
      email: String,
    },
    bankDetails: {
      bankName: String,
      accountNumber: String,
      routingNumber: String,
      swiftCode: String,
    },
    taxInfo: {
      taxId: String,
      vatNumber: String,
    },
    paymentTerms: {
      type: String,
      enum: ['NET_30', 'NET_60', 'COD', 'ADVANCE', 'CUSTOM'],
      default: 'NET_30',
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE', 'BLACKLISTED'],
      default: 'ACTIVE',
    },
    notes: String,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

export const SupplierModel = mongoose.model('Supplier', supplierSchema);
