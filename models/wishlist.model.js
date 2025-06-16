// models/wishlist.model.js
import mongoose from 'mongoose';

const wishlistSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: true,
    },
    productId: {
      type: mongoose.Schema.ObjectId,
      ref: 'product',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);
wishlistSchema.index({ userId: 1, productId: 1 }, { unique: true });

const WishlistModel = mongoose.model('Wishlist', wishlistSchema);

export default WishlistModel;
