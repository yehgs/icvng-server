import Stripe from '../config/stripe.js';
import CartProductModel from '../models/cartproduct.model.js';
import OrderModel from '../models/order.model.js';
import UserModel from '../models/user.model.js';
import ExchangeRateModel from '../models/exchange-rate.model.js';
import mongoose from 'mongoose';

// Helper function to get effective stock
const getEffectiveStock = (product) => {
  if (
    product.warehouseStock?.enabled &&
    product.warehouseStock.onlineStock !== undefined
  ) {
    return product.warehouseStock.onlineStock;
  }
  return product.stock || 0;
};

export const pricewithDiscount = (price, dis = 0) => {
  const discountAmount = Math.ceil((Number(price) * Number(dis)) / 100);
  const actualPrice = Number(price) - Number(discountAmount);
  return actualPrice;
};

// Helper function to get product price based on price option
const getProductPrice = (product, priceOption = 'regular') => {
  switch (priceOption) {
    case '3weeks':
      return product.price3weeksDelivery || product.price;
    case '5weeks':
      return product.price5weeksDelivery || product.price;
    case 'regular':
    default:
      return product.price;
  }
};

// Helper function to convert currency
const convertCurrency = async (amount, fromCurrency, toCurrency) => {
  if (fromCurrency === toCurrency) return amount;

  try {
    const rate = await ExchangeRateModel.getRate(fromCurrency, toCurrency);
    if (rate) {
      return amount * rate;
    }
    return amount; // Return original if no rate found
  } catch (error) {
    console.error('Currency conversion error:', error);
    return amount;
  }
};

export async function CashOnDeliveryOrderController(request, response) {
  try {
    const userId = request.userId;
    const {
      list_items,
      totalAmt,
      addressId,
      subTotalAmt,
      currency = 'NGN',
    } = request.body;

    // Cash on delivery only available for NGN
    if (currency !== 'NGN') {
      return response.status(400).json({
        message: 'Cash on Delivery is only available for NGN currency',
        error: true,
        success: false,
      });
    }

    // Validate stock for all items
    for (const item of list_items) {
      if (!item.productId.productAvailability) {
        return response.status(400).json({
          message: `Product ${item.productId.name} is no longer available`,
          error: true,
          success: false,
        });
      }

      // Check stock only for regular delivery
      const priceOption = item.priceOption || 'regular';
      if (priceOption === 'regular') {
        const effectiveStock = getEffectiveStock(item.productId);
        if (item.quantity > effectiveStock) {
          return response.status(400).json({
            message: `Insufficient stock for ${item.productId.name}. Only ${effectiveStock} available`,
            error: true,
            success: false,
          });
        }
      }
    }

    // Generate transaction reference
    const txRef = `FLW-${Date.now()}-${userId}`;

    // Prepare Flutterwave payment data
    const paymentData = {
      tx_ref: txRef,
      amount: totalAmt,
      currency: currency,
      redirect_url: `${process.env.FRONTEND_URL}/payment/flutterwave/callback`,
      customer: {
        email: user.email,
        name: user.name || user.email,
        phonenumber: user.mobile || '',
      },
      customizations: {
        title: 'Order Payment',
        description: 'Payment for order items',
        logo: process.env.LOGO_URL || '',
      },
      meta: {
        userId: userId,
        addressId: addressId,
        itemCount: list_items.length,
      },
    };

    // Create Flutterwave payment link
    const flutterwaveResponse = await fetch(
      'https://api.flutterwave.com/v3/payments',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(paymentData),
      }
    );

    const flutterwaveData = await flutterwaveResponse.json();

    if (flutterwaveData.status === 'success') {
      return response.json({
        success: true,
        paymentUrl: flutterwaveData.data.link,
        txRef: txRef,
        message: 'Payment link generated successfully',
      });
    } else {
      throw new Error(
        flutterwaveData.message || 'Failed to create payment link'
      );
    }
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
}

