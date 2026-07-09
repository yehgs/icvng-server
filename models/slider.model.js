import mongoose from 'mongoose';
import countryScopedPlugin from "../core/countryScopedPlugin.js";

const sliderSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      default: '',
    },
    imageUrl: {
      type: String,
      required: true,
    },
    url: {
      type: String,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);


// PHASE 3: country dimension + isolation hooks
sliderSchema.plugin(countryScopedPlugin);

const SliderModel = mongoose.model('slider', sliderSchema);

export default SliderModel;
