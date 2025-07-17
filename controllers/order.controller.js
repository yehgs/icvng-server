// controllers/order.controller.js - Updated with shipping integration
import OrderModel from '../models/order.model.js';
import CartProductModel from '../models/cartproduct.model.js';
import UserModel from '../models/user.model.js';
import ExchangeRateModel from '../models/exchange-rate.model.js';
import ShippingZoneModel from '../models/shipping-zone.model.js';
import ShippingMethodModel from '../models/shipping-method.model.js';
import ShippingTrackingModel from '../models/shipping-tracking.model.js';
import mongoose from 'mongoose';
import Stripe from '../config/stripe.js';
import {
  sendOrderConfirmationEmail,
  sendShippingNotificationEmail,
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
    return amount; // Return original if no rate found
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

    // Bank transfer only available for NGN
    if (currency !== 'NGN') {
      return response.status(400).json({
        message: 'Direct Bank Transfer is only available for NGN currency',
        error: true,
        success: false,
      });
    }

    // Validate shipping method if provided
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

    // Only validate productAvailability
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

    // Get shipping zone for the address
    let shippingZone = null;
    if (addressId) {
      const address = await mongoose.model('address').findById(addressId);
      if (address) {
        shippingZone = await ShippingZoneModel.findZoneByCity(
          address.city,
          address.state
        );
      }
    }

    // Create order items with shipping information
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
        // Add shipping information
        shippingMethod: shippingMethodId,
        shippingZone: shippingZone?._id,
        shipping_cost: shippingCost / list_items.length, // Distribute shipping cost
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
        // Store bank transfer details
        bank_transfer_details: bankDetails,
        admin_notes: `Bank Transfer - Reference: ${bankDetails.reference}`,
      };
    });

    // Save orders
    const orders = await OrderModel.insertMany(orderItems);

    // Send order confirmation email
    try {
      const user = await UserModel.findById(userId);
      const address = await mongoose.model('address').findById(addressId);

      await sendOrderConfirmationEmail({
        user,
        order: orders[0],
        items: orderItems,
        shippingAddress: address,
        shippingMethod,
        trackingNumber: null,
      });
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
    }

    // Clear cart
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

