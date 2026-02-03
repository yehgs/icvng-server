import mongoose from "mongoose";

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
        ref: "brand",
      },
    ],
    compatibleSystem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "brand",
    },
    producer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "brand",
    },
    productType: {
      type: String,
      enum: [
        "COFFEE",
        "MACHINE",
        "ACCESSORIES",
        "COFFEE_BEANS",
        "TEA",
        "DRINKS",
      ],
    },
    roastLevel: {
      type: String,
      enum: ["LIGHT", "MEDIUM", "DARK"],
      required: false,
    },
    roastOrigin: {
      type: String,
      required: false,
    },
    blend: {
      type: String,
      enum: [
        "100% Arabica",
        "100% Robusta",
        "Arabica/Robusta Blend (70/30)",
        "Arabica/Robusta Blend (30/70)",
        "Arabica/Robusta Blend (80/20)",
        "Arabica/Robusta Blend (40/60)",
        "Arabica/Robusta Blend (60/40)",
        "Arabica/Robusta Blend (20/80)",
        "Arabica/Robusta Blend (50/50)",
        "Arabica/Robusta Blend (90/10)",
        "Arabica/Robusta Blend (10/90)",
        "Single Origin Arabica",
        "Estate Blend",
        "House Blend",
        "Breakfast Blend",
        "Espresso Blend",
        "Mocha-Java Blend",
        "Mocha Italia",
        "Cappuccino Blend",
        "African Blend",
        "Latin American Blend",
        "Indonesian Blend",
        "Italian Roast Blend",
        "French Roast Blend",
        "Varius Blend",
      ],
      required: false,
    },
    featured: {
      type: Boolean,
      default: false,
      required: false,
    },
    btbProduct: {
      type: Boolean,
      default: false,
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
        "1/10",
        "2/10",
        "3/10",
        "4/10",
        "5/10",
        "6/10",
        "7/10",
        "8/10",
        "9/10",
        "10/10",
      ],
      required: false,
    },
    colors: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Color",
      },
    ],
    coffeeRoastAreas: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "coffee_roast_area",
      required: false,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "category",
      required: true,
    },
    subCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "subCategory",
      required: false,
    },
    tags: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "tag",
      },
    ],
    attributes: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "attribute",
      },
    ],
    ratings: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Rating",
      },
    ],
    averageRating: { type: Number, default: 0 },
    unit: {
      type: String,
      default: "",
    },
    packaging: {
      type: String,
      default: "",
    },
    stock: {
      type: Number,
      default: 0,
    },
    warehouseStock: {
      enabled: {
        type: Boolean,
        default: false,
      },
      stockOnArrival: {
        type: Number,
        default: 0,
        min: 0,
      },
      damagedQty: {
        type: Number,
        default: 0,
        min: 0,
      },
      expiredQty: {
        type: Number,
        default: 0,
        min: 0,
      },
      refurbishedQty: {
        type: Number,
        default: 0,
        min: 0,
      },
      finalStock: {
        type: Number,
        default: 0,
        min: 0,
      },
      onlineStock: {
        type: Number,
        default: 0,
        min: 0,
      },
      offlineStock: {
        type: Number,
        default: 0,
        min: 0,
      },
      notes: {
        type: String,
        default: "",
      },
      lastUpdated: {
        type: Date,
        default: Date.now,
      },
      updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    },

    stockSource: {
      type: String,
      enum: ["WAREHOUSE_MANUAL", "STOCK_BATCHES", "PRODUCT_DEFAULT"],
      default: "PRODUCT_DEFAULT",
    },
    productAvailability: {
      type: Boolean,
      default: true,
      required: false,
    },
    price: {
      type: Number,
      required: true,
    },
    salePrice: {
      type: Number,
      default: 0,
    },
    price3weeksDelivery: {
      type: Number,
      default: 0,
    },
    price5weeksDelivery: {
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
    pricing: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductPricing",
    },
    isPerishable: {
      type: Boolean,
      default: function () {
        // Auto-determine based on product type
        const perishableTypes = ["COFFEE_BEANS", "COFFEE", "TEA", "DRINKS"];
        return perishableTypes.includes(this.productType);
      },
    },

    shelfLifeDays: {
      type: Number,
      default: function () {
        // Default shelf life based on product type
        const shelfLifeMap = {
          COFFEE_BEANS: 365, // 1 year for beans
          COFFEE: 730, // 2 years for ground/instant
          TEA: 1095, // 3 years for tea
          DRINKS: 180, // 6 months for beverages
        };
        return shelfLifeMap[this.productType] || null;
      },
    },

    expirationWarningDays: {
      type: Number,
      default: 30, // Warn 30 days before expiration
    },

    discount: {
      type: Number,
      default: 0,
    },
    // Product details
    sku: {
      type: String,
      unique: true,
      required: true,
      sparse: true, // Allow temporary empty values during creation
    },
    description: {
      type: String,
      default: "",
    },
    shortDescription: {
      type: String,
      default: "",
    },
    additionalInfo: {
      type: String,
      default: "",
    },
    more_details: {
      type: Object,
      default: {},
    },
    seoTitle: {
      type: String,
      default: "",
    },
    seoDescription: {
      type: String,
      default: "",
    },
    publish: {
      type: String,
      enum: ["PUBLISHED", "PENDING", "DRAFT"],
      default: "PENDING",
    },
    relatedProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
);

// Create a text index for search functionality
productSchema.index(
  {
    name: "text",
    description: "text",
    seoTitle: "text",
    seoDescription: "text",
  },
  {
    weights: {
      name: 10,
      description: 5,
      seoTitle: 8,
      seoDescription: 6,
    },
  },
);

// Virtual to check if warehouse override is active
productSchema.virtual("isWarehouseManaged").get(function () {
  return this.warehouseStock?.enabled === true;
});

// Virtual to get effective stock (prioritizes warehouse override)
productSchema.virtual("effectiveStock").get(function () {
  if (this.warehouseStock?.enabled) {
    return this.warehouseStock.finalStock || 0;
  }
  return this.stock || 0;
});

// Virtual to get stock status based on effective stock
productSchema.virtual("stockStatus").get(function () {
  const stock = this.effectiveStock;

  if (stock === 0) return "OUT_OF_STOCK";
  if (stock <= 5) return "CRITICAL_STOCK";
  if (stock <= 10) return "LOW_STOCK";
  return "IN_STOCK";
});

// Add index for warehouse stock queries
productSchema.index({ "warehouseStock.enabled": 1 });
productSchema.index({ stockSource: 1 });
productSchema.index({ "warehouseStock.lastUpdated": -1 });

// Note: Your existing Stock model remains unchanged!
// The warehouse system works as an overlay that can optionally override
// the stock calculations from your existing Stock model.

const ProductModel = mongoose.model("Product", productSchema);

export default ProductModel;
