import mongoose from 'mongoose';

const bannerSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      default: '',
      trim: true,
    },
    subtitle: {
      type: String,
      default: '',
      trim: true,
    },
    image: {
      type: String,
      required: true,
    },
    link: {
      type: String,
      default: '',
    },
    linkText: {
      type: String,
      default: 'Learn More',
    },
    position: {
      type: String,
      enum: ['homepage_side1', 'homepage_side2', 'footer'],
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    slug: {
      type: String,
      unique: true,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Index for better query performance
bannerSchema.index({ position: 1 });

const BannerModel = mongoose.model('banner', bannerSchema);

export default BannerModel;
