// controllers/order.controller.js - Updated with Paystack integration
import OrderModel from '../models/order.model.js';
import CartProductModel from '../models/cartproduct.model.js';
import UserModel from '../models/user.model.js';
import ExchangeRateModel from '../models/exchange-rate.model.js';
import ShippingZoneModel from '../models/shipping-zone.model.js';
import ShippingMethodModel from '../models/shipping-method.model.js';
import ShippingTrackingModel from '../models/shipping-tracking.model.js';
import mongoose from 'mongoose';
import Stripe from '../config/stripe.js';
import crypto from 'crypto';
import {
  sendOrderConfirmationEmail,
  sendShippingNotificationEmail,
  sendOrderNotificationToTeam,
} from '../utils/emailTemplates.js';

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

// Helper function to convert currency using exchange rate system
const convertCurrency = async (amount, fromCurrency, toCurrency) => {
  if (fromCurrency === toCurrency) return amount;

  try {
    const rate = await ExchangeRateModel.getRate(fromCurrency, toCurrency);
    if (rate) {
      return amount * rate;
    }
    return amount;
  } catch (error) {
    console.error('Currency conversion error:', error);
    return amount;
  }
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

// Helper function to create tracking automatically
const createTrackingForOrder = async (order, userId) => {
  try {
    const existingTracking = await ShippingTrackingModel.findOne({
      orderId: order._id,
    });
    if (existingTracking) {
      return existingTracking;
    }

    const trackingData = {
      orderId: order._id,
      carrier: {
        name: 'I-Coffee Logistics',
        code: 'ICF',
        phone: '+234-800-ICOFFEE',
        website: 'https://i-coffee.ng',
      },
      shippingMethod: order.shippingMethod,
      estimatedDelivery: order.estimated_delivery,
      deliveryAddress: order.delivery_address
        ? {
            addressLine: order.delivery_address.address_line,
            city: order.delivery_address.city,
            state: order.delivery_address.state,
            postalCode: order.delivery_address.pincode,
            country: order.delivery_address.country || 'Nigeria',
          }
        : {},
      recipientInfo: {
        name: order.userId ? order.userId.name : 'Customer',
        phone: order.delivery_address?.mobile,
        email: order.userId ? order.userId.email : '',
      },
      packageInfo: {
        weight: 1,
        fragile: false,
        insured: order.totalAmt > 50000,
        insuranceValue: order.totalAmt > 50000 ? order.totalAmt : 0,
      },
      shippingCost: order.shipping_cost || 0,
      priority: 'NORMAL',
      createdBy: userId,
      updatedBy: userId,
    };

    const tracking = new ShippingTrackingModel(trackingData);
    const savedTracking = await tracking.save();

    await savedTracking.addTrackingEvent(
      {
        status: 'PENDING',
        description: 'Order confirmed and ready for processing',
        location: {
          facility: 'I-Coffee Fulfillment Center',
          city: 'Lagos',
          state: 'Lagos',
          country: 'Nigeria',
        },
      },
      userId
    );

    await OrderModel.findByIdAndUpdate(order._id, {
      tracking_number: savedTracking.trackingNumber,
    });

    return savedTracking;
  } catch (error) {
    console.error('Error creating tracking:', error);
    return null;
  }
};

// Direct Bank Transfer Controller (unchanged)
export async function DirectBankTransferOrderController(request, response) {
  try {
    const userId = request.userId;
    const {
      list_items,
      totalAmt,
      addressId,
      subTotalAmt,
      shippingCost = 0,
      shippingMethodId,
      currency = 'NGN',
      bankDetails,
    } = request.body;

    if (currency !== 'NGN') {
      return response.status(400).json({
        message: 'Direct Bank Transfer is only available for NGN currency',
        error: true,
        success: false,
      });
    }

    let shippingMethod = null;
    if (shippingMethodId) {
      shippingMethod = await ShippingMethodModel.findById(shippingMethodId);
      if (!shippingMethod) {
        return response.status(400).json({
          message: 'Invalid shipping method',
          error: true,
          success: false,
        });
      }
    }

    for (const item of list_items) {
      const productData = item.productId || item;
      if (!productData.productAvailability) {
        return response.status(400).json({
          message: `Product ${productData.name} is not available for production`,
          error: true,
          success: false,
        });
      }
    }

    let shippingZone = null;
    let address = null;
    if (addressId) {
      address = await mongoose.model('address').findById(addressId);
      if (address) {
        shippingZone = await ShippingZoneModel.findZoneByCity(
          address.city,
          address.state
        );
      }
    }

    const orderItems = list_items.map((item) => {
      const productData = item.productId || item;
      const priceOption = item.priceOption || 'regular';
      const productPrice = getProductPrice(productData, priceOption);
      const finalPrice = pricewithDiscount(productPrice, productData.discount);

      return {
        userId: userId,
        orderId: `BANK-${Date.now()}-${new mongoose.Types.ObjectId()}`,
        productId: productData._id,
        product_details: {
          name: productData.name,
          image: productData.image,
          priceOption: priceOption,
          deliveryTime: priceOption,
        },
        paymentId: `BANK-${Date.now()}`,
        payment_status: 'PENDING_BANK_TRANSFER',
        payment_method: 'BANK_TRANSFER',
        delivery_address: addressId,
        subTotalAmt: finalPrice * item.quantity,
        totalAmt: finalPrice * item.quantity + shippingCost / list_items.length,
        currency: currency,
        quantity: item.quantity,
        unitPrice: finalPrice,
        shippingMethod: shippingMethodId,
        shippingZone: shippingZone?._id,
        shipping_cost: shippingCost / list_items.length,
        shipping_details: shippingMethod
          ? {
              method_name: shippingMethod.name,
              method_type: shippingMethod.type,
              carrier: {
                name: 'I-Coffee Logistics',
                code: 'ICF',
              },
            }
          : {},
        bank_transfer_details: bankDetails,
        admin_notes: `Bank Transfer - Reference: ${bankDetails.reference}`,
      };
    });

    const orders = await OrderModel.insertMany(orderItems);

    for (const order of orders) {
      await createTrackingForOrder(order, userId);
    }

    try {
      const user = await UserModel.findById(userId);
      await sendOrderConfirmationEmail({
        user,
        order: orders[0],
        items: orderItems,
        shippingAddress: address,
        shippingMethod,
        trackingNumber: orders[0].tracking_number,
      });

      await sendOrderNotificationToTeam({
        user,
        order: orders[0],
        items: orderItems,
        orderType: 'Bank Transfer',
      });
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
    }

    await CartProductModel.deleteMany({ userId: userId });
    await UserModel.updateOne({ _id: userId }, { shopping_cart: [] });

    return response.json({
      message: 'Bank transfer order placed successfully',
      data: orders,
      bankDetails: bankDetails,
      shippingMethod: shippingMethod,
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

// ===== PAYSTACK PAYMENT CONTROLLER =====
export async function paystackPaymentController(request, response) {
  try {
    const userId = request.userId;
    const {
      list_items,
      totalAmt,
      addressId,
      subTotalAmt,
      shippingCost = 0,
      shippingMethodId,
      currency = 'NGN',
    } = request.body;

    // Paystack only supports NGN by default
    if (currency !== 'NGN') {
      return response.status(400).json({
        message: 'Paystack is only available for NGN currency',
        error: true,
        success: false,
      });
    }

    const user = await UserModel.findById(userId);

    // Validate products
    for (const item of list_items) {
      const productData = item.productId || item;
      if (!productData.productAvailability) {
        return response.status(400).json({
          message: `Product ${productData.name} is not available for production`,
          error: true,
          success: false,
        });
      }
    }

    // Generate transaction reference
    const txRef = `PSK-${Date.now()}-${userId}`;

    // Convert amount to kobo (Paystack uses smallest currency unit)
    const amountInKobo = Math.round(totalAmt * 100);

    // Prepare Paystack payment data
    const paymentData = {
      email: user.email,
      amount: amountInKobo,
      reference: txRef,
      currency: 'NGN',
      callback_url: `${process.env.FRONTEND_URL}/payment/paystack/callback`,
      metadata: {
        userId: userId.toString(),
        addressId: addressId,
        shippingMethodId: shippingMethodId || '',
        shippingCost: shippingCost,
        itemCount: list_items.length,
        custom_fields: [
          {
            display_name: 'Customer Name',
            variable_name: 'customer_name',
            value: user.name || user.email,
          },
          {
            display_name: 'Items Count',
            variable_name: 'items_count',
            value: list_items.length.toString(),
          },
        ],
      },
      channels: ['card', 'bank', 'ussd', 'qr', 'mobile_money', 'bank_transfer'],
    };

    // Initialize Paystack payment
    const paystackResponse = await fetch(
      'https://api.paystack.co/transaction/initialize',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(paymentData),
      }
    );

    const paystackData = await paystackResponse.json();

    if (paystackData.status === true) {
      // Store transaction reference for webhook verification
      await UserModel.findByIdAndUpdate(userId, {
        $push: {
          pending_payments: {
            reference: txRef,
            amount: totalAmt,
            items: list_items,
            addressId: addressId,
            shippingMethodId: shippingMethodId,
            shippingCost: shippingCost,
            createdAt: new Date(),
          },
        },
      });

      return response.json({
        success: true,
        paymentUrl: paystackData.data.authorization_url,
        accessCode: paystackData.data.access_code,
        reference: paystackData.data.reference,
        message: 'Payment link generated successfully',
      });
    } else {
      throw new Error(paystackData.message || 'Failed to create payment link');
    }
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
}

// ===== PAYSTACK WEBHOOK HANDLER =====
export async function paystackWebhookController(request, response) {
  try {
    // Verify webhook signature
    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(request.body))
      .digest('hex');

    if (hash !== request.headers['x-paystack-signature']) {
      return response.status(401).json({
        message: 'Unauthorized webhook',
        error: true,
      });
    }

    const { event, data } = request.body;

    if (event === 'charge.success') {
      const { reference, amount, currency, metadata, customer } = data;

      // Find user from metadata
      const userId = metadata.userId;
      const user = await UserModel.findById(userId);

      if (!user) {
        console.error('User not found for Paystack payment:', userId);
        return response.status(404).json({
          message: 'User not found',
          error: true,
        });
      }

      // Get pending payment details
      const pendingPayment = user.pending_payments?.find(
        (p) => p.reference === reference
      );

      if (!pendingPayment) {
        console.error('Pending payment not found:', reference);
        return response.status(404).json({
          message: 'Payment reference not found',
          error: true,
        });
      }

      // Get cart items
      const cartItems = await CartProductModel.find({
        userId: userId,
      }).populate({
        path: 'productId',
        populate: {
          path: 'category',
          select: 'name slug',
        },
      });

      if (cartItems.length === 0) {
        return response.status(400).json({
          message: 'No cart items found',
          error: true,
        });
      }

      // Validate products
      for (const item of cartItems) {
        if (!item.productId || !item.productId.productAvailability) {
          return response.status(400).json({
            message: `Product ${
              item.productId?.name || 'Unknown'
            } is not available for production`,
            error: true,
          });
        }
      }

      // Get shipping information
      let shippingZone = null;
      let shippingMethod = null;

      if (metadata.addressId) {
        const address = await mongoose
          .model('address')
          .findById(metadata.addressId);
        if (address) {
          shippingZone = await ShippingZoneModel.findZoneByCity(
            address.city,
            address.state
          );
        }
      }

      if (metadata.shippingMethodId) {
        shippingMethod = await ShippingMethodModel.findById(
          metadata.shippingMethodId
        );
      }

      const shippingCostPerItem =
        parseFloat(metadata.shippingCost || '0') / cartItems.length;

      // Create order items
      const orderItems = cartItems.map((item) => {
        const priceOption = item.priceOption || 'regular';
        const productPrice = getProductPrice(item.productId, priceOption);
        const finalPrice = pricewithDiscount(
          productPrice,
          item.productId.discount
        );

        return {
          userId: userId,
          orderId: `PSK-${new mongoose.Types.ObjectId()}`,
          productId: item.productId._id,
          product_details: {
            name: item.productId.name,
            image: item.productId.image,
            priceOption: priceOption,
            deliveryTime: priceOption,
          },
          paymentId: reference,
          payment_status: 'PAID',
          payment_method: 'PAYSTACK',
          delivery_address: metadata.addressId,
          subTotalAmt: finalPrice * item.quantity,
          totalAmt: finalPrice * item.quantity + shippingCostPerItem,
          currency: currency.toUpperCase(),
          quantity: item.quantity,
          unitPrice: finalPrice,
          shippingMethod: metadata.shippingMethodId,
          shippingZone: shippingZone?._id,
          shipping_cost: shippingCostPerItem,
          shipping_details: shippingMethod
            ? {
                method_name: shippingMethod.name,
                method_type: shippingMethod.type,
                carrier: {
                  name: 'I-Coffee Logistics',
                  code: 'ICF',
                },
                estimated_delivery_days: {
                  min: shippingMethod.estimatedDelivery?.minDays || 1,
                  max: shippingMethod.estimatedDelivery?.maxDays || 7,
                },
                weight: item.productId.weight || 1,
                dimensions: {
                  length: 20,
                  width: 15,
                  height: 10,
                  unit: 'cm',
                },
              }
            : {},
        };
      });

      // Save orders
      const orders = await OrderModel.insertMany(orderItems);

      // Create tracking for each order
      for (const order of orders) {
        try {
          await createTrackingForOrder(order, userId);

          // Send confirmation email
          const address = await mongoose
            .model('address')
            .findById(metadata.addressId);

          await sendOrderConfirmationEmail({
            user,
            order,
            items: [order],
            shippingAddress: address,
            shippingMethod,
            trackingNumber: order.tracking_number,
          });

          await sendOrderNotificationToTeam({
            user,
            order,
            items: [order],
            orderType: 'Paystack Payment',
          });
        } catch (trackingError) {
          console.error(
            'Failed to create tracking for order:',
            order._id,
            trackingError
          );
        }
      }

      // Clear cart and remove pending payment
      await CartProductModel.deleteMany({ userId: userId });
      await UserModel.updateOne(
        { _id: userId },
        {
          shopping_cart: [],
          $pull: { pending_payments: { reference: reference } },
        }
      );

      console.log(`Paystack payment completed for user ${userId}`);
    }

    return response.json({ received: true });
  } catch (error) {
    console.error('Paystack webhook error:', error);
    return response.status(500).json({
      message: error.message,
      error: true,
    });
  }
}

// ===== STRIPE PAYMENT CONTROLLER (Enhanced) =====
export async function stripePaymentController(request, response) {
  try {
    const userId = request.userId;
    const {
      list_items,
      totalAmt,
      addressId,
      subTotalAmt,
      shippingCost = 0,
      shippingMethodId,
      currency = 'USD',
      paymentMethod = 'stripe',
    } = request.body;

    // Stripe is for non-NGN currencies
    if (currency === 'NGN') {
      return response.status(400).json({
        message: 'Please use Paystack for NGN payments',
        error: true,
        success: false,
      });
    }

    const user = await UserModel.findById(userId);

    // Validate shipping method
    let shippingMethod = null;
    if (shippingMethodId) {
      shippingMethod = await ShippingMethodModel.findById(shippingMethodId);
      if (!shippingMethod) {
        return response.status(400).json({
          message: 'Invalid shipping method',
          error: true,
          success: false,
        });
      }
    }

    // Validate products
    for (const item of list_items) {
      const productData = item.productId || item;
      if (!productData.productAvailability) {
        return response.status(400).json({
          message: `Product ${productData.name} is not available for production`,
          error: true,
          success: false,
        });
      }
    }

    // Convert amounts to payment currency
    let paymentAmount = totalAmt;
    if (currency !== 'NGN') {
      paymentAmount = await convertCurrency(totalAmt, 'NGN', currency);
    }

    const line_items = list_items.map((item) => {
      const productData = item.productId || item;
      const priceOption = item.priceOption || 'regular';
      const productPrice = getProductPrice(productData, priceOption);
      let finalPrice = pricewithDiscount(productPrice, productData.discount);

      if (currency !== 'NGN') {
        finalPrice = finalPrice * (paymentAmount / totalAmt);
      }

      return {
        price_data: {
          currency: currency.toLowerCase(),
          product_data: {
            name: `${productData.name} - ${priceOption} delivery`,
            images: productData.image,
            metadata: {
              productId: productData._id,
              priceOption: priceOption,
            },
          },
          unit_amount: Math.round(finalPrice * 100),
        },
        adjustable_quantity: {
          enabled: true,
          minimum: 1,
        },
        quantity: item.quantity,
      };
    });

    // Add shipping as line item
    if (shippingCost > 0) {
      let shippingAmount = shippingCost;
      if (currency !== 'NGN') {
        shippingAmount = shippingAmount * (paymentAmount / totalAmt);
      }

      line_items.push({
        price_data: {
          currency: currency.toLowerCase(),
          product_data: {
            name: `Shipping - ${shippingMethod?.name || 'Standard Shipping'}`,
            metadata: {
              type: 'shipping',
              shippingMethodId: shippingMethodId,
            },
          },
          unit_amount: Math.round(shippingAmount * 100),
        },
        quantity: 1,
      });
    }

    const params = {
      submit_type: 'pay',
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: user.email,
      metadata: {
        userId: userId,
        addressId: addressId,
        shippingMethodId: shippingMethodId || '',
        shippingCost: shippingCost.toString(),
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

// Enhanced Stripe webhook handler (unchanged from original)
export async function webhookStripe(request, response) {
  const event = request.body;

  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      const lineItems = await Stripe.checkout.sessions.listLineItems(
        session.id
      );
      const userId = session.metadata.userId;
      const shippingMethodId = session.metadata.shippingMethodId;
      const shippingCost = parseFloat(session.metadata.shippingCost || '0');

      const orderProduct = await getOrderProductItems({
        lineItems: lineItems,
        userId: userId,
        addressId: session.metadata.addressId,
        paymentId: session.payment_intent,
        payment_status: 'PAID',
        shippingMethodId: shippingMethodId,
        shippingCost: shippingCost,
        originalCurrency: session.metadata.originalCurrency || 'NGN',
        paymentCurrency:
          session.metadata.paymentCurrency || session.currency.toUpperCase(),
      });

      const orders = await OrderModel.insertMany(orderProduct);

      if (orders.length > 0) {
        for (const order of orders) {
          try {
            await createTrackingForOrder(order, userId);

            const user = await UserModel.findById(userId);
            const address = await mongoose
              .model('address')
              .findById(session.metadata.addressId);
            const shippingMethod = shippingMethodId
              ? await ShippingMethodModel.findById(shippingMethodId)
              : null;

            await sendOrderConfirmationEmail({
              user,
              order,
              items: [order],
              shippingAddress: address,
              shippingMethod,
              trackingNumber: order.tracking_number,
            });

            await sendOrderNotificationToTeam({
              user,
              order,
              items: [order],
              orderType: 'Stripe Payment',
            });
          } catch (trackingError) {
            console.error(
              'Failed to create tracking for order:',
              order._id,
              trackingError
            );
          }
        }
      }

      if (userId) {
        await UserModel.findByIdAndUpdate(userId, { shopping_cart: [] });
        await CartProductModel.deleteMany({ userId: userId });
      }
      break;

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  return response.json({ received: true });
}

// Helper function for Stripe order items
const getOrderProductItems = async ({
  lineItems,
  userId,
  addressId,
  paymentId,
  payment_status,
  originalCurrency,
  paymentCurrency,
  shippingMethodId,
  shippingCost,
}) => {
  const productList = [];

  let shippingZone = null;
  let shippingMethod = null;

  if (addressId) {
    const address = await mongoose.model('address').findById(addressId);
    if (address) {
      shippingZone = await ShippingZoneModel.findZoneByCity(
        address.city,
        address.state
      );
    }
  }

  if (shippingMethodId) {
    shippingMethod = await ShippingMethodModel.findById(shippingMethodId);
  }

  if (lineItems?.data?.length) {
    for (const item of lineItems.data) {
      const product = await Stripe.products.retrieve(item.price.product);

      if (product.metadata.type === 'shipping') continue;

      const priceOption = product.metadata.priceOption || 'regular';
      const productId = product.metadata.productId;

      const fullProduct = await mongoose
        .model('product')
        .findById(productId)
        .populate('category');

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
        orderId: `STR-${new mongoose.Types.ObjectId()}`,
        productId: productId,
        product_details: {
          name: product.name,
          image: product.images,
          priceOption: priceOption,
          deliveryTime: priceOption,
        },
        paymentId: paymentId,
        payment_status: payment_status,
        payment_method: 'STRIPE',
        delivery_address: addressId,
        subTotalAmt: amountInBaseCurrency,
        totalAmt:
          amountInBaseCurrency +
          shippingCost /
            lineItems.data.filter((li) => {
              const prod = li.price.product;
              return !prod.metadata || prod.metadata.type !== 'shipping';
            }).length,
        currency: originalCurrency,
        quantity: item.quantity,
        unitPrice: amountInBaseCurrency / item.quantity,
        shippingMethod: shippingMethodId,
        shippingZone: shippingZone?._id,
        shipping_cost:
          shippingCost /
          lineItems.data.filter((li) => {
            const prod = li.price.product;
            return !prod.metadata || prod.metadata.type !== 'shipping';
          }).length,
        shipping_details: shippingMethod
          ? {
              method_name: shippingMethod.name,
              method_type: shippingMethod.type,
              carrier: {
                name: 'I-Coffee Logistics',
                code: 'ICF',
              },
              estimated_delivery_days: {
                min: shippingMethod.estimatedDelivery?.minDays || 1,
                max: shippingMethod.estimatedDelivery?.maxDays || 7,
              },
              weight: fullProduct?.weight || 1,
              dimensions: {
                length: 20,
                width: 15,
                height: 10,
                unit: 'cm',
              },
            }
          : {},
      };

      productList.push(payload);
    }
  }

  return productList;
};

// Other controllers remain unchanged
export async function getOrderDetailsController(request, response) {
  try {
    const userId = request.userId;

    const orderlist = await OrderModel.find({ userId: userId })
      .sort({ createdAt: -1 })
      .populate('delivery_address')
      .populate('shippingMethod', 'name type')
      .populate('shippingZone', 'name');

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

// Get shipping methods for checkout
export const getShippingMethodsController = async (request, response) => {
  try {
    const { addressId, items, orderValue } = request.body;

    const address = await mongoose.model('address').findById(addressId);
    if (!address) {
      return response.status(404).json({
        message: 'Address not found',
        error: true,
        success: false,
      });
    }

    const zone = await ShippingZoneModel.findZoneByCity(
      address.city,
      address.state
    );

    const methods = await ShippingMethodModel.find({ isActive: true }).sort({
      sortOrder: 1,
    });
    const availableMethods = [];

    for (const method of methods) {
      let calculation = { eligible: true, cost: 0, reason: '' };

      switch (method.type) {
        case 'flat_rate':
          calculation = method.calculateShippingCost({
            weight: 1,
            orderValue: orderValue || 0,
            zone: zone?._id,
            items: items,
          });
          break;

        case 'table_shipping':
          if (!zone) {
            calculation = {
              eligible: false,
              reason: 'No shipping zone found for your location',
            };
          } else {
            calculation = method.calculateShippingCost({
              weight: 1,
              orderValue: orderValue || 0,
              zone: zone._id,
              items: items,
            });
          }
          break;

        case 'pickup':
          calculation = {
            eligible: true,
            cost: 0,
            reason: '',
          };
          break;
      }

      if (calculation.eligible) {
        availableMethods.push({
          _id: method._id,
          name: method.name,
          code: method.code,
          type: method.type,
          description: method.description,
          cost: calculation.cost,
          estimatedDelivery: calculation.estimatedDelivery,
        });
      }
    }

    return response.json({
      message: 'Shipping methods retrieved successfully',
      data: {
        methods: availableMethods,
      },
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
};

// Get orders ready for shipping
export const getOrdersForShippingController = async (request, response) => {
  try {
    const { page = 1, limit = 10, status = 'CONFIRMED' } = request.query;

    const query = {
      payment_status: 'PAID',
      order_status: status,
    };

    const skip = (page - 1) * limit;

    const [orders, totalCount] = await Promise.all([
      OrderModel.find(query)
        .populate('delivery_address')
        .populate('userId', 'name email mobile')
        .populate('productId', 'name image')
        .populate('shippingMethod', 'name type')
        .populate('shippingZone', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      OrderModel.countDocuments(query),
    ]);

    return response.json({
      message: 'Orders ready for shipping retrieved successfully',
      data: orders,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: parseInt(page),
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
};

// Update order tracking
export const updateOrderTrackingController = async (request, response) => {
  try {
    const { orderId } = request.params;
    const { tracking_number, order_status, estimated_delivery } = request.body;

    const order = await OrderModel.findById(orderId);
    if (!order) {
      return response.status(404).json({
        message: 'Order not found',
        error: true,
        success: false,
      });
    }

    const updateData = {};
    if (tracking_number) updateData.tracking_number = tracking_number;
    if (order_status) updateData.order_status = order_status;
    if (estimated_delivery) updateData.estimated_delivery = estimated_delivery;

    const updatedOrder = await OrderModel.findByIdAndUpdate(
      orderId,
      updateData,
      { new: true }
    ).populate('delivery_address userId');

    return response.json({
      message: 'Order tracking updated successfully',
      data: updatedOrder,
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
};

// Get shipping analytics
export const getShippingAnalyticsController = async (request, response) => {
  try {
    const { startDate, endDate } = request.query;

    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = {
        createdAt: {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        },
      };
    }

    const [
      totalOrders,
      shippedOrders,
      deliveredOrders,
      pendingOrders,
      avgDeliveryTime,
      topShippingMethods,
    ] = await Promise.all([
      OrderModel.countDocuments(dateFilter),
      OrderModel.countDocuments({ ...dateFilter, order_status: 'SHIPPED' }),
      OrderModel.countDocuments({ ...dateFilter, order_status: 'DELIVERED' }),
      OrderModel.countDocuments({ ...dateFilter, order_status: 'PENDING' }),
      OrderModel.aggregate([
        { $match: { ...dateFilter, order_status: 'DELIVERED' } },
        {
          $group: {
            _id: null,
            avgDays: {
              $avg: {
                $divide: [
                  { $subtract: ['$actual_delivery', '$createdAt'] },
                  1000 * 60 * 60 * 24,
                ],
              },
            },
          },
        },
      ]),
      OrderModel.aggregate([
        { $match: dateFilter },
        { $group: { _id: '$shippingMethod', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]),
    ]);

    return response.json({
      message: 'Shipping analytics retrieved successfully',
      data: {
        totalOrders,
        shippedOrders,
        deliveredOrders,
        pendingOrders,
        avgDeliveryTime: avgDeliveryTime[0]?.avgDays || 0,
        topShippingMethods,
      },
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
};

export const updateTracking = async (request, response) => {
  try {
    const userId = request.user._id;
    const { trackingId } = request.params;
    const { status, description, location, estimatedDelivery } = request.body;

    const tracking = await ShippingTrackingModel.findById(trackingId)
      .populate('orderId')
      .populate('orderId.userId', 'name email');

    if (!tracking) {
      return response.status(404).json({
        message: 'Tracking not found',
        error: true,
        success: false,
      });
    }

    if (estimatedDelivery) {
      await tracking.updateEstimatedDelivery(
        new Date(estimatedDelivery),
        userId
      );
    }

    if (status && description) {
      await tracking.addTrackingEvent(
        {
          status,
          description,
          location,
        },
        userId
      );

      let orderStatus = tracking.orderId.order_status;
      switch (status) {
        case 'PROCESSING':
          orderStatus = 'PROCESSING';
          break;
        case 'PICKED_UP':
        case 'IN_TRANSIT':
          orderStatus = 'SHIPPED';
          break;
        case 'DELIVERED':
          orderStatus = 'DELIVERED';
          break;
        case 'RETURNED':
        case 'LOST':
          orderStatus = 'CANCELLED';
          break;
      }

      await OrderModel.findByIdAndUpdate(tracking.orderId, {
        order_status: orderStatus,
        ...(status === 'DELIVERED' && { actual_delivery: new Date() }),
      });

      const importantStatuses = [
        'PICKED_UP',
        'IN_TRANSIT',
        'OUT_FOR_DELIVERY',
        'DELIVERED',
        'ATTEMPTED',
      ];
      if (importantStatuses.includes(status)) {
        try {
          await sendShippingNotificationEmail({
            user: tracking.orderId.userId,
            order: tracking.orderId,
            tracking: tracking,
            latestEvent:
              tracking.trackingEvents[tracking.trackingEvents.length - 1],
          });
        } catch (emailError) {
          console.error(
            'Failed to send shipping notification email:',
            emailError
          );
        }
      }
    }

    const updatedTracking = await ShippingTrackingModel.findById(trackingId)
      .populate('orderId')
      .populate('shippingMethod')
      .populate('trackingEvents.updatedBy', 'name');

    return response.json({
      message: 'Tracking updated successfully',
      data: updatedTracking,
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
};
