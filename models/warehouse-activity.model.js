// models/warehouseActivity.model.js
import mongoose from "mongoose";

const warehouseActivitySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    action: {
      type: String,
      enum: [
        "STOCK_UPDATE",
        "WEIGHT_UPDATE",
        "SYSTEM_ENABLED",
        "SYSTEM_DISABLED",
        "BULK_STOCK_UPDATE",
        "WAREHOUSE_OVERRIDE_DISABLED",
        "BULK_STOCK_SYNC",
        "STOCK_RECONCILIATION",
        "SETTINGS_UPDATE",
      ],
      required: true,
    },
    target: {
      type: {
        type: String,
        enum: ["PRODUCT", "SYSTEM"],
        required: true,
      },
      id: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: "target.type",
      },
      name: String,
      sku: String,
    },
    changes: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
    },
    notes: {
      type: String,
      default: "",
    },
    metadata: {
      ip: String,
      userAgent: String,
      sessionId: String,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for better query performance
warehouseActivitySchema.index({ user: 1, createdAt: -1 });
warehouseActivitySchema.index({ action: 1, createdAt: -1 });
warehouseActivitySchema.index({ "target.id": 1, createdAt: -1 });
warehouseActivitySchema.index({ createdAt: -1 });

const WarehouseActivityModel = mongoose.model(
  "WarehouseActivity",
  warehouseActivitySchema
);

export default WarehouseActivityModel;
