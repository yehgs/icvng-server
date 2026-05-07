// server/controllers/guestOrder.controller.js
// Guest checkout — no account required.
// Supports: Paystack (NGN) + Stripe (USD/EUR/GBP) + Bank Transfer

import OrderModel from "../models/order.model.js";
import ProductModel from "../models/product.model.js";
import AddressModel from "../models/address.model.js";
import ShippingMethodModel from "../models/shipping-method.model.js";
import ShippingZoneModel from "../models/shipping-zone.model.js";
import Stripe from "../config/stripe.js";
import { STRIPE_WEBHOOK_SECRET } from "../config/stripe.js";
import mongoose from "mongoose";
import crypto from "crypto";

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

const STATE_CODES = {
  Abia: "AB",
  Adamawa: "AD",
  "Akwa Ibom": "AK",
  Anambra: "AN",
  Bauchi: "BA",
  Bayelsa: "BY",
  Benue: "BE",
  Borno: "BO",
  "Cross River": "CR",
  Delta: "DE",
  Ebonyi: "EB",
  Edo: "ED",
  Ekiti: "EK",
  Enugu: "EN",
  FCT: "FC",
  Gombe: "GO",
  Imo: "IM",
  Jigawa: "JI",
  Kaduna: "KD",
  Kano: "KN",
  Katsina: "KT",
  Kebbi: "KB",
  Kogi: "KO",
  Kwara: "KW",
  Lagos: "LA",
  Nasarawa: "NA",
  Niger: "NI",
  Ogun: "OG",
  Ondo: "ON",
  Osun: "OS",
  Oyo: "OY",
  Plateau: "PL",
  Rivers: "RI",
  Sokoto: "SO",
  Taraba: "TA",
  Yobe: "YO",
  Zamfara: "ZA",
};

const generateOrderId = () => {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `ICG-${ts}-${rnd}`; // ICG = i-coffee Guest
};

const generateGroupId = (suffix = "") => {
  return `GRP-GUEST-${Date.now()}-${Math.random().toString(36).substring(2, 8)}${suffix ? "-" + suffix : ""}`;
};