// Flutterwave webhook handler
export async function flutterwaveWebhookController(request, response) {
  try {
    const signature = request.headers['verif-hash'];

    if (!signature || signature !== process.env.FLUTTERWAVE_WEBHOOK_HASH) {
      return response.status(401).json({
        message: 'Unauthorized webhook',
        error: true,
      });
    }

    const payload = request.body;

    if (
      payload.event === 'charge.completed' &&
      payload.data.status === 'successful'
    ) {
      const { tx_ref, amount, currency, customer, meta } = payload.data;

      // Get cart items for this user
      const cartItems = await CartProductModel.find({
        userId: meta.userId,
      }).populate('productId');

      if (cartItems.length === 0) {
        return response.status(400).json({
          message: 'No cart items found',
          error: true,
        });
      }

      // Create order items
      const orderItems = cartItems.map((item) => {
        const priceOption = item.priceOption || 'regular';
        const productPrice = getProductPrice(item.productId, priceOption);
        const finalPrice = pricewithDiscount(
          productPrice,
          item.productId.discount
        );

        return {
          userId: meta.userId,
          orderId: `ORD-${new mongoose.Types.ObjectId()}`,
          productId: item.productId._id,
          product_details: {
            name: item.productId.name,
            image: item.productId.image,
            priceOption: priceOption,
            deliveryTime: priceOption,
          },
          paymentId: tx_ref,
          payment_status: 'PAID',
          delivery_address: meta.addressId,
          subTotalAmt: finalPrice * item.quantity,
          totalAmt: finalPrice * item.quantity,
          currency: currency,
          quantity: item.quantity,
          unitPrice: finalPrice,
        };
      });

      // Save orders
      const orders = await OrderModel.insertMany(orderItems);

      // Clear cart
      await CartProductModel.deleteMany({ userId: meta.userId });
      await UserModel.updateOne({ _id: meta.userId }, { shopping_cart: [] });

      console.log(`Flutterwave payment completed for user ${meta.userId}`);
    }

    return response.json({ received: true });
  } catch (error) {
    console.error('Flutterwave webhook error:', error);
    return response.status(500).json({
      message: error.message,
      error: true,
    });
  }
}

const getOrderProductItems = async ({
  lineItems,
  userId,
  addressId,
  paymentId,
  payment_status,
  originalCurrency,
  paymentCurrency,
}) => {
  const productList = [];

  if (lineItems?.data?.length) {
    for (const item of lineItems.data) {
      const product = await Stripe.products.retrieve(item.price.product);
      const priceOption = product.metadata.priceOption || 'regular';

      // Convert amount back to base currency if needed
      let amountInBaseCurrency = item.amount_total / 100;
      if (paymentCurrency !== originalCurrency) {
        amountInBaseCurrency = await convertCurrency(
          amountInBaseCurrency,
          paymentCurrency,
          originalCurrency
        );
      }

      const payload = {
        userId: userId,
        orderId: `ORD-${new mongoose.Types.ObjectId()}`,
        productId: product.metadata.productId,
        product_details: {
          name: product.name,
          image: product.images,
          priceOption: priceOption,
          deliveryTime: priceOption,
        },
        paymentId: paymentId,
        payment_status: payment_status,
        delivery_address: addressId,
        subTotalAmt: amountInBaseCurrency,
        totalAmt: amountInBaseCurrency,
        currency: originalCurrency,
        quantity: item.quantity,
        unitPrice: amountInBaseCurrency / item.quantity,
      };

      productList.push(payload);
    }
  }

  return productList;
};

// Updated webhook for Stripe
export async function webhookStripe(request, response) {
  const event = request.body;
  const endPointSecret = process.env.STRIPE_ENDPOINT_WEBHOOK_SECRET_KEY;

  console.log('Stripe webhook event:', event.type);

  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      const lineItems = await Stripe.checkout.sessions.listLineItems(
        session.id
      );
      const userId = session.metadata.userId;

      const orderProduct = await getOrderProductItems({
        lineItems: lineItems,
        userId: userId,
        addressId: session.metadata.addressId,
        paymentId: session.payment_intent,
        payment_status: session.payment_status,
        originalCurrency: session.metadata.originalCurrency || 'NGN',
        paymentCurrency:
          session.metadata.paymentCurrency || session.currency.toUpperCase(),
      });

      const order = await OrderModel.insertMany(orderProduct);

      console.log('Stripe orders created:', order.length);

      if (Boolean(order[0])) {
        const removeCartItems = await UserModel.findByIdAndUpdate(userId, {
          shopping_cart: [],
        });
        const removeCartProductDB = await CartProductModel.deleteMany({
          userId: userId,
        });
      }
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  return response.json({ received: true });
}

