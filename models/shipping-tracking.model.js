// models/shippingTracking.model.js
import mongoose from 'mongoose';

const shippingTrackingSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.ObjectId,
      ref: 'order',
      required: true,
      unique: true,
    },
    trackingNumber: {
      type: String,
      required: [true, 'Tracking number is required'],
      unique: true,
      uppercase: true,
      trim: true,
    },
    carrier: {
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
      },
      phone: String,
      website: String,
    },
    shippingMethod: {
      type: mongoose.Schema.ObjectId,
      ref: 'ShippingMethod',
      required: true,
    },
    status: {
      type: String,
      enum: [
        'PENDING', // Order received, not yet shipped
        'PROCESSING', // Order being prepared
        'PICKED_UP', // Picked up by carrier
        'IN_TRANSIT', // In transit to destination
        'OUT_FOR_DELIVERY', // Out for delivery
        'DELIVERED', // Successfully delivered
        'ATTEMPTED', // Delivery attempted but failed
        'RETURNED', // Returned to sender
        'LOST', // Package lost
        'CANCELLED', // Shipment cancelled
      ],
      default: 'PENDING',
    },
    trackingEvents: [
      {
        status: {
          type: String,
          required: true,
        },
        description: {
          type: String,
          required: true,
        },
        location: {
          city: String,
          state: String,
          country: String,
          facility: String,
        },
        timestamp: {
          type: Date,
          required: true,
          default: Date.now,
        },
        updatedBy: {
          type: mongoose.Schema.ObjectId,
          ref: 'User',
        },
        isCustomerVisible: {
          type: Boolean,
          default: true,
        },
      },
    ],
    estimatedDelivery: {
      type: Date,
    },
    actualDelivery: {
      type: Date,
    },
    deliveryAttempts: [
      {
        timestamp: {
          type: Date,
          required: true,
        },
        reason: {
          type: String,
          required: true,
        },
        nextAttemptDate: Date,
        notes: String,
      },
    ],
    deliveryAddress: {
      addressLine: String,
      city: String,
      state: String,
      postalCode: String,
      country: String,
      coordinates: {
        latitude: Number,
        longitude: Number,
      },
    },
    deliveryInstructions: {
      type: String,
      default: '',
    },
    recipientInfo: {
      name: String,
      phone: String,
      email: String,
      idVerification: {
        required: {
          type: Boolean,
          default: false,
        },
        verified: {
          type: Boolean,
          default: false,
        },
        verifiedAt: Date,
        verifiedBy: String,
      },
    },
    packageInfo: {
      weight: {
        type: Number,
        required: true,
      },
      dimensions: {
        length: Number,
        width: Number,
        height: Number,
        unit: {
          type: String,
          enum: ['cm', 'in'],
          default: 'cm',
        },
      },
      fragile: {
        type: Boolean,
        default: false,
      },
      insured: {
        type: Boolean,
        default: false,
      },
      insuranceValue: {
        type: Number,
        default: 0,
      },
    },
    shippingCost: {
      type: Number,
      required: true,
      default: 0,
    },
    notifications: {
      sms: {
        enabled: {
          type: Boolean,
          default: true,
        },
        sent: [
          {
            status: String,
            timestamp: Date,
            message: String,
          },
        ],
      },
      email: {
        enabled: {
          type: Boolean,
          default: true,
        },
        sent: [
          {
            status: String,
            timestamp: Date,
            subject: String,
          },
        ],
      },
    },
    internalNotes: {
      type: String,
      default: '',
    },
    customerNotes: {
      type: String,
      default: '',
    },
    priority: {
      type: String,
      enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'],
      default: 'NORMAL',
    },
    orderGroupId: {
      type: String,
      index: true,
    },
    isGroupShipment: {
      type: Boolean,
      default: false,
    },
    groupItemCount: {
      type: Number,
      default: 1,
    },
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