// Build order documents from guest cart items
async function buildGuestOrders({
  guestInfo,
  address,
  cartItems,
  shippingMethodId,
  shippingCost = 0,
  paymentMethod,
  currency = "NGN",
  paymentId = "",
  paymentStatus = "PENDING",
  groupId,
  exchangeRateInfo = null,
  originalAmounts = null,
}) {
  const orders = [];
  let totalSubtotal = 0;

  const shippingMethod = shippingMethodId
    ? await ShippingMethodModel.findById(shippingMethodId).catch(() => null)
    : null;

  let shippingZone = null;
  if (address?.shipping_zone) {
    shippingZone = await ShippingZoneModel.findById(
      address.shipping_zone,
    ).catch(() => null);
  }

  for (let i = 0; i < cartItems.length; i++) {
    const item = cartItems[i];
    const productId = item.productId || item._id;
    const product = await ProductModel.findById(productId).catch(() => null);
    if (!product) {
      console.warn(`Guest order: product not found: ${productId}`);
      continue;
    }

    const unitPrice = item.selectedPrice || item.price || product.price || 0;
    const qty = item.quantity || 1;
    const subtotal = unitPrice * qty;
    totalSubtotal += subtotal;

    // Shipping cost on first item only
    const itemShipping = i === 0 ? shippingCost : 0;

    const orderId = generateOrderId();

    orders.push({
      orderId,
      orderGroupId: groupId,
      isParentOrder: i === 0,
      parentOrderId: i === 0 ? null : orders[0]?.orderId || null,
      orderSequence: i + 1,
      totalItemsInGroup: cartItems.length,

      // Guest — no userId / customerId
      isWebsiteOrder: true,
      isGuest: true,
      guestInfo: {
        firstName: guestInfo.firstName,
        lastName: guestInfo.lastName,
        email: guestInfo.email,
        phone: guestInfo.phone,
      },

      orderType: "BTC",
      orderMode: "ONLINE",

      productId,
      product_details: {
        name: product.name,
        image: product.image || [],
        priceOption: item.priceOption || "regular",
        deliveryTime: "",
      },
      quantity: qty,
      unitPrice,
      subTotalAmt: subtotal,
      shipping_cost: itemShipping,
      totalAmt: subtotal + itemShipping,
      currency,

      // Exchange rate info (for international orders)
      exchangeRateUsed: exchangeRateInfo
        ? {
            rate: exchangeRateInfo.rate,
            fromCurrency: exchangeRateInfo.fromCurrency || "NGN",
            toCurrency: exchangeRateInfo.toCurrency || currency,
            rateSource: exchangeRateInfo.rateSource || "manual",
            appliedAt: exchangeRateInfo.appliedAt
              ? new Date(exchangeRateInfo.appliedAt)
              : new Date(),
          }
        : {
            rate: 1,
            fromCurrency: "NGN",
            toCurrency: "NGN",
            rateSource: "manual",
            appliedAt: new Date(),
          },

      // Store original NGN amounts for accounting
      amountsInNGN: originalAmounts
        ? {
            subtotal: originalAmounts.subTotalAmt || subtotal,
            shipping: originalAmounts.shippingCost || shippingCost,
            total: originalAmounts.totalAmt || subtotal + shippingCost,
          }
        : { subtotal, shipping: itemShipping, total: subtotal + itemShipping },

      // Shipping address embedded (no addressId dependency for guests)
      delivery_address: address?._id || undefined,
      shippingAddress: {
        address_line: address?.address_line || "",
        address_line_2: address?.address_line_2 || "",
        city: address?.city || "",
        lga: address?.lga || "",
        state: address?.state || "",
        postal_code: address?.postal_code || "",
        mobile: guestInfo.phone,
        recipientName: `${guestInfo.firstName} ${guestInfo.lastName}`,
      },

      shippingMethod: shippingMethod?._id || undefined,
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
      shippingZone: shippingZone?._id || undefined,

      paymentId,
      payment_status: paymentStatus,
      payment_method:
        paymentMethod === "stripe"
          ? "STRIPE"
          : paymentMethod === "paystack"
            ? "PAYSTACK"
            : paymentMethod === "BANK_TRANSFER"
              ? "BANK_TRANSFER"
              : "BANK_TRANSFER",

      delivery_status: "PENDING",
      orderStatus: "PENDING",
    });
  }

  // Group totals on parent order
  if (orders.length > 0) {
    orders[0].groupTotals = {
      subTotal: totalSubtotal,
      totalShipping: shippingCost,
      totalDiscount: 0,
      totalTax: 0,
      grandTotal: totalSubtotal + shippingCost,
      itemCount: cartItems.length,
    };
  }

  return orders;
}

// ─────────────────────────────────────────────────────────────
// 1. CREATE GUEST TEMP ADDRESS (for shipping calculation)
// ─────────────────────────────────────────────────────────────
export async function createGuestTempAddress(request, response) {
  try {
    const {
      address_line,
      address_line_2 = "",
      city,
      lga,
      state,
      postal_code = "",
      mobile,
      guestName,
      guestEmail,
    } = request.body;

    if (!address_line || !city || !lga || !state || !mobile || !guestEmail) {
      return response.status(400).json({
        message: "Address, mobile and contact email are required",
        error: true,
        success: false,
      });
    }

    const state_code =
      STATE_CODES[state] || state.substring(0, 2).toUpperCase();

    const tempAddress = await AddressModel.create({
      address_line,
      address_line_2,
      city,
      lga,
      state,
      state_code,
      ...(postal_code ? { postal_code } : {}),
      mobile,
      isGuestAddress: true,
      guestName,
      guestEmail,
      status: true,
      is_primary: false,
    });

    return response.json({
      message: "Temporary address created",
      success: true,
      data: tempAddress,
    });
  } catch (error) {
    console.error("Guest temp address error:", error);
    return response.status(500).json({
      message: error.message || "Failed to create address",
      error: true,
      success: false,
    });
  }
}

