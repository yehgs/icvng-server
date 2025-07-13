// models/compare.model.js
import mongoose from 'mongoose';

const compareSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: true,
    },
    productId: {
      type: mongoose.Schema.ObjectId,
      ref: 'Product',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Create compound index to ensure a user can't add the same product twice
compareSchema.index({ userId: 1, productId: 1 }, { unique: true });

const CompareModel = mongoose.model('Compare', compareSchema);

export default CompareModel;
