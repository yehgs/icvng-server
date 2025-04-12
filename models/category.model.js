import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema(
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
  },
  {
    timestamps: true,
  }
);

const CategoryModel = mongoose.model('category', categorySchema);

export default CategoryModel;
