import mongoose from 'mongoose';

const cartProductSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.ObjectId,
      ref: 'Product',
      required: true,
    },
    quantity: {
      type: Number,
      default: 1,
      min: 1,
      max: 999,
    },
    userId: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: true,
    },
    priceOption: {
      type: String,
      enum: ['regular', '3weeks', '5weeks'],
      default: 'regular',
    },
    // Store selected price at the time of adding to cart
    selectedPrice: {
      type: Number,
      default: 0,
    },
    // Store any additional options or customizations
    customizations: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // Track when item was added to cart
    addedAt: {
      type: Date,
      default: Date.now,
    },
    // Track last update
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// FIXED: Create compound index for user, product AND priceOption
// This allows the same product with different price options
cartProductSchema.index(
  { userId: 1, productId: 1, priceOption: 1 },
  { unique: true }
);

// Create index for faster user cart queries
cartProductSchema.index({ userId: 1, createdAt: -1 });

// Pre-save middleware to update lastUpdated timestamp
cartProductSchema.pre('save', function (next) {
  this.lastUpdated = new Date();
  next();
});

// Virtual to calculate item total based on selected price and quantity
cartProductSchema.virtual('itemTotal').get(function () {
  return (this.selectedPrice || 0) * this.quantity;
});

// Virtual to get delivery time description
cartProductSchema.virtual('deliveryTimeDescription').get(function () {
  const descriptions = {
    regular: 'Standard delivery (3-5 days)',
    '3weeks': 'Express delivery (3 weeks)',
    '5weeks': 'Economy delivery (5 weeks)',
  };
  return descriptions[this.priceOption] || 'Standard delivery';
});

// Instance method to update price based on current product pricing
cartProductSchema.methods.updatePriceFromProduct = async function () {
  await this.populate('productId');

  if (!this.productId) {
    throw new Error('Product not found');
  }

  const priceOption = this.priceOption || 'regular';
  let price;

  // Get base price based on price option
  switch (priceOption) {
    case '3weeks':
      price =
        this.productId.price3weeksDelivery ||
        this.productId.btcPrice ||
        this.productId.price;
      break;
    case '5weeks':
      price =
        this.productId.price5weeksDelivery ||
        this.productId.btcPrice ||
        this.productId.price;
      break;
    case 'regular':
    default:
      // For regular, use btcPrice first, then price
      price =
        this.productId.btcPrice && this.productId.btcPrice > 0
          ? this.productId.btcPrice
          : this.productId.price;
      break;
  }

  // Apply discount if any
  if (this.productId.discount > 0) {
    const discountAmount = (price * this.productId.discount) / 100;
    price = price - discountAmount;
  }

  this.selectedPrice = price;
  return this.save();
};

// Static method to get cart summary for a user
cartProductSchema.statics.getCartSummary = async function (userId) {
  const cartItems = await this.find({ userId }).populate('productId');

  if (!cartItems.length) {
    return {
      items: [],
      totalQuantity: 0,
      subtotal: 0,
      totalDiscount: 0,
      grandTotal: 0,
      isEmpty: true,
    };
  }

  let totalQuantity = 0;
  let subtotal = 0;
  let totalDiscount = 0;

  const itemsWithCalculations = cartItems
    .map((item) => {
      if (!item.productId) return null;

      // Get current price based on price option
      let currentPrice;
      switch (item.priceOption) {
        case '3weeks':
          currentPrice =
            item.productId.price3weeksDelivery || item.productId.price;
          break;
        case '5weeks':
          currentPrice =
            item.productId.price5weeksDelivery || item.productId.price;
          break;
        case 'regular':
        default:
          currentPrice = item.productId.price;
          break;
      }

      const originalPrice = currentPrice;
      const discountAmount =
        item.productId.discount > 0
          ? (currentPrice * item.productId.discount) / 100
          : 0;
      const finalPrice = currentPrice - discountAmount;
      const lineTotal = finalPrice * item.quantity;
      const lineDiscount = discountAmount * item.quantity;

      totalQuantity += item.quantity;
      subtotal += lineTotal;
      totalDiscount += lineDiscount;

      return {
        ...item.toObject(),
        currentPrice: originalPrice,
        finalPrice: finalPrice,
        lineTotal: lineTotal,
        lineDiscount: lineDiscount,
        discountPercentage: item.productId.discount || 0,
      };
    })
    .filter(Boolean);

  return {
    items: itemsWithCalculations,
    totalQuantity,
    subtotal: subtotal + totalDiscount, // Original subtotal before discount
    totalDiscount,
    grandTotal: subtotal,
    isEmpty: false,
  };
};

// Static method to clean up stale cart items (older than 30 days)
cartProductSchema.statics.cleanupStaleItems = async function (daysOld = 30) {
  const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

  const result = await this.deleteMany({
    createdAt: { $lt: cutoffDate },
  });

  return result.deletedCount;
};

// Static method to validate cart items stock
cartProductSchema.statics.validateCartStock = async function (userId) {
  const cartItems = await this.find({ userId }).populate('productId');
  const validationResults = [];

  for (const item of cartItems) {
    if (!item.productId || !item.productId.productAvailability) {
      validationResults.push({
        cartItemId: item._id,
        productId: item.productId?._id,
        status: 'unavailable',
        message: 'Product no longer available',
      });
      continue;
    }

    // Check stock only for regular delivery
    if (item.priceOption === 'regular') {
      const effectiveStock = item.productId.warehouseStock?.enabled
        ? item.productId.warehouseStock.onlineStock
        : item.productId.stock;

      if (item.quantity > effectiveStock) {
        validationResults.push({
          cartItemId: item._id,
          productId: item.productId._id,
          status: 'insufficient_stock',
          availableStock: effectiveStock,
          requestedQuantity: item.quantity,
          message: `Only ${effectiveStock} items available`,
        });
        continue;
      }
    }

    validationResults.push({
      cartItemId: item._id,
      productId: item.productId._id,
      status: 'valid',
    });
  }

  return validationResults;
};

const CartProductModel = mongoose.model('cartProduct', cartProductSchema);

export default CartProductModel;