// ─────────────────────────────────────────────────────────────
// 2a. GUEST PAYSTACK PAYMENT (NGN only)
// ─────────────────────────────────────────────────────────────
export async function guestPaystackController(request, response) {
  try {
    const {
      guestInfo,
      addressId,
      cartItems,
      shippingMethodId,
      shippingCost = 0,
      currency = "NGN",
    } = request.body;

    if (currency !== "NGN") {
      return response.status(400).json({
        message:
          "Paystack only supports NGN. Please switch currency to use Paystack.",
        error: true,
        success: false,
      });
    }

    if (!guestInfo?.email || !cartItems?.length || !addressId) {
      return response.status(400).json({
        message: "Guest info, address and cart items are required",
        error: true,
        success: false,
      });
    }

    const address = await AddressModel.findById(addressId);
    if (!address)
      return response
        .status(404)
        .json({ message: "Address not found", error: true, success: false });

    const groupId = generateGroupId("PSK");
    const reference = `ICGUEST-${groupId}-${Date.now()}`;

    // Calculate total in NGN
    let subtotal = 0;
    for (const item of cartItems) {
      subtotal +=
        (item.selectedPrice || item.price || 0) * (item.quantity || 1);
    }
    const totalAmount = subtotal + shippingCost;
    const amountInKobo = Math.round(totalAmount * 100);

    const paystackRes = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: guestInfo.email,
          amount: amountInKobo,
          currency: "NGN",
          reference,
          callback_url: `${process.env.FRONTEND_URL}/paystack-callback?guest=true`,
          metadata: {
            isGuest: true,
            groupId,
            guestInfo,
            addressId,
            shippingMethodId: shippingMethodId || "",
            shippingCost,
            cartItems: cartItems.map((i) => ({
              productId: i.productId || i._id,
              quantity: i.quantity,
              price: i.selectedPrice || i.price,
              priceOption: i.priceOption || "regular",
            })),
          },
        }),
      },
    );

    const paystackData = await paystackRes.json();

    if (!paystackData.status) {
      return response.status(400).json({
        message: paystackData.message || "Paystack initialization failed",
        error: true,
        success: false,
      });
    }

    return response.json({
      message: "Payment initialized",
      success: true,
      data: {
        authorization_url: paystackData.data.authorization_url,
        reference,
        access_code: paystackData.data.access_code,
      },
    });
  } catch (error) {
    console.error("Guest Paystack error:", error);
    return response.status(500).json({
      message: error.message || "Payment initiation failed",
      error: true,
      success: false,
    });
  }
}