// Updated Stripe/Flutterwave payment handlers to include shipping
export async function paymentController(request, response) {
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
      paymentMethod = 'stripe',
    } = request.body;

    const user = await UserModel.findById(userId);

    // Validate shipping method if provided
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

    // Only validate productAvailability
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

    // Convert amounts to payment currency if needed
    let paymentAmount = totalAmt;
    if (currency !== 'NGN') {
      paymentAmount = await convertCurrency(totalAmt, 'NGN', currency);
    }

    const line_items = list_items.map((item) => {
      const productData = item.productId || item;
      const priceOption = item.priceOption || 'regular';
      const productPrice = getProductPrice(productData, priceOption);
      let finalPrice = pricewithDiscount(productPrice, productData.discount);

      // Convert price to payment currency
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

    // Add shipping as a line item if there's a cost
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

// Enhanced Stripe webhook handler
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

      // Auto-create shipments for paid orders
      if (orders.length > 0) {
        for (const order of orders) {
          try {
            await order.createShipment({
              createdBy: userId,
              updatedBy: userId,
              weight: 1,
              priority: 'NORMAL',
            });

            // Send confirmation email
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
          } catch (trackingError) {
            console.error(
              'Failed to create tracking for order:',
              order._id,
              trackingError
            );
          }
        }
      }

      // Clear cart
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

  // Get shipping zone for the address
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

      // Skip shipping line items
      if (product.metadata.type === 'shipping') continue;

      const priceOption = product.metadata.priceOption || 'regular';
      const productId = product.metadata.productId;

      // Get full product details for shipping calculation
      const fullProduct = await ProductModel.findById(productId).populate(
        'category'
      );

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

        // Enhanced shipping information
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
                length: 20, // Default dimensions in cm
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

// Enhanced Flutterwave order creation with proper shipping handling
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

      // Get cart items for this user with product details
      const cartItems = await CartProductModel.find({
        userId: meta.userId,
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

      // Enhanced product availability check
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

      // Get shipping zone and method information
      let shippingZone = null;
      let shippingMethod = null;

      if (meta.addressId) {
        const address = await mongoose
          .model('address')
          .findById(meta.addressId);
        if (address) {
          shippingZone = await ShippingZoneModel.findZoneByCity(
            address.city,
            address.state
          );
        }
      }

      if (meta.shippingMethodId) {
        shippingMethod = await ShippingMethodModel.findById(
          meta.shippingMethodId
        );
      }

      const shippingCostPerItem =
        parseFloat(meta.shippingCost || '0') / cartItems.length;

      // Create order items with enhanced shipping details
      const orderItems = cartItems.map((item) => {
        const priceOption = item.priceOption || 'regular';
        const productPrice = getProductPrice(item.productId, priceOption);
        const finalPrice = pricewithDiscount(
          productPrice,
          item.productId.discount
        );

        return {
          userId: meta.userId,
          orderId: `FLW-${new mongoose.Types.ObjectId()}`,
          productId: item.productId._id,
          product_details: {
            name: item.productId.name,
            image: item.productId.image,
            priceOption: priceOption,
            deliveryTime: priceOption,
          },
          paymentId: tx_ref,
          payment_status: 'PAID',
          payment_method: 'FLUTTERWAVE',
          delivery_address: meta.addressId,
          subTotalAmt: finalPrice * item.quantity,
          totalAmt: finalPrice * item.quantity + shippingCostPerItem,
          currency: currency,
          quantity: item.quantity,
          unitPrice: finalPrice,

          // Enhanced shipping information
          shippingMethod: meta.shippingMethodId,
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

      // Auto-create shipments for paid orders
      for (const order of orders) {
        try {
          await order.createShipment({
            createdBy: meta.userId,
            updatedBy: meta.userId,
            weight: order.shipping_details?.weight || 1,
            priority: 'NORMAL',
            carrier: {
              name: 'I-Coffee Logistics',
              code: 'ICF',
              phone: '+234-800-ICOFFEE',
              website: 'https://i-coffee.ng',
            },
          });
        } catch (trackingError) {
          console.error(
            'Failed to create tracking for order:',
            order._id,
            trackingError
          );
        }
      }

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

// Flutterwave payment controller
export async function flutterwavePaymentController(request, response) {
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

    const user = await UserModel.findById(userId);

    // Only validate productAvailability
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
        shippingMethodId: shippingMethodId,
        shippingCost: shippingCost,
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

// Get shipping methods for checkout
export const getShippingMethodsController = async (request, response) => {
  try {
    const { addressId, items, orderValue } = request.body;

    // Get address details
    const address = await mongoose.model('address').findById(addressId);
    if (!address) {
      return response.status(404).json({
        message: 'Address not found',
        error: true,
        success: false,
      });
    }

    // Find shipping zone
    const zone = await ShippingZoneModel.findZoneByCity(
      address.city,
      address.state
    );

    // Get active shipping methods
    const methods = await ShippingMethodModel.find({ isActive: true }).sort({
      sortOrder: 1,
    });
    const availableMethods = [];

    for (const method of methods) {
      let calculation = { eligible: true, cost: 0, reason: '' };

      switch (method.type) {
        case 'flat_rate':
          calculation = method.calculateShippingCost({
            weight: 1, // Default weight
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
              weight: 1, // Default weight
              orderValue: orderValue || 0,
              zone: zone._id,
              items: items,
            });
          }
          break;

        case 'pickup':
          // Pickup is always available and free
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
      tracking_number: { $exists: false },
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

    // Update estimated delivery if provided
    if (estimatedDelivery) {
      await tracking.updateEstimatedDelivery(
        new Date(estimatedDelivery),
        userId
      );
    }

    // Add tracking event if status and description provided
    if (status && description) {
      await tracking.addTrackingEvent(
        {
          status,
          description,
          location,
        },
        userId
      );

      // Update order status based on tracking status
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

      // Send email notification for important status changes
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
