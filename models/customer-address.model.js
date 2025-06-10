import mongoose from 'mongoose';

// Enhanced Address Schema for Customer Contacts
const customerAddressSchema = new mongoose.Schema(
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

// Company/Organization Schema for B2B customers
const companySchema = new mongoose.Schema({
  company_name: {
    type: String,
    required: [true, 'Company name is required for B2B customers'],
  },
  company_registration_number: {
    type: String,
    default: '',
  },
  tax_id: {
    type: String,
    default: '',
  },
  gst_number: {
    type: String,
    default: '',
  },
  industry: {
    type: String,
    default: '',
  },
  company_size: {
    type: String,
    enum: ['startup', 'small', 'medium', 'large', 'enterprise'],
    default: 'small',
  },
  annual_revenue: {
    type: String,
    enum: ['0-1L', '1L-10L', '10L-1Cr', '1Cr-10Cr', '10Cr+'],
    default: '0-1L',
  },
  website: {
    type: String,
    default: '',
  },
  established_year: {
    type: Number,
    default: null,
  },
});

// Contact Person Schema for B2B customers
const contactPersonSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Contact person name is required'],
  },
  designation: {
    type: String,
    default: '',
  },
  department: {
    type: String,
    default: '',
  },
  email: {
    type: String,
    required: [true, 'Contact person email is required'],
  },
  mobile: {
    type: String,
    required: [true, 'Contact person mobile is required'],
  },
  landline: {
    type: String,
    default: '',
  },
  is_primary: {
    type: Boolean,
    default: false,
  },
  is_decision_maker: {
    type: Boolean,
    default: false,
  },
});

// Main Customer Schema
const customerSchema = new mongoose.Schema(
  {
    // Basic Information
    customer_id: {
      type: String,
      unique: true,
      required: true,
    },
    customer_type: {
      type: String,
      enum: ['B2B', 'B2C'],
      required: [true, 'Customer type is required'],
    },
    interaction_mode: {
      type: String,
      enum: ['online', 'offline', 'hybrid'],
      default: 'online',
    },

    // For B2C customers
    first_name: {
      type: String,
      required: function () {
        return this.customer_type === 'B2C';
      },
    },
    last_name: {
      type: String,
      default: '',
    },
    full_name: {
      type: String,
    },
    date_of_birth: {
      type: Date,
      default: null,
    },
    gender: {
      type: String,
      enum: ['male', 'female', 'other', 'prefer_not_to_say'],
      default: 'prefer_not_to_say',
    },

    // For B2B customers
    company_details: {
      type: companySchema,
      required: function () {
        return this.customer_type === 'B2B';
      },
    },
    contact_persons: [contactPersonSchema],

    // Common contact information
    primary_email: {
      type: String,
      required: [true, 'Primary email is required'],
      unique: true,
    },
    secondary_email: {
      type: String,
      default: '',
    },
    primary_mobile: {
      type: String,
      required: [true, 'Primary mobile is required'],
    },
    secondary_mobile: {
      type: String,
      default: '',
    },
    whatsapp_number: {
      type: String,
      default: '',
    },

    // Status and preferences
    status: {
      type: String,
      enum: ['active', 'inactive', 'suspended', 'prospect', 'lead'],
      default: 'prospect',
    },
    customer_priority: {
      type: String,
      enum: ['high', 'medium', 'low'],
      default: 'medium',
    },
    preferred_communication: {
      type: String,
      enum: ['email', 'phone', 'whatsapp', 'sms'],
      default: 'email',
    },

    // Business information
    source: {
      type: String,
      enum: [
        'website',
        'social_media',
        'referral',
        'advertisement',
        'cold_call',
        'exhibition',
        'other',
      ],
      default: 'website',
    },
    assigned_sales_rep: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      default: null,
    },
    customer_segment: {
      type: String,
      enum: ['premium', 'regular', 'budget', 'enterprise'],
      default: 'regular',
    },

    // Financial information
    credit_limit: {
      type: Number,
      default: 0,
    },
    payment_terms: {
      type: String,
      enum: [
        'immediate',
        '15_days',
        '30_days',
        '45_days',
        '60_days',
        '90_days',
      ],
      default: 'immediate',
    },
    currency: {
      type: String,
      default: 'INR',
    },

    // Relationship data
    first_contact_date: {
      type: Date,
      default: Date.now,
    },
    last_contact_date: {
      type: Date,
      default: null,
    },
    last_purchase_date: {
      type: Date,
      default: null,
    },
    total_purchases: {
      type: Number,
      default: 0,
    },
    lifetime_value: {
      type: Number,
      default: 0,
    },

    // References
    addresses: [
      {
        type: mongoose.Schema.ObjectId,
        ref: 'CustomerAddress',
      },
    ],
    orders: [
      {
        type: mongoose.Schema.ObjectId,
        ref: 'Order',
      },
    ],

    // Additional metadata
    tags: [String],
    notes: {
      type: String,
      default: '',
    },
    custom_fields: {
      type: Map,
      of: String,
    },

    // System fields
    created_by: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: true,
    },
    updated_by: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Pre-save middleware to generate customer ID and full name
customerSchema.pre('save', function (next) {
  // Generate customer ID if not provided
  if (!this.customer_id) {
    const prefix = this.customer_type === 'B2B' ? 'B2B' : 'B2C';
    const timestamp = Date.now().toString().slice(-6);
    this.customer_id = `${prefix}${timestamp}`;
  }

  // Set full name for B2C customers
  if (this.customer_type === 'B2C') {
    this.full_name = `${this.first_name} ${this.last_name}`.trim();
  }

  next();
});

// Indexes for better performance
customerSchema.index({ customer_id: 1 });
customerSchema.index({ customer_type: 1, status: 1 });
customerSchema.index({ primary_email: 1 });
customerSchema.index({ primary_mobile: 1 });
customerSchema.index({ 'company_details.company_name': 1 });
customerSchema.index({ assigned_sales_rep: 1 });
customerSchema.index({ interaction_mode: 1 });

// Virtual for display name
customerSchema.virtual('display_name').get(function () {
  if (this.customer_type === 'B2B') {
    return this.company_details?.company_name || 'Unknown Company';
  }
  return this.full_name || `${this.first_name} ${this.last_name}`.trim();
});

// Instance methods
customerSchema.methods.isOnline = function () {
  return (
    this.interaction_mode === 'online' || this.interaction_mode === 'hybrid'
  );
};

customerSchema.methods.isOffline = function () {
  return (
    this.interaction_mode === 'offline' || this.interaction_mode === 'hybrid'
  );
};

customerSchema.methods.getPreferredContact = function () {
  if (this.customer_type === 'B2B') {
    const primaryContact = this.contact_persons.find(
      (contact) => contact.is_primary
    );
    return primaryContact || this.contact_persons[0];
  }
  return {
    name: this.full_name,
    email: this.primary_email,
    mobile: this.primary_mobile,
  };
};

// Static methods
customerSchema.statics.findByType = function (type, status = 'active') {
  return this.find({ customer_type: type, status: status });
};

customerSchema.statics.findOnlineCustomers = function () {
  return this.find({
    interaction_mode: { $in: ['online', 'hybrid'] },
    status: 'active',
  });
};

customerSchema.statics.findOfflineCustomers = function () {
  return this.find({
    interaction_mode: { $in: ['offline', 'hybrid'] },
    status: 'active',
  });
};

// Models
const CustomerModel = mongoose.model('Customer', customerSchema);
const CustomerAddressModel = mongoose.model(
  'CustomerAddress',
  customerAddressSchema
);

export { CustomerModel, CustomerAddressModel };
