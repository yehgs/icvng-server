import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    slug: {
      type: String,
      unique: true,
      required: true,
    },
    image: {
      type: Array,
      default: [],
    },
    weight: {
      type: Number,
    },
    brand: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'brand',
      },
    ],
    compatibleSystem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'brand',
    },
    producer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'brand',
    },
    productType: {
      type: String,
      enum: [
        'COFFEE',
        'MACHINE',
        'ACCESSORIES',
        'COFFEE_BEANS',
        'TEA',
        'DRINKS',
      ],
    },
    roastLevel: {
      type: String,
      enum: ['LIGHT', 'MEDIUM', 'DARK'],
      required: false,
    },
    roastOrigin: {
      type: String,
      required: false,
    },
    blend: {
      type: String,
      enum: [
        '100% Arabica',
        '100% Robusta',
        'Arabica/Robusta Blend (70/30)',
        'Arabica/Robusta Blend (80/20)',
        'Arabica/Robusta Blend (40/60)',
        'Single Origin Arabica',
        'Estate Blend',
        'House Blend',
        'Breakfast Blend',
        'Espresso Blend',
        'Mocha-Java Blend',
        'Mocha Italia',
        'Cappuccino Blend',
        'African Blend',
        'Latin American Blend',
        'Indonesian Blend',
        'Italian Roast Blend',
        'French Roast Blend',
        'Varius Blend',
      ],
      required: false,
    },
    aromaticProfile: {
      type: String,
      required: false,
    },
    alcoholLevel: {
      type: String,
      required: false,
    },
    coffeeOrigin: {
      type: String,
      required: false,
    },
    intensity: {
      type: String,
      enum: [
        '1/10',
        '2/10',
        '3/10',
        '4/10',
        '5/10',
        '6/10',
        '7/10',
        '8/10',
        '9/10',
        '10/10',
      ],
      required: false,
    },
    coffeeRoastAreas: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'coffee_roast_area',
      required: false,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'category',
      required: true,
    },
    subCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'subCategory',
      required: false,
    },
    tags: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'tag',
      },
    ],
    attributes: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'attribute',
      },
    ],
    ratings: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Rating',
      },
    ],
    averageRating: { type: Number, default: 0 },
    unit: {
      type: String,
      default: '',
    },
    packaging: {
      type: String,
      default: '',
    },
    stock: {
      type: Number,
      default: 0,
    },
    price: {
      type: Number,
      required: true,
    },
    salePrice: {
      type: Number,
      default: 0,
    },
    btbPrice: {
      type: Number,
      default: 0,
    },
    btcPrice: {
      type: Number,
      default: 0,
    },
    discount: {
      type: Number,
      default: 0,
    },
    description: {
      type: String,
      default: '',
    },
    shortDescription: {
      type: String,
      default: '',
    },
    additionalInfo: {
      type: String,
      default: '',
    },
    more_details: {
      type: Object,
      default: {},
    },
    seoTitle: {
      type: String,
      default: '',
    },
    seoDescription: {
      type: String,
      default: '',
    },
    publish: {
      type: String,
      enum: ['PUBLISHED', 'PENDING', 'DRAFT'],
      default: 'PENDING',
    },
    relatedProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

// Create a text index for search functionality
productSchema.index(
  {
    name: 'text',
    description: 'text',
    seoTitle: 'text',
    seoDescription: 'text',
  },
  {
    weights: {
      name: 10,
      description: 5,
      seoTitle: 8,
      seoDescription: 6,
    },
  }
);

const ProductModel = mongoose.model('Product', productSchema);

export default ProductModel;