// ─────────────────────────────────────────────────────────────
// 2b. GUEST STRIPE PAYMENT (USD / EUR / GBP)
// ─────────────────────────────────────────────────────────────
export async function guestStripeController(request, response) {
  try {
    const {
      guestInfo,
      addressId,
      cartItems,
      shippingMethodId,
      shippingCost = 0,
      currency, // e.g. 'USD', 'EUR', 'GBP'
      subTotalAmt, // already converted to target currency
      totalAmt, // already converted to target currency
      originalAmounts, // original NGN amounts
      exchangeRateInfo, // { rate, fromCurrency, toCurrency, rateSource }
    } = request.body;

    if (!currency || currency === "NGN") {
      return response.status(400).json({
        message:
          "Stripe is for international currencies (USD, EUR, GBP). Use Paystack for NGN.",
        error: true,
        success: false,
      });
    }

    if (!guestInfo?.email || !cartItems?.length || !addressId) {
      return response.status(400).json({
        message: "Guest info, address and cart items are required",
        error: true,
        success: false,
      });
    }

    const address = await AddressModel.findById(addressId);
    if (!address)
      return response
        .status(404)
        .json({ message: "Address not found", error: true, success: false });

    const groupId = generateGroupId("STR");

    // Build Stripe line items using the CONVERTED amounts
    const line_items = [];
    const originalSubtotal = originalAmounts?.subTotalAmt || subTotalAmt;

    for (const item of cartItems) {
      const product = await ProductModel.findById(item.productId || item._id);
      if (!product) continue;

      const itemNGNPrice =
        (item.selectedPrice || item.price || product.price || 0) *
        (item.quantity || 1);
      const proportion =
        originalSubtotal > 0 ? itemNGNPrice / originalSubtotal : 0;
      const itemConverted = (subTotalAmt * proportion) / (item.quantity || 1);
      const unitAmountCents = Math.round(itemConverted * 100);

      line_items.push({
        price_data: {
          currency: currency.toLowerCase(),
          product_data: {
            name: `${product.name}${item.priceOption && item.priceOption !== "regular" ? ` (${item.priceOption})` : ""}`,
            images: Array.isArray(product.image)
              ? product.image.slice(0, 1)
              : [],
            metadata: {
              productId: product._id.toString(),
              priceOption: item.priceOption || "regular",
            },
          },
          unit_amount: unitAmountCents,
        },
        adjustable_quantity: { enabled: true, minimum: 1 },
        quantity: item.quantity || 1,
      });
    }

    // Add shipping as line item if applicable
    if (shippingCost > 0) {
      const shippingMethod = shippingMethodId
        ? await ShippingMethodModel.findById(shippingMethodId).catch(() => null)
        : null;

      line_items.push({
        price_data: {
          currency: currency.toLowerCase(),
          product_data: {
            name: `Shipping — ${shippingMethod?.name || "Standard Delivery"}`,
            metadata: { type: "shipping" },
          },
          unit_amount: Math.round(shippingCost * 100),
        },
        quantity: 1,
      });
    }

    const session = await Stripe.checkout.sessions.create({
      submit_type: "pay",
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: guestInfo.email,
      metadata: {
        isGuest: "true",
        groupId,
        guestFirstName: guestInfo.firstName,
        guestLastName: guestInfo.lastName,
        guestEmail: guestInfo.email,
        guestPhone: guestInfo.phone,
        addressId,
        shippingMethodId: shippingMethodId || "",
        shippingCostConverted: shippingCost.toString(),
        exchangeRate: (exchangeRateInfo?.rate || 1).toString(),
        fromCurrency: exchangeRateInfo?.fromCurrency || "NGN",
        toCurrency: currency,
        rateSource: exchangeRateInfo?.rateSource || "manual",
        originalSubtotalNGN: (originalAmounts?.subTotalAmt || 0).toString(),
        originalShippingNGN: (originalAmounts?.shippingCost || 0).toString(),
        originalTotalNGN: (originalAmounts?.totalAmt || 0).toString(),
        cartItemsJSON: JSON.stringify(
          cartItems.map((i) => ({
            productId: i.productId || i._id,
            quantity: i.quantity,
            price: i.selectedPrice || i.price,
            priceOption: i.priceOption || "regular",
          })),
        ),
      },
      line_items,
      success_url: `${process.env.FRONTEND_URL}/success?guest=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/cancel`,
    });

    return response.json({
      message: "Stripe session created",
      success: true,
      data: { id: session.id },
    });
  } catch (error) {
    console.error("Guest Stripe error:", error);
    return response.status(500).json({
      message: error.message || "Stripe session creation failed",
      error: true,
      success: false,
    });
  }
}

// ─────────────────────────────────────────────────────────────
// 2c. GUEST BANK TRANSFER ORDER
// ─────────────────────────────────────────────────────────────
export async function guestBankTransferController(request, response) {
  try {
    const {
      guestInfo,
      addressId,
      cartItems,
      shippingMethodId,
      shippingCost = 0,
      currency = "NGN",
    } = request.body;

    if (currency !== "NGN") {
      return response.status(400).json({
        message: "Bank transfer is only available for NGN orders.",
        error: true,
        success: false,
      });
    }

    if (!guestInfo?.email || !cartItems?.length || !addressId) {
      return response.status(400).json({
        message: "Guest info, address and cart items are required",
        error: true,
        success: false,
      });
    }

    const address = await AddressModel.findById(addressId);
    if (!address)
      return response
        .status(404)
        .json({ message: "Address not found", error: true, success: false });

    const groupId = generateGroupId("BTF");

    const orders = await buildGuestOrders({
      guestInfo,
      address,
      cartItems,
      shippingMethodId,
      shippingCost,
      paymentMethod: "BANK_TRANSFER",
      currency,
      paymentStatus: "PENDING_BANK_TRANSFER",
      groupId,
    });

    if (orders.length === 0) {
      return response.status(400).json({
        message: "Could not build orders — check product IDs",
        error: true,
        success: false,
      });
    }

    const savedOrders = await OrderModel.insertMany(orders);
    const parentOrder =
      savedOrders.find((o) => o.isParentOrder) || savedOrders[0];

    return response.json({
      message: "Order placed. Please complete bank transfer to confirm.",
      success: true,
      data: {
        orderId: parentOrder.orderId,
        orderGroupId: parentOrder.orderGroupId,
        grandTotal: parentOrder.groupTotals?.grandTotal || parentOrder.totalAmt,
        currency,
        bankDetails: {
          bankName: process.env.BANK_NAME || "Access Bank",
          accountName:
            process.env.ACCOUNT_NAME || "Italian Coffee Ventures Ltd",
          accountNumber: process.env.ACCOUNT_NUMBER || "0123456789",
          narration: `Payment for order ${parentOrder.orderId}`,
        },
      },
    });
  } catch (error) {
    console.error("Guest bank transfer error:", error);
    return response.status(500).json({
      message: error.message || "Order creation failed",
      error: true,
      success: false,
    });
  }
}

