import mongoose from 'mongoose';

const brandSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      default: '',
    },
    slug: {
      type: String,
      unique: true,
      required: true,
    },
    image: {
      type: String,
      default: '',
    },
    compatibleSystem: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

const BrandModel = mongoose.model('brand', brandSchema);

export default BrandModel;