export async function getOrderDetailsController(request, response) {
  try {
    const userId = request.userId;

    const orderlist = await OrderModel.find({ userId: userId })
      .sort({ createdAt: -1 })
      .populate('delivery_address');

    return response.json({
      message: 'Order list retrieved successfully',
      data: orderlist,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
}

export async function paymentController(request, response) {
  try {
    const userId = request.userId;
    const {
      list_items,
      totalAmt,
      addressId,
      subTotalAmt,
      currency = 'NGN',
      paymentMethod = 'stripe',
    } = request.body;

    const user = await UserModel.findById(userId);

    // Validate stock for all items
    for (const item of list_items) {
      if (!item.productId.productAvailability) {
        return response.status(400).json({
          message: `Product ${item.productId.name} is no longer available`,
          error: true,
          success: false,
        });
      }

      const priceOption = item.priceOption || 'regular';
      if (priceOption === 'regular') {
        const effectiveStock = getEffectiveStock(item.productId);
        if (item.quantity > effectiveStock) {
          return response.status(400).json({
            message: `Insufficient stock for ${item.productId.name}. Only ${effectiveStock} available`,
            error: true,
            success: false,
          });
        }
      }
    }

    // Convert amounts to payment currency if needed
    let paymentAmount = totalAmt;
    if (currency !== 'NGN') {
      paymentAmount = await convertCurrency(totalAmt, 'NGN', currency);
    }

    const line_items = list_items.map((item) => {
      const priceOption = item.priceOption || 'regular';
      const productPrice = getProductPrice(item.productId, priceOption);
      let finalPrice = pricewithDiscount(productPrice, item.productId.discount);

      // Convert price to payment currency
      if (currency !== 'NGN') {
        finalPrice = finalPrice * (paymentAmount / totalAmt); // Use ratio to maintain accuracy
      }

      return {
        price_data: {
          currency: currency.toLowerCase(),
          product_data: {
            name: `${item.productId.name} - ${priceOption} delivery`,
            images: item.productId.image,
            metadata: {
              productId: item.productId._id,
              priceOption: priceOption,
            },
          },
          unit_amount: Math.round(finalPrice * 100), // Convert to cents
        },
        adjustable_quantity: {
          enabled: true,
          minimum: 1,
        },
        quantity: item.quantity,
      };
    });

    const params = {
      submit_type: 'pay',
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: user.email,
      metadata: {
        userId: userId,
        addressId: addressId,
        originalCurrency: 'NGN',
        paymentCurrency: currency,
      },
      line_items: line_items,
      success_url: `${process.env.FRONTEND_URL}/success`,
      cancel_url: `${process.env.FRONTEND_URL}/cancel`,
    };

    const session = await Stripe.checkout.sessions.create(params);

    return response.status(200).json({
      id: session.id,
      url: session.url,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
}

// Flutterwave payment controller
export async function flutterwavePaymentController(request, response) {
  try {
    const userId = request.userId;
    const {
      list_items,
      totalAmt,
      addressId,
      subTotalAmt,
      currency = 'NGN',
    } = request.body;

    const user = await UserModel.findById(userId);

    // Validate stock for all items
    for (const item of list_items) {
      if (!item.productId.productAvailability) {
        return response.status(400).json({
          message: `Product ${item.productId.name} is no longer available`,
          error: true,
          success: false,
        });
      }

      const priceOption = item.priceOption || 'regular';
      if (priceOption === 'regular') {
        const effectiveStock = getEffectiveStock(item.productId);
        if (item.quantity > effectiveStock) {
          return response.status(400).json({
            message: `Insufficient stock for ${item.productId.name}. Only ${effectiveStock} available`,
            error: true,
            success: false,
          });
        }
      }
    }

    // Generate transaction reference
    const txRef = `FLW-${Date.now()}-${userId}`;

    // Prepare Flutterwave payment data
    const paymentData = {
      tx_ref: txRef,
      amount: totalAmt,
      currency: currency,
      redirect_url: `${process.env.FRONTEND_URL}/payment/flutterwave/callback`,
      customer: {
        email: user.email,
        name: user.name || user.email,
        phonenumber: user.mobile || '',
      },
      customizations: {
        title: 'Order Payment',
        description: 'Payment for order items',
        logo: process.env.LOGO_URL || '',
      },
      meta: {
        userId: userId,
        addressId: addressId,
        itemCount: list_items.length,
      },
    };

    // Create Flutterwave payment link
    const flutterwaveResponse = await fetch(
      'https://api.flutterwave.com/v3/payments',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(paymentData),
      }
    );

    const flutterwaveData = await flutterwaveResponse.json();

    if (flutterwaveData.status === 'success') {
      return response.json({
        success: true,
        paymentUrl: flutterwaveData.data.link,
        txRef: txRef,
        message: 'Payment link generated successfully',
      });
    } else {
      throw new Error(
        flutterwaveData.message || 'Failed to create payment link'
      );
    }
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
}
