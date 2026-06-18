//server
import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true }, // e.g. "Business Hosting"
    type: {
      type: String,
      enum: ['hosting', 'domain', 'ssl', 'email', 'other'],
      default: 'other',
    },
    username: { type: String, default: '' },
    password: { type: String, default: '' }, // stored as plain (IT/Director-only access)
    purchaseDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null },
    renewalCost: { type: Number, default: null },
    autoRenew: { type: Boolean, default: false },
    reminderEnabled: { type: Boolean, default: false },
    reminderDaysBefore: { type: Number, default: 30 },
    notes: { type: String, default: '' },
    status: {
      type: String,
      enum: ['active', 'expired', 'expiring_soon'],
      default: 'active',
    },
  },
  { timestamps: true }
);

const passwordVaultSchema = new mongoose.Schema(
  {
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    lastModifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },

    // The account/platform category
    category: {
      type: String,
      enum: [
        'Domain & Hosting',
        'Email Account',
        'Social Media',
        'E-commerce Platform',
        'Payment Gateway',
        'Cloud Service',
        'Software License',
        'Database',
        'API Key',
        'Other',
      ],
      default: 'Other',
    },

    platformName: { type: String, required: true }, // e.g. "Namecheap"
    websiteUrl: { type: String, default: '' },
    accountEmail: { type: String, default: '' },
    accountUsername: { type: String, default: '' },
    password: { type: String, default: '' },
    twoFactorSecret: { type: String, default: '' },
    notes: { type: String, default: '' },

    // Visibility: IT and DIRECTOR only
    visibleTo: [{ type: String }], // subRole array, default: ['IT', 'DIRECTOR']

    // Nested products/services under this account
    products: [productSchema],

    tags: [{ type: String }],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const PasswordVaultModel = mongoose.model('PasswordVault', passwordVaultSchema);
export default PasswordVaultModel;
