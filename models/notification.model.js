//server
import mongoose from 'mongoose';
import countryScopedPlugin from "../core/countryScopedPlugin.js";

const notificationSchema = new mongoose.Schema(
  {
    // Who created/triggered the notification
    triggeredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    triggeredByName: { type: String, default: 'System' },

    // Targeting — can be 'role', 'specific', or 'all'
    targetType: {
      type: String,
      enum: ['role', 'specific', 'all'],
      default: 'role',
    },
    // subRoles that should receive this notification
    targetRoles: [{ type: String }],
    // specific user IDs (for direct targeting)
    targetUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    type: {
      type: String,
      enum: [
        'ORDER',
        'SHIPMENT',
        'TRACKING',
        'USER_REGISTRATION',
        'PASSWORD_RESET',
        'PRODUCT',
        'STOCK',
        'PRICING',
        'PURCHASE_ORDER',
        'BLOG',
        'SUPPORT_TICKET',
        'SYSTEM',
        'ANNOUNCEMENT',
        'FEATURE',
        'CUSTOM',
      ],
      default: 'SYSTEM',
    },

    title: { type: String, required: true },
    message: { type: String, required: true },

    // Link to navigate on click (e.g. '/admin/orders')
    link: { type: String, default: null },

    // resourceId for deep linking (e.g. order ID)
    resourceId: { type: String, default: null },
    resourceType: { type: String, default: null },

    // Per-user read tracking
    readBy: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        readAt: { type: Date, default: Date.now },
      },
    ],

    // Email sent tracking
    emailSentTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Index for fast queries per user/role
notificationSchema.index({ targetRoles: 1, createdAt: -1 });
notificationSchema.index({ targetUsers: 1, createdAt: -1 });
notificationSchema.index({ targetType: 1, createdAt: -1 });


// PHASE 3: country dimension + isolation hooks
notificationSchema.plugin(countryScopedPlugin);

const NotificationModel = mongoose.model('Notification', notificationSchema);
export default NotificationModel;
