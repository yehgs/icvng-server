import mongoose from 'mongoose';
import { countryField } from '../config/countrySchema.js';

const productRequestSchema = new mongoose.Schema(
  {
    ...countryField,
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    message: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'REJECTED'],
      default: 'PENDING',
    },
    adminNotes: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

const ProductRequestModel = mongoose.model(
  'productRequest',
  productRequestSchema
);

export default ProductRequestModel;
