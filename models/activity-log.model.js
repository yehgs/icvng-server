// server/models/activity-log.model.js
import mongoose from "mongoose";

const activityLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    action: {
      type: String,
      required: true,
      enum: [
        // Products
        "PRODUCT_CREATE",
        "PRODUCT_UPDATE",
        "PRODUCT_DELETE",
        "PRODUCT_RESTORE",
        // Stock
        "STOCK_ADD",
        "STOCK_UPDATE",
        "STOCK_DEDUCT",
        "STOCK_ADJUST",
        "BATCH_CREATE",
        "BATCH_UPDATE",
        "BATCH_DELETE",
        // Orders
        "ORDER_CREATE",
        "ORDER_UPDATE",
        "ORDER_STATUS_CHANGE",
        "ORDER_DELETE",
        "ORDER_CANCEL",
        // Customers
        "CUSTOMER_CREATE",
        "CUSTOMER_UPDATE",
        "CUSTOMER_DELETE",
        // Users (admin)
        "USER_CREATE",
        "USER_UPDATE",
        "USER_DELETE",
        "USER_ROLE_CHANGE",
        "USER_SUSPEND",
        // Pricing
        "PRICE_UPDATE",
        "EXCHANGE_RATE_UPDATE",
        "DISCOUNT_CREATE",
        "DISCOUNT_UPDATE",
        // Logistics
        "LOGISTICS_CREATE",
        "LOGISTICS_UPDATE",
        "LOGISTICS_DELETE",
        "SHIPMENT_CREATE",
        "SHIPMENT_UPDATE",
        "TRACKING_UPDATE",
        // Categories / Brands
        "CATEGORY_CREATE",
        "CATEGORY_UPDATE",
        "CATEGORY_DELETE",
        "BRAND_CREATE",
        "BRAND_UPDATE",
        "BRAND_DELETE",
        // Purchase orders
        "PURCHASE_ORDER_CREATE",
        "PURCHASE_ORDER_UPDATE",
        "PURCHASE_ORDER_DELETE",
        // Auth
        "LOGIN",
        "LOGOUT",
        "PASSWORD_CHANGE",
        // Settings
        "SETTINGS_UPDATE",
        "SYSTEM_CONFIG_CHANGE",
        // Warehouse
        "WAREHOUSE_STOCK_UPDATE",
        "WAREHOUSE_SYSTEM_TOGGLE",
        // Blog
        "BLOG_POST_CREATE",
        "BLOG_POST_UPDATE",
        "BLOG_POST_DELETE",
        // Generic fallback
        "OTHER",
      ],
    },
    // Human-readable description
    description: {
      type: String,
      required: true,
    },
    // The resource being acted upon
    resourceType: {
      type: String,
      enum: [
        "Product",
        "Order",
        "Customer",
        "User",
        "Stock",
        "Batch",
        "ExchangeRate",
        "Price",
        "Logistics",
        "Shipment",
        "Category",
        "Brand",
        "PurchaseOrder",
        "Setting",
        "Blog",
        "Warehouse",
        "Other",
      ],
      default: "Other",
    },
    resourceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    resourceName: {
      type: String,
      default: "",
    },
    // Before/after snapshot for edits
    changes: {
      before: { type: mongoose.Schema.Types.Mixed, default: null },
      after: { type: mongoose.Schema.Types.Mixed, default: null },
    },
    // Request metadata
    metadata: {
      ip: { type: String, default: "" },
      userAgent: { type: String, default: "" },
    },
    // Status of the action
    status: {
      type: String,
      enum: ["SUCCESS", "FAILED", "PARTIAL"],
      default: "SUCCESS",
    },
  },
  { timestamps: true },
);

// Indexes
activityLogSchema.index({ user: 1, createdAt: -1 });
activityLogSchema.index({ action: 1, createdAt: -1 });
activityLogSchema.index({ resourceType: 1, createdAt: -1 });
activityLogSchema.index({ createdAt: -1 });

const ActivityLogModel = mongoose.model("ActivityLog", activityLogSchema);
export default ActivityLogModel;
