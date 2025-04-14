import mongoose from 'mongoose';

const coffeeRoastAreaSchema = new mongoose.Schema(
  {
    city: {
      type: String,
      required: false,
      trim: true,
    },
    region: {
      type: String,
      required: false,
      trim: true,
    },
    country: {
      type: String,
      required: true,
      default: 'Italy',
    },
    latitude: {
      type: Number,
      required: false,
    },
    longitude: {
      type: Number,
      required: false,
    },
    slug: {
      type: String,
      unique: true,
      required: true,
    },
  },
  { timestamps: true }
);

const CoffeeRoastAreaModel = mongoose.model(
  'coffee_roast_area',
  coffeeRoastAreaSchema
);

export default CoffeeRoastAreaModel;
