// controllers/order.controller.js - WITH ORDER GROUPING SYSTEM
import OrderModel from "../models/order.model.js";
import CartProductModel from "../models/cartproduct.model.js";
import UserModel from "../models/user.model.js";
// CRITICAL BUGFIX (2026-08-28): ProductModel was USED on the cart-snapshot
// path below but never imported. Because paystackPaymentController stamps
// `cartItemsJSON` into metadata on EVERY checkout, that path was always the
// one taken — so every Paystack order threw
// `ReferenceError: ProductModel is not defined` before a single Order doc was
// written. The webhook caught it, logged it, and returned 200 (so Paystack
// never retried); the verify endpoint caught it and returned 500 (so the
// customer saw "Verification Error"). Net effect: money captured at the
// gateway, zero orders in Mongo, nothing recorded anywhere.
// Symptom that surfaced it: ref PSK-1787910602350-6a9144dbaa567b1ecde5a3ea,
// NGN 51,182.45, i-coffee.ng, paid + "Success" in Paystack, absent from BOTH
// the customer's order list and the admin order list.
import ProductModel from "../models/product.model.js";
import ShippingZoneModel from "../models/shipping-zone.model.js";
import ShippingMethodModel from "../models/shipping-method.model.js";
import BankTransferSettingsModel from "../models/bankTransferSettings.model.js";
// Durable audit trail for payments that succeed at the gateway but fail to
// produce an order. A console.error on a serverless host is not an audit
// trail — this is (see models/payment-failure.model.js).
import PaymentFailureModel from "../models/payment-failure.model.js";
import mongoose from "mongoose";
import Stripe from "../config/stripe.js";
import { STRIPE_WEBHOOK_SECRET } from "../config/stripe.js";
import crypto from "crypto";
// Country-scoped, language-scoped customer emails. ALWAYS branded off the
// ORDER's countryCode, never the requesting admin's / the API host's.
import {
  orderConfirmationEmail,
  paymentStatusEmail,
  resolveEmailCountry,
  subjectFor,
} from "../utils/countryEmailTemplates.js";
import { sendCountryEmail } from "../config/emailService.js";
// Gateway availability is DECLARED per country in config/countries/index.js
// (`payments: { paystack, stripe }`) but was never ENFORCED anywhere — the
// helper existed and had zero call sites. A crafted request could therefore
// open a Paystack session against a Togo/Benin/Italy storefront.
import { isPaymentProviderEnabled, getCountryByCode } from "../config/countries/index.js";
import { fulfillGiftCardPurchase } from "./giftCard.controller.js";
import { resolveGiftCardForCheckout, redeemGiftCardAmount } from "../utils/giftCardCheckout.js";

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

/**
 * Send the country-scoped order-confirmation email for a freshly created
 * order group.
 *
 * Country resolution rule (applies everywhere in this codebase):
 *   the email is branded, localized and denominated from the ORDER's own
 *   countryCode — NOT req.countryCode, NOT the admin's country, NOT the API
 *   host. A Togo order confirmed by an HQ webhook still gets a French,
 *   Togo-branded, XOF email.
 *
 * Never throws: a mail failure must not roll back or 500 a payment that has
 * already been captured. Failures are recorded against the payment reference
 * so they are visible and replayable.
 */
