import mongoose from 'mongoose';
import countryScopedPlugin from "../core/countryScopedPlugin.js";

const ratingSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    rating: { type: Number, required: true, min: 1, max: 5 },
    review: { type: String },
  },
  { timestamps: true }
);


// PHASE 3: country dimension + isolation hooks
ratingSchema.plugin(countryScopedPlugin);

const RatingModel = mongoose.model('Rating', ratingSchema);

export default RatingModel;