// ─────────────────────────────────────────────────────────────
// WEBHOOK: Guest Paystack webhook handler
// Called from the main paystackWebhookController when isGuest===true
// ─────────────────────────────────────────────────────────────
export async function processGuestPaystackWebhook(metadata, reference) {
  const {
    groupId,
    guestInfo,
    addressId,
    shippingMethodId,
    shippingCost,
    cartItems,
  } = metadata;

  // Idempotency check
  const existing = await OrderModel.findOne({ paymentId: reference });
  if (existing) {
    console.log(`Guest order already exists for reference: ${reference}`);
    return;
  }

  const address = await AddressModel.findById(addressId).catch(() => null);
  if (!address) {
    console.error("Guest webhook: address not found", addressId);
    return;
  }

  const orders = await buildGuestOrders({
    guestInfo,
    address,
    cartItems: cartItems.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      selectedPrice: i.price,
      priceOption: i.priceOption || "regular",
    })),
    shippingMethodId,
    shippingCost: shippingCost || 0,
    paymentMethod: "PAYSTACK",
    currency: "NGN",
    paymentId: reference,
    paymentStatus: "PAID",
    groupId: groupId || generateGroupId("PSK-WH"),
  });

  if (orders.length > 0) {
    await OrderModel.insertMany(orders);
    console.log(
      `✅ Guest Paystack order created via webhook. Group: ${groupId}, Ref: ${reference}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────
// WEBHOOK: Guest Stripe webhook handler
// Called from webhookStripe in order.controller.js when isGuest==='true'
// ─────────────────────────────────────────────────────────────
export async function processGuestStripeWebhook(session) {
  const meta = session.metadata;

  if (meta?.isGuest !== "true") return; // not a guest order

  const groupId = meta.groupId;

  // Idempotency
  const existing = await OrderModel.findOne({ orderGroupId: groupId });
  if (existing) {
    console.log(`Guest Stripe order already exists for group: ${groupId}`);
    return;
  }

  const guestInfo = {
    firstName: meta.guestFirstName,
    lastName: meta.guestLastName,
    email: meta.guestEmail,
    phone: meta.guestPhone,
  };

  const address = await AddressModel.findById(meta.addressId).catch(() => null);
  if (!address) {
    console.error("Guest Stripe webhook: address not found", meta.addressId);
    return;
  }

  let cartItems = [];
  try {
    cartItems = JSON.parse(meta.cartItemsJSON || "[]");
  } catch {
    cartItems = [];
  }

  const exchangeRateInfo = {
    rate: parseFloat(meta.exchangeRate || "1"),
    fromCurrency: meta.fromCurrency || "NGN",
    toCurrency: meta.toCurrency || "USD",
    rateSource: meta.rateSource || "manual",
  };

  const originalAmounts = {
    subTotalAmt: parseFloat(meta.originalSubtotalNGN || "0"),
    shippingCost: parseFloat(meta.originalShippingNGN || "0"),
    totalAmt: parseFloat(meta.originalTotalNGN || "0"),
  };

  const orders = await buildGuestOrders({
    guestInfo,
    address,
    cartItems: cartItems.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      selectedPrice: i.price,
      priceOption: i.priceOption || "regular",
    })),
    shippingMethodId: meta.shippingMethodId || null,
    shippingCost: originalAmounts.shippingCost,
    paymentMethod: "stripe",
    currency: meta.toCurrency || "USD",
    paymentId: session.payment_intent || session.id,
    paymentStatus: "PAID",
    groupId,
    exchangeRateInfo,
    originalAmounts,
  });

  if (orders.length > 0) {
    await OrderModel.insertMany(orders);
    console.log(`✅ Guest Stripe order created via webhook. Group: ${groupId}`);
  }
}