async function sendOrderConfirmationEmails({ orders, user, reference, provider }) {
  try {
    if (!orders?.length || !user?.email) return;

    const parent = orders.find((o) => o.isParentOrder) || orders[0];
    const country = resolveEmailCountry(parent.countryCode);

    await sendCountryEmail({
      countryCode: country.code,
      sendTo: user.email,
      subject: subjectFor("orderConfirmed", country, { orderId: parent.orderId }),
      html: orderConfirmationEmail({
        order: parent,
        user,
        items: orders,
        country,
      }),
    });

    // Payment confirmation is a separate, legally-meaningful notice from the
    // order confirmation — customers routinely need the former as proof of
    // charge even when the latter lands in promotions.
    if (parent.payment_status === "PAID") {
      await sendCountryEmail({
        countryCode: country.code,
        sendTo: user.email,
        subject: subjectFor("paymentStatus", country, {
          orderId: parent.orderId,
          status: "PAID",
        }),
        html: paymentStatusEmail({
          order: parent,
          user,
          status: "PAID",
          country,
          amount: parent.groupTotals?.grandTotal ?? parent.totalAmt,
          currency: parent.currency,
        }),
      });
    }
  } catch (err) {
    console.error("[order] confirmation email failed:", err.message);
    await PaymentFailureModel.record({
      reference,
      provider: provider || "PAYSTACK",
      stage: "EMAIL",
      countryCode: orders?.[0]?.countryCode,
      userId: user?._id,
      customerEmail: user?.email,
      error: err,
    });
  }
}

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

  // COUNTRY RESOLUTION — metadata wins over request context.
  //
  // The webhook is called by PAYSTACK'S servers, not the customer's browser:
  // there is no X-Storefront-Host header and req.headers.host is our own API
  // host, so countryDetect can only fall back to DEFAULT_COUNTRY ("NG"). That
  // silently mis-stamps any non-NG Paystack order. The country is therefore
  // snapshotted into metadata at checkout INITIATION (where the storefront
  // host is genuinely known) and read back here — exactly the pattern the
  // Stripe path already uses via session.metadata.countryCode.
  const resolvedCountry = metadata.countryCode || countryCode || "NG";
  const resolvedCurrency = metadata.currencyCode || currencyCode || "NGN";

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
        null,
        resolvedCountry,
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
      currency: resolvedCurrency,
      countryCode: resolvedCountry,
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

  // ── Gift card redemption ─────────────────────────────────────────────
  // The amount was already fixed (and Paystack already charged net of it)
  // at initiation time — see paystackPaymentController. Applying it here
  // means reducing the PARENT order's recorded total by the same fixed
  // amount, so the order's totalAmt matches what the customer actually
  // paid across gift card + Paystack combined.
  const giftCardId = metadata.giftCardId;
  const giftCardAmount = parseFloat(metadata.giftCardAmount || "0");
  if (giftCardId && giftCardAmount > 0) {
    orderItems[0].totalAmt = Math.max(0, orderItems[0].totalAmt - giftCardAmount);
    orderItems[0].groupTotals.giftCardAmount = giftCardAmount;
    orderItems[0].groupTotals.grandTotal = Math.max(0, orderItems[0].groupTotals.grandTotal - giftCardAmount);
    orderItems[0].giftCardRedemption = {
      giftCardId,
      code: metadata.giftCardCode || "",
      amount: giftCardAmount,
    };
  }

  const orders = await OrderModel.insertMany(orderItems);

  if (giftCardId && giftCardAmount > 0) {
    await redeemGiftCardAmount({
      giftCardId,
      amount: giftCardAmount,
      orderGroupId,
      orderId: orders[0]?.orderId,
      redeemedByUser: userId,
    });
  }

  // Clear cart
  await CartProductModel.deleteMany({ userId });
  await UserModel.updateOne({ _id: userId }, { shopping_cart: [] });

  console.log(
    `✅ Paystack: Created order group ${orderGroupId} with ${orders.length} orders (${resolvedCountry})`,
  );

  // If a previous attempt on this reference was recorded as failed (e.g. the
  // webhook hit the ProductModel crash and the browser-redirect retry now
  // succeeded), close that record out so it stops showing as an open
  // reconciliation item.
  await PaymentFailureModel.resolve(reference, { orderGroupId });

  // Country-scoped confirmation + payment-received emails. Awaited but
  // non-fatal — see sendOrderConfirmationEmails.
  await sendOrderConfirmationEmails({
    orders,
    user,
    reference,
    provider: "PAYSTACK",
  });

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

      // Gift-card purchases share Paystack's ONE dashboard-level webhook URL
      // with regular checkout (Paystack has no per-transaction webhook), so
      // this is where the two flows split — everything else about this
      // handler (idempotent, ack-with-200-even-on-failure) applies equally
      // to both.
      if (metadata?.purpose === "GIFT_CARD_PURCHASE") {
        try {
          await fulfillGiftCardPurchase({ reference, metadata, provider: "PAYSTACK" });
        } catch (err) {
          console.error("Paystack webhook gift card fulfillment failed:", err.message);
          await PaymentFailureModel.record({
            reference,
            provider: "PAYSTACK",
            stage: "GIFT_CARD_FULFILLMENT",
            countryCode: metadata?.countryCode || request.countryCode || "NG",
            userId: metadata?.userId,
            customerEmail: data?.customer?.email,
            amount: typeof data?.amount === "number" ? data.amount / 100 : undefined,
            currency: data?.currency || "NGN",
            metadata,
            error: err,
          });
        }
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
        // We still ack with 200 — Paystack retries on non-2xx and a retry
        // won't fix a genuinely empty cart. But we no longer ONLY log:
        // console output on a serverless host is not recoverable, and that
        // is precisely how a real NGN 51,182.45 charge went untraceable.
        // Persist it so finance/IT can reconcile and replay.
        console.error("Paystack webhook order creation failed:", err.message);
        await PaymentFailureModel.record({
          reference,
          provider: "PAYSTACK",
          stage: "ORDER_CREATION",
          countryCode: metadata?.countryCode || request.countryCode || "NG",
          userId: metadata?.userId,
          customerEmail: data?.customer?.email,
          amount: typeof data?.amount === "number" ? data.amount / 100 : undefined,
          currency: data?.currency || "NGN",
          metadata,
          error: err,
        });
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

    // No guest checkout path — checkout requires a logged-in account (the
    // cart drawer's auth modal gates access before checkout is ever
    // reached), so metadata.isGuest can never actually be true here. The
    // dead guest-order branch that used to live here (and its
    // ./guest_order.controller.js import) has been removed.
    let result;
    try {
      result = await createOrderFromPaystackTransaction({
        reference,
        metadata,
        countryCode: request.countryCode || "NG",
        currencyCode: request.country?.currency?.code || "NGN",
      });
    } catch (creationError) {
      // The charge IS confirmed at this point (we checked status above), so a
      // failure here means money exists with no order behind it. Record it
      // before surfacing the error, so it is reconcilable even if the
      // customer closes the tab.
      await PaymentFailureModel.record({
        reference,
        provider: "PAYSTACK",
        stage: "ORDER_CREATION",
        countryCode: metadata?.countryCode || request.countryCode || "NG",
        userId: metadata?.userId,
        customerEmail: verifyData.data?.customer?.email,
        amount: typeof amount === "number" ? amount / 100 : undefined,
        currency,
        metadata,
        error: creationError,
      });
      throw creationError;
    }
    const orderGroupId = result.orderGroupId;

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
      giftCardCode,
    } = request.body;

    // ── GATEWAY AVAILABILITY GUARD ────────────────────────────────────────
    // Paystack is NIGERIA-ONLY. Stripe serves every country (Nigeria
    // included, which is how an NG customer pays in a foreign currency).
    // Enforced from COUNTRY_CONFIG rather than a hardcoded country list, so
    // adding a future local gateway (or enabling Paystack elsewhere) is a
    // config change, not a code change.
    const initCountry = request.countryCode || "NG";
    if (!isPaymentProviderEnabled(initCountry, "paystack")) {
      const meta = getCountryByCode(initCountry);
      return response.status(400).json({
        message: `Paystack is not available in ${meta?.name || initCountry}. Please use another payment method.`,
        error: true,
        success: false,
      });
    }

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

    // ── Gift card (optional, partial or full) ───────────────────────────
    // Resolved here (not deducted yet — see utils/giftCardCheckout.js) so
    // the amount actually charged to Paystack is already net of it. The
    // fixed appliedAmount is snapshotted into metadata for the webhook/
    // verify step to redeem — same "decide now, confirm later" pattern
    // already used for the cart snapshot below.
    let giftCardApplied = null;
    let chargeAmount = totalAmt;
    if (giftCardCode) {
      try {
        const resolved = await resolveGiftCardForCheckout({
          code: giftCardCode,
          orderAmount: totalAmt,
          currency: "NGN",
          countryCode: request.countryCode || "NG",
        });
        giftCardApplied = { giftCardId: resolved.giftCard._id.toString(), amount: resolved.appliedAmount };
        chargeAmount = resolved.remainderToPay;
      } catch (gcErr) {
        return response.status(400).json({ message: gcErr.message, error: true, success: false });
      }
    }

    const amountInKobo = Math.round(chargeAmount * 100);

    // A gift card covering the FULL total means there is nothing left to
    // charge Paystack for — Paystack requires a non-zero amount, so this
    // needs to be routed through a zero-payment order path instead.
    if (giftCardApplied && amountInKobo <= 0) {
      return response.status(400).json({
        message:
          "GIFT_CARD_COVERS_FULL_TOTAL: this gift card fully covers the order — use the gift-card-only checkout instead of Paystack.",
        error: true,
        success: false,
        data: { giftCardApplied },
      });
    }

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
        ...(giftCardApplied && {
          giftCardId: giftCardApplied.giftCardId,
          giftCardAmount: giftCardApplied.amount.toString(),
          giftCardCode: giftCardCode.trim().toUpperCase(),
        }),
        // Snapshot the storefront's country HERE, where it is genuinely
        // known (the browser sent X-Storefront-Host on this call). The
        // webhook that later creates the order is called by Paystack, not
        // the browser, so it has no way to detect country and would
        // otherwise stamp every order "NG". Mirrors what the Stripe
        // checkout-session path already does with session.metadata.
        countryCode: request.countryCode || "NG",
        currencyCode: request.country?.currency?.code || "NGN",
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

      // Same split as the Paystack webhook above — one dashboard-level
      // webhook URL serves both regular checkout and gift-card purchase
      // sessions (see initiateStripeGiftCardPurchase).
      if (session.metadata?.purpose === "GIFT_CARD_PURCHASE") {
        try {
          await fulfillGiftCardPurchase({
            reference: session.payment_intent || session.id,
            metadata: session.metadata,
            provider: "STRIPE",
          });
        } catch (err) {
          console.error("Stripe webhook gift card fulfillment failed:", err.message);
          await PaymentFailureModel.record({
            reference: session?.payment_intent || session?.id,
            provider: "STRIPE",
            stage: "GIFT_CARD_FULFILLMENT",
            countryCode: session?.metadata?.countryCode || "NG",
            userId: session?.metadata?.userId,
            customerEmail: session?.customer_email,
            amount: typeof session?.amount_total === "number" ? session.amount_total / 100 : undefined,
            currency: session?.currency?.toUpperCase(),
            metadata: session?.metadata,
            error: err,
          });
        }
        break;
      }

      try {
        // No guest checkout path — checkout requires a logged-in account,
        // so session.metadata.isGuest can never actually be true here.
        // The dead guest-order branch that used to live here (and its
        // ./guest_order.controller.js import) has been removed.
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
          // Stamped into the session's metadata at checkout-session
          // creation (see line ~840's read of the same field) — the
          // webhook itself has no reliable storefront-domain signal
          // (Stripe calls our API's own host), so this is the only
          // trustworthy source of which country the order belongs to.
          countryCode: session.metadata?.countryCode || "NG",
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

        // Country-scoped confirmation + payment-received emails. Stripe is
        // the gateway for TG/BJ/IT (and for NG customers paying in a foreign
        // currency), so this is the path that most often needs a non-English,
        // non-NGN email — branded off the ORDER's countryCode.
        const stripeUser = userId ? await UserModel.findById(userId) : null;
        await sendOrderConfirmationEmails({
          orders,
          user: stripeUser,
          reference: session.payment_intent,
          provider: "STRIPE",
        });
      } catch (error) {
        console.error("Error processing checkout.session.completed:", error);
        // Persist so a Stripe charge can never go orphaned+untraceable the
        // way the Paystack one did.
        await PaymentFailureModel.record({
          reference: session?.payment_intent || session?.id,
          provider: "STRIPE",
          stage: "ORDER_CREATION",
          countryCode: session?.metadata?.countryCode || "NG",
          userId: session?.metadata?.userId,
          customerEmail: session?.customer_email,
          amount: typeof session?.amount_total === "number" ? session.amount_total / 100 : undefined,
          currency: session?.currency?.toUpperCase(),
          metadata: session?.metadata,
          error,
        });
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

    // ── GATEWAY AVAILABILITY GUARD ────────────────────────────────────────
    // Stripe is enabled for ALL countries today (see COUNTRY_CONFIG). The
    // guard is still applied rather than assumed, so that when a
    // country-local gateway is introduced later and Stripe is switched off
    // for that market, turning `stripe: false` in config is genuinely
    // sufficient — no code change, no silently-still-reachable endpoint.
    const stripeCountry = request.countryCode || "NG";
    if (!isPaymentProviderEnabled(stripeCountry, "stripe")) {
      const meta = getCountryByCode(stripeCountry);
      return response.status(400).json({
        message: `Stripe is not available in ${meta?.name || stripeCountry}. Please use another payment method.`,
        error: true,
        success: false,
      });
    }

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
  countryCode,
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
        null,
        countryCode,
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
      giftCardCode,
    } = request.body;

    // Country-scoped: which currency THIS request's storefront actually
    // trades in — resolved from the domain by the global countryDetect
    // middleware, not the client-submitted `currency`. Bank Transfer used
    // to hard-block everything except NGN (Direct Bank Transfer is only
    // available for NGN) which meant Togo/Benin/Italy customers couldn't
    // use it at all. Now it's allowed in whatever currency the
    // customer's own storefront trades in, and the client-submitted
    // `currency` is just a confirmation check (protects against a stale
    // client cached from a different country's session) rather than the
    // source of truth.
    const expectedCurrency = request.country?.currency?.code || "NGN";
    const orderCurrency = expectedCurrency;

    if (currency !== expectedCurrency) {
      return response.status(400).json({
        message: `Direct Bank Transfer for this store is only available in ${expectedCurrency}`,
        error: true,
      });
    }

    // "If the country bank transfer is not set, payment option will only
    // be Stripe by default" — enforced here too (not just hidden in the
    // checkout UI), so this endpoint can't be hit directly to create a
    // bank-transfer order for a country IT/DIRECTOR hasn't configured one
    // for. Deferred until AFTER gift card resolution below: a gift card
    // that fully covers the order needs no bank transfer at all, so a
    // country with no bank transfer configured (Stripe-only) can still
    // fulfill a 100%-gift-card order through this same endpoint.
    const bankSetting = await BankTransferSettingsModel.findOne({
      countryCode: request.countryCode,
      isActive: true,
    });

    // The order's recorded bank_transfer_details are OUR receiving
    // account (IT/DIRECTOR-configured, per country) — NOT trusted from
    // the client. `bankDetails.reference` (if the client sent one) is
    // kept as the customer's own payment reference for staff to
    // reconcile against, since that's information only the customer has
    // (which of their own transfers this was).
    const resolvedBankDetails = bankSetting
      ? {
          bankName: bankSetting.bankName,
          accountName: bankSetting.accountName,
          accountNumber: bankSetting.accountNumber,
          sortCode: bankSetting.sortCode,
          reference: bankDetails?.reference || "",
        }
      : null;

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
          null,
          request.countryCode,
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
        currency: orderCurrency,
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
        // Our own receiving-account details (IT/DIRECTOR-configured, per
        // country) — see resolvedBankDetails above. NOT the raw
        // client-submitted bankDetails.
        bank_transfer_details: resolvedBankDetails || {},

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
        admin_notes: `Bank Transfer - Reference: ${resolvedBankDetails?.reference || "(none provided)"}`,
      };
    });

    // Update group totals in first order
    orderItems[0].groupTotals = groupTotals;

    // ── Gift card (optional, partial or full) ───────────────────────────
    // No init/confirm split here (unlike Paystack) — this whole flow is one
    // synchronous request, so resolve AND redeem happen in the same call,
    // right after the real total is known and right before the orders are
    // persisted.
    //
    // NOTE ON TRUST MODEL: bank transfer orders are created immediately as
    // PENDING_BANK_TRANSFER (payment isn't actually verified yet — that
    // happens later, manually, by finance) — same as every other bank
    // transfer order today, gift-card-funded or not. Redeeming the gift
    // card here mirrors that existing trust model rather than introducing
    // a new gap; if a transfer never arrives, reverse the redemption via
    // the admin Gift Card page's balance-adjustment field (credits the
    // amount back).
    let giftCardResolution = null;
    if (giftCardCode) {
      try {
        giftCardResolution = await resolveGiftCardForCheckout({
          code: giftCardCode,
          orderAmount: groupTotals.grandTotal,
          currency: orderCurrency,
          countryCode: request.countryCode || "NG",
        });
      } catch (gcErr) {
        return response.status(400).json({ message: gcErr.message, error: true, success: false });
      }
      const { giftCard, appliedAmount } = giftCardResolution;
      orderItems[0].totalAmt = Math.max(0, orderItems[0].totalAmt - appliedAmount);
      orderItems[0].groupTotals.giftCardAmount = appliedAmount;
      orderItems[0].groupTotals.grandTotal = Math.max(0, groupTotals.grandTotal - appliedAmount);
      orderItems[0].giftCardRedemption = { giftCardId: giftCard._id, code: giftCard.code, amount: appliedAmount };
    }

    const fullyCoveredByGiftCard =
      giftCardResolution && orderItems[0].groupTotals.grandTotal <= 0;

    // Bank transfer is only actually NEEDED if something remains to be
    // paid after the gift card — a country with no bank transfer
    // configured (Stripe-only) can still place a 100%-gift-card order.
    if (!fullyCoveredByGiftCard && !bankSetting) {
      return response.status(400).json({
        message: "Direct Bank Transfer is not available for this store — please use Stripe.",
        error: true,
      });
    }
    if (!fullyCoveredByGiftCard && !resolvedBankDetails) {
      // Shouldn't happen (guarded above), but keeps orderItems below honest.
      return response.status(400).json({
        message: "Direct Bank Transfer is not available for this store.",
        error: true,
      });
    }

    if (fullyCoveredByGiftCard) {
      // Nothing left to transfer — mark every order in the group PAID via
      // GIFT_CARD instead of leaving it sitting as PENDING_BANK_TRANSFER
      // with nothing for finance to ever confirm.
      orderItems.forEach((item) => {
        item.payment_status = "PAID";
        item.payment_method = "GIFT_CARD";
        item.bank_transfer_details = {};
        item.admin_notes = `Fully paid via gift card ${giftCardResolution.giftCard.code}.`;
      });
    }

    const orders = await OrderModel.insertMany(orderItems);

    if (giftCardResolution && giftCardResolution.appliedAmount > 0) {
      await redeemGiftCardAmount({
        giftCardId: giftCardResolution.giftCard._id,
        amount: giftCardResolution.appliedAmount,
        orderGroupId,
        orderId: orders[0]?.orderId,
        redeemedByUser: userId,
      });
    }

    await CartProductModel.deleteMany({ userId });
    await UserModel.updateOne({ _id: userId }, { shopping_cart: [] });

    console.log(
      `✅ Bank transfer: Created order group ${orderGroupId} with ${orders.length} orders`,
    );

    // Country-scoped confirmation. Bank-transfer orders are normally
    // PENDING (not PAID), so the customer gets an "awaiting payment"
    // notice too — except when a gift card covered the whole order, in
    // which case it's already PAID and there is nothing to await.
    const btUser = await UserModel.findById(userId);
    await sendOrderConfirmationEmails({
      orders,
      user: btUser,
      reference: orderGroupId,
      provider: fullyCoveredByGiftCard ? "GIFT_CARD" : "BANK_TRANSFER",
    });
    if (!fullyCoveredByGiftCard) {
      try {
        const btParent = orders.find((o) => o.isParentOrder) || orders[0];
        const btCountry = resolveEmailCountry(btParent.countryCode);
        if (btUser?.email) {
          await sendCountryEmail({
            countryCode: btCountry.code,
            sendTo: btUser.email,
            subject: subjectFor("paymentStatus", btCountry, {
              orderId: btParent.orderId,
              status: "PENDING_BANK_TRANSFER",
            }),
            html: paymentStatusEmail({
              order: btParent,
              user: btUser,
              status: "PENDING_BANK_TRANSFER",
              country: btCountry,
              amount: groupTotals.grandTotal,
              currency: btParent.currency,
            }),
          });
        }
      } catch (mailErr) {
        console.error("[order] bank-transfer notice email failed:", mailErr.message);
      }
    }

    return response.json({
      message: fullyCoveredByGiftCard
        ? "Order placed and fully paid via gift card"
        : "Bank transfer order placed successfully",
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
