import crypto from "crypto";
import GiftCardModel from "../models/giftCard.model.js";
import UserModel from "../models/user.model.js";
import Stripe from "../config/stripe.js";
import { resolveGiftCardForCheckout } from "../utils/giftCardCheckout.js";
import { sendCountryEmail, wrapEmailTemplate } from "../config/emailService.js";
import { getCountryByCode, isPaymentProviderEnabled } from "../config/countries/index.js";

const MIN_AMOUNT = 1000; // ₦1,000 / $1 / etc. floor — prevents a throwaway 1-unit "gift card"
const MAX_AMOUNT = 1000000;

const generateCode = () => {
  // e.g. GC-7F3K-9QX2-P1M4 — grouped for readability when read aloud/typed in
  const raw = crypto.randomBytes(6).toString("hex").toUpperCase(); // 12 hex chars
  return `GC-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
};

async function generateUniqueCode() {
  for (let i = 0; i < 5; i++) {
    const code = generateCode();
    // eslint-disable-next-line no-await-in-loop
    const exists = await GiftCardModel.findOne({ code });
    if (!exists) return code;
  }
  throw new Error("Could not generate a unique gift card code — try again");
}

function giftCardEmailHtml({ code, amount, currency, recipientName, senderName, message }) {
  const formatted = `${currency} ${Number(amount).toLocaleString()}`;
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #7B3F1C, #4a2510); color: #fff; padding: 32px 24px; border-radius: 12px 12px 0 0; text-align: center;">
        <p style="margin: 0; font-size: 13px; letter-spacing: 1px; text-transform: uppercase; opacity: 0.85;">Gift Card</p>
        <p style="margin: 8px 0 0; font-size: 32px; font-weight: bold;">${formatted}</p>
      </div>
      <div style="border: 1px solid #eee; border-top: none; padding: 24px; border-radius: 0 0 12px 12px;">
        <p>Hi ${recipientName || "there"},</p>
        <p>${senderName ? `${senderName} has sent you a gift card${message ? " with a message below" : ""}!` : "You've received a gift card!"}</p>
        ${message ? `<blockquote style="margin: 16px 0; padding: 12px 16px; background: #f7f3ef; border-left: 3px solid #7B3F1C; font-style: italic;">${message}</blockquote>` : ""}
        <div style="text-align: center; margin: 24px 0; padding: 16px; background: #f7f3ef; border-radius: 8px;">
          <p style="margin: 0 0 4px; font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px;">Your gift card code</p>
          <p style="margin: 0; font-size: 22px; font-weight: bold; letter-spacing: 1px; color: #7B3F1C;">${code}</p>
        </div>
        <p>Enter this code at checkout to redeem it toward any order.</p>
      </div>
    </div>
  `;
}

async function deliverGiftCardEmail(giftCard, countryCode) {
  try {
    await sendCountryEmail({
      countryCode,
      sendTo: giftCard.recipientEmail,
      subject: `You've received a ${giftCard.currency} ${giftCard.initialAmount.toLocaleString()} gift card`,
      html: wrapEmailTemplate(
        countryCode,
        giftCardEmailHtml({
          code: giftCard.code,
          amount: giftCard.initialAmount,
          currency: giftCard.currency,
          recipientName: giftCard.recipientName,
          senderName: giftCard.purchaserName,
          message: giftCard.message,
        }),
      ),
    });
    giftCard.deliveredAt = new Date();
    await giftCard.save();
  } catch (err) {
    // Non-fatal — the code exists and is redeemable regardless of whether the
    // email made it out; admin can resend from the Gift Card Management page.
    console.error(`[giftCard] Failed to email code ${giftCard.code}:`, err.message);
  }
}