// Indexes
shippingTrackingSchema.index({ trackingNumber: 1 });
shippingTrackingSchema.index({ orderId: 1 });
shippingTrackingSchema.index({ status: 1 });
shippingTrackingSchema.index({ 'carrier.code': 1 });
shippingTrackingSchema.index({ estimatedDelivery: 1 });
shippingTrackingSchema.index({ actualDelivery: 1 });

// Virtual for current location
shippingTrackingSchema.virtual('currentLocation').get(function () {
  if (this.trackingEvents && this.trackingEvents.length > 0) {
    const latestEvent = this.trackingEvents[this.trackingEvents.length - 1];
    return latestEvent.location;
  }
  return null;
});

// Virtual for days in transit
shippingTrackingSchema.virtual('daysInTransit').get(function () {
  const startDate = this.createdAt;
  const endDate = this.actualDelivery || new Date();
  const diffTime = Math.abs(endDate - startDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
});

// Method to add tracking event
shippingTrackingSchema.methods.addTrackingEvent = function (
  eventData,
  updatedBy
) {
  const event = {
    status: eventData.status,
    description: eventData.description,
    location: eventData.location || {},
    timestamp: eventData.timestamp || new Date(),
    updatedBy: updatedBy,
    isCustomerVisible: eventData.isCustomerVisible !== false, // Default to true
  };

  this.trackingEvents.push(event);
  this.status = eventData.status;
  this.updatedBy = updatedBy;

  // Update delivery date if delivered
  if (eventData.status === 'DELIVERED' && !this.actualDelivery) {
    this.actualDelivery = event.timestamp;
  }

  return this.save();
};

// Method to update estimated delivery
shippingTrackingSchema.methods.updateEstimatedDelivery = function (
  newDate,
  updatedBy
) {
  this.estimatedDelivery = newDate;
  this.updatedBy = updatedBy;

  // Add tracking event for delivery update
  return this.addTrackingEvent(
    {
      status: this.status,
      description: `Estimated delivery updated to ${newDate.toLocaleDateString()}`,
      isCustomerVisible: true,
    },
    updatedBy
  );
};

// Static method to get tracking by order ID
shippingTrackingSchema.statics.getByOrderId = function (orderId) {
  return this.findOne({ orderId })
    .populate('orderId')
    .populate('shippingMethod')
    .populate('createdBy', 'name email')
    .populate('updatedBy', 'name email')
    .populate('trackingEvents.updatedBy', 'name');
};

// Static method to get tracking by tracking number
shippingTrackingSchema.statics.getByTrackingNumber = function (trackingNumber) {
  return this.findOne({ trackingNumber: trackingNumber.toUpperCase() })
    .populate('orderId')
    .populate('shippingMethod')
    .populate('createdBy', 'name email')
    .populate('updatedBy', 'name email')
    .populate('trackingEvents.updatedBy', 'name');
};

// Static method to get overdue deliveries
shippingTrackingSchema.statics.getOverdueDeliveries = function () {
  const now = new Date();
  return this.find({
    estimatedDelivery: { $lt: now },
    status: { $nin: ['DELIVERED', 'RETURNED', 'LOST', 'CANCELLED'] },
  })
    .populate('orderId')
    .populate('shippingMethod')
    .sort({ estimatedDelivery: 1 });
};

// Static method to get shipments by status
shippingTrackingSchema.statics.getByStatus = function (status) {
  return this.find({ status })
    .populate('orderId')
    .populate('shippingMethod')
    .sort({ createdAt: -1 });
};

// Pre-save middleware to generate tracking number if not provided
shippingTrackingSchema.pre('save', function (next) {
  if (this.isNew && !this.trackingNumber) {
    // Generate tracking number: ICF + timestamp + random
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.random().toString(36).substring(2, 5).toUpperCase();
    this.trackingNumber = `ICF${timestamp}${random}`;
  }
  next();
});

const ShippingTrackingModel = mongoose.model(
  'ShippingTracking',
  shippingTrackingSchema
);

export default ShippingTrackingModel;
