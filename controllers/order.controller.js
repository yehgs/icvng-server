// controllers/order.controller.js - WITH ORDER GROUPING SYSTEM
import OrderModel from "../models/order.model.js";
import CartProductModel from "../models/cartproduct.model.js";
import UserModel from "../models/user.model.js";
import ShippingZoneModel from "../models/shipping-zone.model.js";
import ShippingMethodModel from "../models/shipping-method.model.js";
import mongoose from "mongoose";
import Stripe from "../config/stripe.js";
import { STRIPE_WEBHOOK_SECRET } from "../config/stripe.js";
import crypto from "crypto";

// Helper functions
const getProductPrice = (product, priceOption = "regular") => {
  switch (priceOption) {
    case "3weeks":
      return product.price3weeksDelivery || product.btcPrice || product.price;
    case "5weeks":
      return product.price5weeksDelivery || product.btcPrice || product.price;
    default:
      return product.btcPrice || product.price;
  }
};

const pricewithDiscount = (price, dis = 0) => {
  const discountAmount = Math.ceil((Number(price) * Number(dis)) / 100);
  return Number(price) - discountAmount;
};

// ===== Shared: create a logged-in user's order(s) from a confirmed Paystack charge =====
// Used by BOTH the server-to-server webhook (paystackWebhookController) and the
// browser-redirect verification endpoint (verifyPaystackController) — the app
// relies on the latter for order creation (the customer is always logged in
// before checkout; there's no anonymous/guest path in this flow), so this
// logic must not live only inside the webhook handler.
//
// Idempotent: if an order already exists for this reference (e.g. the
// webhook already created it before the browser redirect arrived, or vice
// versa), returns the existing order group instead of creating a duplicate.
async function createOrderFromPaystackTransaction({
  reference,
  metadata,
  countryCode,
  currencyCode,
}) {
  // Idempotency — whichever of (webhook, verify-on-redirect) runs first wins;
  // the other just returns what's already there.
  const existing = await OrderModel.findOne({ paymentId: reference });
  if (existing) {
    const groupOrders = await OrderModel.find({
      orderGroupId: existing.orderGroupId,
    });
    return { orders: groupOrders, orderGroupId: existing.orderGroupId, alreadyExisted: true };
  }

  const userId = metadata.userId;

  const user = await UserModel.findById(userId);
  if (!user) {
    throw new Error("User not found");
  }

  // Prefer the cart SNAPSHOT taken at checkout initiation (immune to the
  // live cart changing/clearing between initiation and confirmation — see
  // paystackPaymentController). Falls back to querying the live cart for
  // transactions initiated before this snapshot existed in metadata.
  let cartItems;
  if (metadata.cartItemsJSON) {
    let snapshot = [];
    try {
      snapshot = JSON.parse(metadata.cartItemsJSON);
    } catch (_err) {
      snapshot = [];
    }
    const productIds = snapshot.map((i) => i.productId).filter(Boolean);
    const products = await ProductModel.find({
      _id: { $in: productIds },
    }).populate("category");
    const productMap = new Map(products.map((p) => [p._id.toString(), p]));
    cartItems = snapshot
      .map((i) => ({
        productId: productMap.get(i.productId),
        quantity: i.quantity,
        priceOption: i.priceOption || "regular",
      }))
      .filter((i) => i.productId); // drop any product deleted since checkout
  } else {
    cartItems = await CartProductModel.find({ userId }).populate({
      path: "productId",
      populate: { path: "category" },
    });
  }

  if (cartItems.length === 0) {
    throw new Error("No cart items found");
  }

  // Validate products
  for (const item of cartItems) {
    if (!item.productId?.productAvailability) {
      throw new Error(`Product ${item.productId?.name} is not available`);
    }
  }

  // Get shipping info
  let shippingZone = null;
  let shippingMethod = null;

  if (metadata.addressId) {
    const address = await mongoose.model("address").findById(metadata.addressId);
    if (address) {
      shippingZone = await ShippingZoneModel.findZoneByCity(
        address.city,
        address.state,
      );
    }
  }

  if (metadata.shippingMethodId) {
    shippingMethod = await ShippingMethodModel.findById(
      metadata.shippingMethodId,
    );
  }

  // ✅ CREATE ORDER GROUP ID - Unique for this checkout session
  const orderGroupId = `GRP-${Date.now()}-${userId}`;
  const shippingCostPerItem =
    parseFloat(metadata.shippingCost || "0") / cartItems.length;

  // Calculate group totals
  const groupTotals = {
    subTotal: 0,
    totalShipping: parseFloat(metadata.shippingCost || "0"),
    totalDiscount: 0,
    totalTax: 0,
    grandTotal: 0,
    itemCount: cartItems.length,
  };

  // Exchange rate info
  const exchangeRateInfo = {
    rate: 1,
    fromCurrency: "NGN",
    toCurrency: "NGN",
    rateSource: "manual",
    appliedAt: new Date(),
  };

  // ✅ Create orders - ONE ORDER PER PRODUCT, but GROUPED
  const orderItems = cartItems.map((item, index) => {
    const priceOption = item.priceOption || "regular";
    const productPrice = getProductPrice(item.productId, priceOption);
    const finalPrice = pricewithDiscount(
      productPrice,
      item.productId.discount,
    );
    const itemSubtotal = finalPrice * item.quantity;
    const itemTotal = itemSubtotal + shippingCostPerItem;

    // Add to group totals
    groupTotals.subTotal += itemSubtotal;
    groupTotals.grandTotal += itemTotal;

    // First order is parent
    const isParent = index === 0;
    const firstOrderId = `PSK-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    return {
      // Individual order ID
      orderId: isParent
        ? firstOrderId
        : `PSK-${Date.now()}-${index}-${Math.random()
            .toString(36)
            .substr(2, 9)}`,

      // ✅ ORDER GROUPING
      orderGroupId, // Same for all orders from this checkout
      isParentOrder: isParent, // First order is parent
      parentOrderId: isParent ? null : firstOrderId, // Reference to parent
      orderSequence: index + 1, // 1, 2, 3, 4...
      totalItemsInGroup: cartItems.length, // Same for all

      // Website order defaults
      userId,
      customerId: null,
      orderType: "BTC",
      orderMode: "ONLINE",
      isWebsiteOrder: true,
      createdBy: null,

      // Product - ONE PRODUCT PER ORDER
      productId: item.productId._id,
      product_details: {
        name: item.productId.name,
        image: item.productId.image,
        priceOption,
        deliveryTime: priceOption,
      },
      quantity: item.quantity,
      unitPrice: finalPrice,

      // Individual pricing
      subTotalAmt: itemSubtotal,
      totalAmt: itemTotal,
      shipping_cost: shippingCostPerItem,
      currency: currencyCode || "NGN",
      countryCode: countryCode || "NG",
      exchangeRateUsed: exchangeRateInfo,
      amountsInNGN: {
        subtotal: itemSubtotal,
        shipping: shippingCostPerItem,
        total: itemTotal,
      },

      // ✅ Group totals (stored in all orders, but mainly used by parent)
      groupTotals: isParent ? groupTotals : {},

      // Payment (SHARED across all orders in group)
      paymentId: reference,
      payment_status: "PAID",
      payment_method: "PAYSTACK",

      // Delivery (SHARED)
      delivery_address: metadata.addressId,
      shippingMethod: metadata.shippingMethodId,
      shippingZone: shippingZone?._id,
      shipping_details: shippingMethod
        ? {
            method_name: shippingMethod.name,
            method_type: shippingMethod.type,
            carrier: { name: "I-Coffee Logistics", code: "ICF" },
            estimated_delivery_days: {
              min: shippingMethod.estimatedDelivery?.minDays || 1,
              max: shippingMethod.estimatedDelivery?.maxDays || 7,
            },
          }
        : {},
    };
  });

  // Update group totals in first order (parent)
  orderItems[0].groupTotals = groupTotals;

  const orders = await OrderModel.insertMany(orderItems);

  // Clear cart
  await CartProductModel.deleteMany({ userId });
  await UserModel.updateOne({ _id: userId }, { shopping_cart: [] });

  console.log(
    `✅ Paystack: Created order group ${orderGroupId} with ${orders.length} orders`,
  );

  return { orders, orderGroupId, alreadyExisted: false };
}

// ===== PAYSTACK WEBHOOK =====
export async function paystackWebhookController(request, response) {
  try {
    const hash = crypto
      .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(request.body))
      .digest("hex");

    if (hash !== request.headers["x-paystack-signature"]) {
      return response.status(401).json({
        message: "Unauthorized webhook",
        error: true,
      });
    }

    const { event, data } = request.body;

    if (event === "charge.success") {
      const { reference, metadata } = data;

      // ── Guest order path ──
      if (metadata?.isGuest === true) {
        const { processGuestPaystackWebhook } =
          await import("./guest_order.controller.js");
        await processGuestPaystackWebhook(metadata, reference);
        return response.json({ received: true });
      }

      try {
        await createOrderFromPaystackTransaction({
          reference,
          metadata,
          countryCode: request.countryCode || "NG",
          currencyCode: request.country?.currency?.code || "NGN",
        });
      } catch (err) {
        // Validation failures (no cart, user missing, product unavailable)
        // are logged but still ack the webhook with 200 — Paystack retries
        // on non-2xx, and retrying won't fix a genuinely empty cart. The
        // verify-on-redirect path (verifyPaystackController) is the primary
        // order-creation mechanism for this app; this webhook is a backup.
        console.error("Paystack webhook order creation failed:", err.message);
      }
    }

    return response.json({ received: true });
  } catch (error) {
    console.error("Paystack webhook error:", error);
    return response.status(500).json({
      message: error.message,
      error: true,
    });
  }
}

// ===== PAYSTACK VERIFY (called by the browser after Paystack redirects back) =====
// This is the PRIMARY order-creation path for this app: checkout always
// requires the customer to be logged in first (no true guest checkout), so
// there is no separate "guest webhook" flow to fall back on here — the
// frontend's PaystackCallbackPage hits this endpoint with the transaction
// reference from the URL as soon as Paystack redirects the browser back.
// Previously this route didn't exist at all, so paid orders were never
// created through this path (the webhook was the only other mechanism, and
// depends on Paystack's dashboard webhook URL being configured/reachable).
export async function verifyPaystackController(request, response) {
  try {
    const { reference } = request.params;
    if (!reference) {
      return response.status(400).json({
        message: "Transaction reference is required",
        error: true,
        success: false,
      });
    }

    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      },
    );
    const verifyData = await verifyRes.json();

    if (!verifyData.status || verifyData.data?.status !== "success") {
      return response.status(400).json({
        message: verifyData.data?.gateway_response || "Payment was not successful",
        error: true,
        success: false,
      });
    }

    const { metadata, amount, currency } = verifyData.data;

    let orderGroupId;
    if (metadata?.isGuest === true) {
      const { processGuestPaystackWebhook } =
        await import("./guest_order.controller.js");
      await processGuestPaystackWebhook(metadata, reference);
      const guestOrder = await OrderModel.findOne({ paymentId: reference });
      orderGroupId = guestOrder?.orderGroupId;
    } else {
      const result = await createOrderFromPaystackTransaction({
        reference,
        metadata,
        countryCode: request.countryCode || "NG",
        currencyCode: request.country?.currency?.code || "NGN",
      });
      orderGroupId = result.orderGroupId;
    }

    return response.json({
      message: "Payment verified and order placed",
      success: true,
      error: false,
      data: {
        reference,
        amount: amount / 100,
        currency,
        orderGroupId,
      },
    });
  } catch (error) {
    console.error("Paystack verify error:", error);
    return response.status(500).json({
      message: error.message,
      error: true,
      success: false,
    });
  }
}

// ===== PAYSTACK PAYMENT INITIATION =====
export async function paystackPaymentController(request, response) {
  try {
    const userId = request.userId;
    const {
      totalAmt,
      addressId,
      shippingCost = 0,
      shippingMethodId,
      currency = "NGN",
    } = request.body;

    if (currency !== "NGN") {
      return response.status(400).json({
        message: "Paystack is only available for NGN currency",
        error: true,
      });
    }

    const user = await UserModel.findById(userId);
    const cartItems = await CartProductModel.find({ userId }).populate(
      "productId",
    );

    if (cartItems.length === 0) {
      return response.status(400).json({
        message: "No items in cart",
        error: true,
      });
    }

    const txRef = `PSK-${Date.now()}-${userId}`;
    const amountInKobo = Math.round(totalAmt * 100);

    const paymentData = {
      email: user.email,
      amount: amountInKobo,
      reference: txRef,
      currency: "NGN",
      callback_url: `${process.env.FRONTEND_URL}/payment/paystack/callback`,
      metadata: {
        userId: userId.toString(),
        addressId,
        shippingMethodId: shippingMethodId || "",
        shippingCost,
        itemCount: cartItems.length,
        // Snapshot the cart NOW, at checkout initiation, instead of relying
        // on re-querying the live cart at confirmation time (webhook or the
        // browser-redirect verify endpoint) — that gap can be minutes long
        // (Paystack's own hosted page, network delays, etc.), and if the
        // cart changes or gets cleared in between, the order used to be
        // lost with zero record of it anywhere. Same pattern the guest
        // checkout flow already uses successfully.
        cartItemsJSON: JSON.stringify(
          cartItems.map((item) => ({
            productId: item.productId?._id?.toString() || item.productId,
            quantity: item.quantity,
            priceOption: item.priceOption || "regular",
          })),
        ),
      },
    };

    const paystackResponse = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(paymentData),
      },
    );

    const paystackData = await paystackResponse.json();

    if (paystackData.status === true) {
      return response.json({
        success: true,
        paymentUrl: paystackData.data.authorization_url,
        reference: paystackData.data.reference,
      });
    } else {
      throw new Error(paystackData.message || "Failed to create payment link");
    }
  } catch (error) {
    console.error("Paystack payment error:", error);
    return response.status(500).json({
      message: error.message,
      error: true,
    });
  }
}

// ===== STRIPE WEBHOOK =====
export async function webhookStripe(request, response) {
  const sig = request.headers["stripe-signature"];

  let event;

  try {
    // ✅ Verify webhook signature
    event = Stripe.webhooks.constructEvent(
      request.body,
      sig,
      STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    console.error("⚠️ Webhook signature verification failed:", err.message);
    return response.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Process the event
  switch (event.type) {
    case "checkout.session.completed":
      const session = event.data.object;

      try {
        // ── Guest Stripe order path ──
        if (session.metadata?.isGuest === "true") {
          const { processGuestStripeWebhook } =
            await import("./guest_order.controller.js");
          await processGuestStripeWebhook(session);
          break;
        }

        // ── Logged-in user Stripe order path ──
        const lineItems = await Stripe.checkout.sessions.listLineItems(
          session.id,
        );
        const userId = session.metadata.userId;

        const orderProduct = await getOrderProductItemsFromStripe({
          lineItems,
          userId,
          addressId: session.metadata.addressId,
          paymentId: session.payment_intent,
          payment_status: "PAID",
          shippingMethodId: session.metadata.shippingMethodId,
          shippingCost: parseFloat(session.metadata.originalShippingNGN || "0"),
          session,
        });

        const orders = await OrderModel.insertMany(orderProduct);

        if (userId) {
          await UserModel.findByIdAndUpdate(userId, { shopping_cart: [] });
          await CartProductModel.deleteMany({ userId });
        }

        console.log(
          `✅ Stripe: Created order group with ${orders.length} orders`,
        );
      } catch (error) {
        console.error("Error processing checkout.session.completed:", error);
        // Still return 200 to Stripe to acknowledge receipt
      }
      break;

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  // Return a 200 response to acknowledge receipt of the event
  return response.json({ received: true });
}

// ===== STRIPE PAYMENT =====
export async function stripePaymentController(request, response) {
  try {
    const userId = request.userId;
    const {
      list_items,
      totalAmt,
      addressId,
      subTotalAmt,
      shippingCost = 0,
      originalAmounts,
      exchangeRateInfo,
      shippingMethodId,
      currency = "USD",
      paymentMethod = "stripe",
    } = request.body;

    if (currency === "NGN") {
      return response.status(400).json({
        message: "Please use Paystack for NGN payments",
        error: true,
        success: false,
      });
    }

    const user = await UserModel.findById(userId);
    const cartItems = await CartProductModel.find({ userId }).populate(
      "productId",
    );

    if (cartItems.length === 0) {
      return response.status(400).json({
        message: "No items in cart",
        error: true,
        success: false,
      });
    }

    // Validate products
    for (const item of cartItems) {
      if (!item.productId?.productAvailability) {
        return response.status(400).json({
          message: `Product "${item.productId?.name}" is not available`,
          error: true,
          success: false,
        });
      }
    }

    let shippingMethod = null;
    if (shippingMethodId) {
      shippingMethod = await ShippingMethodModel.findById(shippingMethodId);
    }

    const line_items = [];

    for (const item of cartItems) {
      const priceOption = item.priceOption || "regular";
      const productPrice = getProductPrice(item.productId, priceOption);
      const finalPriceNGN = pricewithDiscount(
        productPrice,
        item.productId.discount,
      );

      const itemProportion =
        (finalPriceNGN * item.quantity) / originalAmounts.subTotalAmt;
      const itemPriceConverted = (subTotalAmt * itemProportion) / item.quantity;

      line_items.push({
        price_data: {
          currency: currency.toLowerCase(),
          product_data: {
            name: `${item.productId.name} - ${priceOption} delivery`,
            images: item.productId.image,
            metadata: {
              productId: item.productId._id.toString(),
              priceOption: priceOption,
            },
          },
          unit_amount: Math.round(itemPriceConverted * 100),
        },
        adjustable_quantity: {
          enabled: true,
          minimum: 1,
        },
        quantity: item.quantity,
      });
    }

    if (shippingCost > 0) {
      line_items.push({
        price_data: {
          currency: currency.toLowerCase(),
          product_data: {
            name: `Shipping - ${shippingMethod?.name || "Standard"}`,
            metadata: {
              type: "shipping",
              shippingMethodId: shippingMethodId,
            },
          },
          unit_amount: Math.round(shippingCost * 100),
        },
        quantity: 1,
      });
    }

    const params = {
      submit_type: "pay",
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: user.email,
      metadata: {
        userId: userId.toString(),
        addressId: addressId,
        shippingMethodId: shippingMethodId || "",
        exchangeRate: exchangeRateInfo.rate.toString(),
        fromCurrency: exchangeRateInfo.fromCurrency,
        toCurrency: exchangeRateInfo.toCurrency,
        rateSource: exchangeRateInfo.rateSource,
        originalSubtotalNGN: originalAmounts.subTotalAmt.toString(),
        originalShippingNGN: originalAmounts.shippingCost.toString(),
        originalTotalNGN: originalAmounts.totalAmt.toString(),
        itemCount: cartItems.length.toString(),
        // Item #7: the Stripe webhook that later creates the Order docs
        // has no Host header from the customer's browser to detect country
        // from (Stripe calls our server directly) — it can only read this
        // back from session.metadata. Without it, every Stripe order
        // silently defaulted to "NG" regardless of which domain (e.g.
        // i-coffee.it) the purchase actually came from.
        countryCode: request.countryCode || "NG",
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
    console.error("Stripe payment error:", error);
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
}

// Helper for Stripe orders - WITH GROUPING
async function getOrderProductItemsFromStripe({
  lineItems,
  userId,
  addressId,
  paymentId,
  payment_status,
  shippingMethodId,
  shippingCost,
  session,
}) {
  const productList = [];

  let shippingZone = null;
  let shippingMethod = null;

  if (addressId) {
    const address = await mongoose.model("address").findById(addressId);
    if (address) {
      shippingZone = await ShippingZoneModel.findZoneByCity(
        address.city,
        address.state,
      );
    }
  }

  if (shippingMethodId) {
    shippingMethod = await ShippingMethodModel.findById(shippingMethodId);
  }

  // ✅ CREATE ORDER GROUP ID
  const orderGroupId = `GRP-${Date.now()}-${userId}`;

  const exchangeRateInfo = {
    rate: parseFloat(session.metadata.exchangeRate) || 1,
    fromCurrency: session.metadata.fromCurrency || "NGN",
    toCurrency: session.currency.toUpperCase(),
    rateSource: session.metadata.rateSource || "manual",
    appliedAt: new Date(),
  };

  const originalAmountsNGN = {
    subtotal: parseFloat(session.metadata.originalSubtotalNGN) || 0,
    shipping: parseFloat(session.metadata.originalShippingNGN) || 0,
    total: parseFloat(session.metadata.originalTotalNGN) || 0,
  };

  const productItems = lineItems.data.filter(
    (item) => item.price?.product?.metadata?.type !== "shipping",
  );

  const shippingCostPerItem = shippingCost / productItems.length;

  // Calculate group totals
  const groupTotals = {
    subTotal: 0,
    totalShipping: shippingCost,
    totalDiscount: 0,
    totalTax: 0,
    grandTotal: 0,
    itemCount: productItems.length,
  };

  let firstOrderId = null;
  let orderIndex = 0;

  for (const item of lineItems.data) {
    const product = await Stripe.products.retrieve(item.price.product);
    if (product.metadata.type === "shipping") continue;

    const priceOption = product.metadata.priceOption || "regular";
    const productId = product.metadata.productId;

    const fullProduct = await mongoose
      .model("Product")
      .findById(productId)
      .populate("category");

    const amountInTargetCurrency = item.amount_total / 100;
    const isParent = orderIndex === 0;

    if (isParent) {
      firstOrderId = `STR-${new mongoose.Types.ObjectId()}`;
    }

    groupTotals.subTotal += amountInTargetCurrency;
    groupTotals.grandTotal += amountInTargetCurrency + shippingCostPerItem;

    productList.push({
      orderId: isParent ? firstOrderId : `STR-${new mongoose.Types.ObjectId()}`,

      // ✅ ORDER GROUPING
      orderGroupId,
      isParentOrder: isParent,
      parentOrderId: isParent ? null : firstOrderId,
      orderSequence: orderIndex + 1,
      totalItemsInGroup: productItems.length,

      // Website order defaults
      userId,
      customerId: null,
      orderType: "BTC",
      orderMode: "ONLINE",
      isWebsiteOrder: true,
      createdBy: null,

      // Product
      productId,
      product_details: {
        name: product.name,
        image: product.images,
        priceOption,
        deliveryTime: priceOption,
      },
      quantity: item.quantity,
      unitPrice: amountInTargetCurrency / item.quantity,

      // Pricing
      subTotalAmt: amountInTargetCurrency,
      totalAmt: amountInTargetCurrency + shippingCostPerItem,
      shipping_cost: shippingCostPerItem,
      currency: session.currency.toUpperCase(),
      // Item #7: read back the country the customer actually purchased
      // from (stamped into session.metadata by stripePaymentController) —
      // insertMany() doesn't run countryScopedPlugin's pre-save stamping,
      // so without this every Stripe order would silently default to "NG".
      countryCode: session.metadata?.countryCode || "NG",
      exchangeRateUsed: exchangeRateInfo,
      amountsInNGN: {
        subtotal: originalAmountsNGN.subtotal / productItems.length,
        shipping: originalAmountsNGN.shipping / productItems.length,
        total: originalAmountsNGN.total / productItems.length,
      },

      // Group totals (for parent)
      groupTotals: isParent ? groupTotals : {},

      // Payment (SHARED)
      paymentId,
      payment_status,
      payment_method: "STRIPE",

      // Delivery (SHARED)
      delivery_address: addressId,
      shippingMethod: shippingMethodId,
      shippingZone: shippingZone?._id,
      shipping_details: shippingMethod
        ? {
            method_name: shippingMethod.name,
            method_type: shippingMethod.type,
            carrier: { name: "I-Coffee Logistics", code: "ICF" },
            estimated_delivery_days: {
              min: shippingMethod.estimatedDelivery?.minDays || 1,
              max: shippingMethod.estimatedDelivery?.maxDays || 7,
            },
          }
        : {},
    });

    orderIndex++;
  }

  // Update group totals in first order
  if (productList.length > 0) {
    productList[0].groupTotals = groupTotals;
  }

  return productList;
}

// ===== DIRECT BANK TRANSFER - WITH GROUPING =====
export async function DirectBankTransferOrderController(request, response) {
  try {
    const userId = request.userId;
    const {
      totalAmt,
      addressId,
      shippingCost = 0,
      shippingMethodId,
      currency = "NGN",
      bankDetails,
    } = request.body;

    if (currency !== "NGN") {
      return response.status(400).json({
        message: "Direct Bank Transfer is only available for NGN",
        error: true,
      });
    }

    const cartItems = await CartProductModel.find({ userId }).populate(
      "productId",
    );

    if (cartItems.length === 0) {
      return response.status(400).json({
        message: "No items in cart",
        error: true,
      });
    }

    // Validate products
    for (const item of cartItems) {
      if (!item.productId?.productAvailability) {
        return response.status(400).json({
          message: `Product "${item.productId.name}" is not available`,
          error: true,
        });
      }
    }

    let shippingMethod = null;
    if (shippingMethodId) {
      shippingMethod = await ShippingMethodModel.findById(shippingMethodId);
    }

    let shippingZone = null;
    let address = null;
    if (addressId) {
      address = await mongoose.model("address").findById(addressId);
      if (address) {
        shippingZone = await ShippingZoneModel.findZoneByCity(
          address.city,
          address.state,
        );
      }
    }

    // ✅ CREATE ORDER GROUP ID
    const orderGroupId = `GRP-${Date.now()}-${userId}`;
    const shippingCostPerItem = shippingCost / cartItems.length;

    // Calculate group totals
    const groupTotals = {
      subTotal: 0,
      totalShipping: shippingCost,
      totalDiscount: 0,
      totalTax: 0,
      grandTotal: 0,
      itemCount: cartItems.length,
    };

    const firstOrderId = `BANK-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    const orderItems = cartItems.map((item, index) => {
      const priceOption = item.priceOption || "regular";
      const productPrice = getProductPrice(item.productId, priceOption);
      const finalPrice = pricewithDiscount(
        productPrice,
        item.productId.discount,
      );
      const itemSubtotal = finalPrice * item.quantity;
      const itemTotal = itemSubtotal + shippingCostPerItem;

      const isParent = index === 0;

      groupTotals.subTotal += itemSubtotal;
      groupTotals.grandTotal += itemTotal;

      return {
        orderId: isParent
          ? firstOrderId
          : `BANK-${Date.now()}-${index}-${Math.random()
              .toString(36)
              .substr(2, 9)}`,

        // ✅ ORDER GROUPING
        orderGroupId,
        isParentOrder: isParent,
        parentOrderId: isParent ? null : firstOrderId,
        orderSequence: index + 1,
        totalItemsInGroup: cartItems.length,

        // Website order defaults
        userId,
        customerId: null,
        orderType: "BTC",
        orderMode: "ONLINE",
        isWebsiteOrder: true,
        createdBy: null,

        // Product
        productId: item.productId._id,
        product_details: {
          name: item.productId.name,
          image: item.productId.image,
          priceOption,
          deliveryTime: priceOption,
        },
        quantity: item.quantity,
        unitPrice: finalPrice,

        // Pricing
        subTotalAmt: itemSubtotal,
        totalAmt: itemTotal,
        shipping_cost: shippingCostPerItem,
        currency: "NGN",
        // Item #7: same country-isolation stamping as the Paystack/Stripe
        // paths above — insertMany() skips countryScopedPlugin's pre-save
        // hook, so without this every bank-transfer order defaulted to "NG".
        countryCode: request.countryCode || "NG",

        // Group totals
        groupTotals: isParent ? groupTotals : {},

        // Payment (SHARED)
        paymentId: `BANK-${Date.now()}`,
        payment_status: "PENDING_BANK_TRANSFER",
        payment_method: "BANK_TRANSFER",
        bank_transfer_details: bankDetails,

        // Delivery (SHARED)
        delivery_address: addressId,
        shippingMethod: shippingMethodId,
        shippingZone: shippingZone?._id,
        shipping_details: shippingMethod
          ? {
              method_name: shippingMethod.name,
              method_type: shippingMethod.type,
              carrier: { name: "I-Coffee Logistics", code: "ICF" },
            }
          : {},

        // Notes
        admin_notes: `Bank Transfer - Reference: ${bankDetails.reference}`,
      };
    });

    // Update group totals in first order
    orderItems[0].groupTotals = groupTotals;

    const orders = await OrderModel.insertMany(orderItems);

    await CartProductModel.deleteMany({ userId });
    await UserModel.updateOne({ _id: userId }, { shopping_cart: [] });

    console.log(
      `✅ Bank transfer: Created order group ${orderGroupId} with ${orders.length} orders`,
    );

    return response.json({
      message: "Bank transfer order placed successfully",
      data: orders,
      success: true,
    });
  } catch (error) {
    console.error("Bank transfer error:", error);
    return response.status(500).json({
      message: error.message,
      error: true,
    });
  }
}

// ===== GET USER ORDERS - GROUPED =====
export async function getOrderDetailsController(request, response) {
  try {
    const userId = request.userId;
    const { page = 1, limit = 10 } = request.query;

    // ✅ Get GROUPED orders using the new static method
    const result = await OrderModel.getGroupedOrdersForUser(userId, {
      page: parseInt(page),
      limit: parseInt(limit),
    });

    console.log(
      `📦 Found ${result.totalGroups} order groups for user ${userId}`,
    );

    return response.json({
      message: "Orders retrieved successfully",
      data: result.groups,
      pagination: {
        totalGroups: result.totalGroups,
        currentPage: result.page,
        totalPages: result.totalPages,
        hasMore: result.page < result.totalPages,
      },
      success: true,
    });
  } catch (error) {
    console.error("Get order details error:", error);
    return response.status(500).json({
      message: error.message,
      error: true,
    });
  }
}

// ===== GET ORDER GROUP BY ID =====
export async function getOrderGroupController(request, response) {
  try {
    const { orderGroupId } = request.params;
    const userId = request.userId;

    // Get all orders in the group
    const orders = await OrderModel.getOrderGroup(orderGroupId);

    if (orders.length === 0) {
      return response.status(404).json({
        message: "Order group not found",
        error: true,
      });
    }

    // Verify ownership
    const firstOrder = orders[0];
    if (
      firstOrder.userId?.toString() !== userId &&
      firstOrder.customerId?.toString() !== userId
    ) {
      return response.status(403).json({
        message: "Access denied",
        error: true,
      });
    }

    const parentOrder = orders.find((o) => o.isParentOrder);
    const childOrders = orders.filter((o) => !o.isParentOrder);

    return response.json({
      message: "Order group retrieved successfully",
      data: {
        orderGroupId,
        parentOrder,
        childOrders,
        allOrders: orders,
        summary: {
          totalItems: parentOrder.totalItemsInGroup,
          createdAt: parentOrder.createdAt,
          payment_status: parentOrder.payment_status,
          totals: parentOrder.groupTotals,
        },
      },
      success: true,
    });
  } catch (error) {
    console.error("Get order group error:", error);
    return response.status(500).json({
      message: error.message,
      error: true,
    });
  }
}