// ── Purchase: idempotent fulfillment shared by the dedicated verify ─────────
// endpoint AND the branch inside order.controller.js's Paystack/Stripe
// webhooks (see index.js wiring notes in CHANGES). Safe to call twice for
// the same reference — whichever caller runs first wins.
export async function fulfillGiftCardPurchase({ reference, metadata, provider }) {
  const existing = await GiftCardModel.findOne({ paymentReference: reference });
  if (existing) return existing;

  const code = await generateUniqueCode();
  const amount = parseFloat(metadata.giftCardPurchaseAmount || "0");
  if (!amount || amount <= 0) {
    throw new Error(`Gift card purchase ${reference} has no valid amount in metadata`);
  }

  const giftCard = await GiftCardModel.create({
    code,
    initialAmount: amount,
    balance: amount,
    currency: metadata.currencyCode || "NGN",
    status: "ACTIVE",
    source: "PURCHASED",
    purchasedBy: metadata.userId || null,
    purchaserEmail: metadata.purchaserEmail || "",
    purchaserName: metadata.purchaserName || "",
    paymentProvider: provider,
    paymentReference: reference,
    recipientName: metadata.recipientName || "",
    recipientEmail: metadata.recipientEmail,
    message: metadata.giftMessage || "",
    countryCode: metadata.countryCode || "NG",
  });

  await deliverGiftCardEmail(giftCard, metadata.countryCode || "NG");
  return giftCard;
}

function buildPurchaseMetadata(body, request) {
  const {
    amount,
    recipientName = "",
    recipientEmail,
    senderName = "",
    message = "",
  } = body;

  if (!recipientEmail) throw new Error("Recipient email is required");
  const numAmount = Number(amount);
  if (!numAmount || numAmount < MIN_AMOUNT || numAmount > MAX_AMOUNT) {
    throw new Error(
      `Amount must be between ${MIN_AMOUNT.toLocaleString()} and ${MAX_AMOUNT.toLocaleString()}`,
    );
  }

  return {
    purpose: "GIFT_CARD_PURCHASE",
    giftCardPurchaseAmount: numAmount.toString(),
    recipientName,
    recipientEmail,
    purchaserName: senderName,
    purchaserEmail: body.purchaserEmail || "",
    userId: request.userId ? request.userId.toString() : "",
    giftMessage: message,
    countryCode: request.countryCode || "NG",
    currencyCode: request.country?.currency?.code || "NGN",
  };
}

// ── Purchase: Paystack (NGN only, same gate as regular checkout) ────────────
export const initiatePaystackGiftCardPurchase = async (request, response) => {
  try {
    const initCountry = request.countryCode || "NG";
    if (!isPaymentProviderEnabled(initCountry, "paystack")) {
      const meta = getCountryByCode(initCountry);
      return response.status(400).json({
        message: `Paystack is not available in ${meta?.name || initCountry}. Please use another payment method.`,
        error: true,
        success: false,
      });
    }

    const metadata = buildPurchaseMetadata(request.body, request);
    if (metadata.currencyCode !== "NGN") {
      return response.status(400).json({
        message: "Paystack is only available for NGN currency",
        error: true,
        success: false,
      });
    }
    if (!metadata.purchaserEmail) {
      return response.status(400).json({
        message: "Purchaser email is required",
        error: true,
        success: false,
      });
    }

    const txRef = `GCPSK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const amountInKobo = Math.round(Number(metadata.giftCardPurchaseAmount) * 100);

    const paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: metadata.purchaserEmail,
        amount: amountInKobo,
        reference: txRef,
        currency: "NGN",
        // A DEDICATED callback route (not the regular checkout one) — the
        // gift-card purchase page reads this reference and calls the
        // verify endpoint below, independent of the cart-checkout flow.
        callback_url: `${process.env.FRONTEND_URL}/gift-cards/paystack/callback`,
        metadata,
      }),
    });
    const paystackData = await paystackResponse.json();

    if (!paystackData.status) {
      return response.status(400).json({
        message: paystackData.message || "Failed to initiate gift card payment",
        error: true,
        success: false,
      });
    }

    return response.json({
      success: true,
      error: false,
      data: { authorizationUrl: paystackData.data.authorization_url, reference: txRef },
    });
  } catch (error) {
    return response.status(500).json({ message: error.message, error: true, success: false });
  }
};

// Browser-redirect verify — the primary fulfillment path (mirrors
// verifyPaystackController's role for regular orders); the webhook branch
// in order.controller.js is the backup in case the browser never returns.
export const verifyPaystackGiftCardPurchase = async (request, response) => {
  try {
    const { reference } = request.params;
    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } },
    );
    const verifyData = await verifyRes.json();

    if (!verifyData.status || verifyData.data?.status !== "success") {
      return response.status(400).json({
        message: verifyData.data?.gateway_response || "Payment was not successful",
        error: true,
        success: false,
      });
    }

    const giftCard = await fulfillGiftCardPurchase({
      reference,
      metadata: verifyData.data.metadata,
      provider: "PAYSTACK",
    });

    return response.json({
      success: true,
      error: false,
      data: {
        code: giftCard.code,
        amount: giftCard.initialAmount,
        currency: giftCard.currency,
        recipientEmail: giftCard.recipientEmail,
        deliveredAt: giftCard.deliveredAt,
      },
    });
  } catch (error) {
    return response.status(500).json({ message: error.message, error: true, success: false });
  }
};

// ── Purchase: Stripe (every other market) ────────────────────────────────────
export const initiateStripeGiftCardPurchase = async (request, response) => {
  try {
    const stripeCountry = request.countryCode || "NG";
    if (!isPaymentProviderEnabled(stripeCountry, "stripe")) {
      const meta = getCountryByCode(stripeCountry);
      return response.status(400).json({
        message: `Stripe is not available in ${meta?.name || stripeCountry}.`,
        error: true,
        success: false,
      });
    }

    const metadata = buildPurchaseMetadata(request.body, request);
    if (!metadata.purchaserEmail) {
      return response.status(400).json({
        message: "Purchaser email is required",
        error: true,
        success: false,
      });
    }
    const currency = metadata.currencyCode || "USD";

    const session = await Stripe.checkout.sessions.create({
      submit_type: "pay",
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: metadata.purchaserEmail,
      line_items: [
        {
          price_data: {
            currency: currency.toLowerCase(),
            product_data: {
              name: `Gift Card — ${currency} ${Number(metadata.giftCardPurchaseAmount).toLocaleString()}`,
            },
            unit_amount: Math.round(Number(metadata.giftCardPurchaseAmount) * 100),
          },
          quantity: 1,
        },
      ],
      metadata,
      success_url: `${process.env.FRONTEND_URL}/gift-cards/stripe/callback?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/gift-cards/buy`,
    });

    return response.json({ success: true, error: false, data: { url: session.url } });
  } catch (error) {
    return response.status(500).json({ message: error.message, error: true, success: false });
  }
};

// Polled by the Stripe success page — Stripe's flow (like regular checkout)
// fulfills purely from the webhook, so the browser needs a way to find out
// once that's landed (usually within a second or two).
export const getGiftCardPurchaseStatus = async (request, response) => {
  try {
    const { reference } = request.params;
    const giftCard = await GiftCardModel.findOne({ paymentReference: reference });
    if (!giftCard) {
      return response.json({ success: true, error: false, data: { ready: false } });
    }
    return response.json({
      success: true,
      error: false,
      data: {
        ready: true,
        code: giftCard.code,
        amount: giftCard.initialAmount,
        currency: giftCard.currency,
        recipientEmail: giftCard.recipientEmail,
      },
    });
  } catch (error) {
    return response.status(500).json({ message: error.message, error: true, success: false });
  }
};

// ── Redemption (public, read-only) ───────────────────────────────────────────
// Used by the checkout page to show "applied ₦X, ₦Y remaining to pay" before
// the customer commits to a payment method. Does NOT touch the balance —
// see utils/giftCardCheckout.js for why, and where the actual deduction
// happens (order-creation time, once payment is confirmed).
export const validateGiftCardForCheckoutController = async (request, response) => {
  try {
    const { code, orderAmount } = request.body;
    const currency = request.country?.currency?.code || "NGN";
    const countryCode = request.countryCode || "NG";
    const { giftCard, appliedAmount, remainderToPay } = await resolveGiftCardForCheckout({
      code,
      orderAmount: Number(orderAmount) || 0,
      currency,
      countryCode,
    });
    return response.json({
      success: true,
      error: false,
      data: {
        code: giftCard.code,
        balance: giftCard.balance,
        currency: giftCard.currency,
        appliedAmount,
        remainderToPay,
      },
    });
  } catch (error) {
    return response.status(400).json({ message: error.message, error: true, success: false });
  }
};

// ═══════════════════════════ ADMIN ═══════════════════════════════════════════

export const listGiftCardsAdminController = async (request, response) => {
  try {
    const { status, source, search } = request.query;
    const query = {};
    if (status) query.status = status;
    if (source) query.source = source;
    if (search) {
      query.$or = [
        { code: new RegExp(search, "i") },
        { recipientEmail: new RegExp(search, "i") },
        { purchaserEmail: new RegExp(search, "i") },
      ];
    }
    const data = await GiftCardModel.find(query)
      .populate("purchasedBy", "name email")
      .populate("issuedBy", "name email")
      .sort({ createdAt: -1 })
      .limit(500);
    return response.json({ success: true, error: false, data });
  } catch (error) {
    return response.status(500).json({ message: error.message, error: true, success: false });
  }
};

export const getGiftCardAdminController = async (request, response) => {
  try {
    const data = await GiftCardModel.findById(request.params.id)
      .populate("purchasedBy", "name email")
      .populate("issuedBy", "name email")
      .populate("redemptions.redeemedByUser", "name email");
    if (!data) {
      return response.status(404).json({ message: "Gift card not found", error: true, success: false });
    }
    return response.json({ success: true, error: false, data });
  } catch (error) {
    return response.status(500).json({ message: error.message, error: true, success: false });
  }
};

// Customer-service / promo issuance — no payment attached.
export const issueGiftCardAdminController = async (request, response) => {
  try {
    const {
      amount,
      currency,
      recipientName,
      recipientEmail,
      message,
      expiryDate,
      adminNote,
      countryCode,
      sendEmail: shouldEmail,
    } = request.body;

    if (!amount || Number(amount) <= 0) {
      return response.status(400).json({ message: "Amount is required", error: true, success: false });
    }
    if (!recipientEmail) {
      return response.status(400).json({ message: "Recipient email is required", error: true, success: false });
    }

    const code = await generateUniqueCode();
    const giftCard = await GiftCardModel.create({
      code,
      initialAmount: Number(amount),
      balance: Number(amount),
      currency: currency || "NGN",
      status: "ACTIVE",
      source: "ADMIN_ISSUED",
      issuedBy: request.userId,
      recipientName: recipientName || "",
      recipientEmail,
      message: message || "",
      adminNote: adminNote || "",
      expiryDate: expiryDate || null,
      countryCode: countryCode || request.countryCode || "NG",
    });

    if (shouldEmail !== false) {
      await deliverGiftCardEmail(giftCard, countryCode || request.countryCode || "NG");
    }

    return response.json({
      message: "Gift card issued successfully",
      success: true,
      error: false,
      data: giftCard,
    });
  } catch (error) {
    return response.status(500).json({ message: error.message, error: true, success: false });
  }
};

// Adjust status/expiry/note, or make a manual balance correction (goodwill
// top-up, refund clawback, etc.) — logged as a signed "adjustment" entry in
// the redemption trail so the balance history stays auditable.
export const updateGiftCardAdminController = async (request, response) => {
  try {
    const { id } = request.params;
    const { status, expiryDate, adminNote, balanceAdjustment } = request.body;

    const giftCard = await GiftCardModel.findById(id);
    if (!giftCard) {
      return response.status(404).json({ message: "Gift card not found", error: true, success: false });
    }

    if (status !== undefined) giftCard.status = status;
    if (expiryDate !== undefined) giftCard.expiryDate = expiryDate || null;
    if (adminNote !== undefined) giftCard.adminNote = adminNote;

    if (balanceAdjustment !== undefined && Number(balanceAdjustment) !== 0) {
      const delta = Number(balanceAdjustment);
      giftCard.balance = Math.max(0, giftCard.balance + delta);
      giftCard.redemptions.push({
        orderGroupId: "ADMIN_ADJUSTMENT",
        orderId: "",
        amount: -delta, // negative amount = credit added, matching "amount subtracted from balance" convention
        redeemedByUser: request.userId,
      });
      if (giftCard.balance > 0 && giftCard.status === "REDEEMED") {
        giftCard.status = "ACTIVE";
      }
    }

    await giftCard.save();
    return response.json({
      message: "Gift card updated successfully",
      success: true,
      error: false,
      data: giftCard,
    });
  } catch (error) {
    return response.status(500).json({ message: error.message, error: true, success: false });
  }
};

export const resendGiftCardEmailController = async (request, response) => {
  try {
    const giftCard = await GiftCardModel.findById(request.params.id);
    if (!giftCard) {
      return response.status(404).json({ message: "Gift card not found", error: true, success: false });
    }
    await deliverGiftCardEmail(giftCard, giftCard.countryCode || "NG");
    return response.json({ message: "Email resent", success: true, error: false });
  } catch (error) {
    return response.status(500).json({ message: error.message, error: true, success: false });
  }
};
