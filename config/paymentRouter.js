/**
 * config/paymentRouter.js
 *
 * Central payment-provider resolver.
 *
 * Usage in a controller:
 *
 *   import { getPaymentConfig } from '../config/paymentRouter.js';
 *
 *   const paymentConfig = getPaymentConfig(req.countryCode);
 *   if (paymentConfig.stripe) { ... }
 *   if (paymentConfig.paystack) { ... }
 */

import Stripe from "stripe";
import { getCountryByCode, isPaymentProviderEnabled } from "./countries/index.js";

// ── Stripe instances (one per Stripe key — usually shared across countries) ──
// We lazy-init so the module can load even if keys are absent in dev.
let _stripeInstance = null;

export function getStripeInstance() {
  if (!_stripeInstance) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not set");
    }
    _stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-04-10",
    });
  }
  return _stripeInstance;
}

/**
 * Returns a payment config object for the given country code.
 *
 * @param {string} countryCode  e.g. "NG" | "IT" | "TG" | "BJ"
 * @returns {{
 *   countryCode: string,
 *   currency: string,
 *   stripe: boolean,
 *   stripeInstance: import('stripe').Stripe | null,
 *   paystack: boolean,
 *   paystackPublicKey: string | null,
 *   paystackSecretKey: string | null,
 *   availableProviders: string[],
 * }}
 */
export function getPaymentConfig(countryCode = "NG") {
  const country = getCountryByCode(countryCode);
  if (!country) {
    throw new Error(`Unknown country code: ${countryCode}`);
  }

  const stripeEnabled = isPaymentProviderEnabled(countryCode, "stripe");
  const paystackEnabled = isPaymentProviderEnabled(countryCode, "paystack");

  return {
    countryCode,
    currency: country.currency.code,
    // Stripe
    stripe: stripeEnabled,
    stripeInstance: stripeEnabled ? getStripeInstance() : null,
    stripePublicKey: stripeEnabled
      ? process.env.STRIPE_PUBLISHABLE_KEY || null
      : null,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || null,
    // Paystack
    paystack: paystackEnabled,
    paystackPublicKey: paystackEnabled
      ? process.env.PAYSTACK_PUBLIC_KEY || null
      : null,
    paystackSecretKey: paystackEnabled
      ? process.env.PAYSTACK_SECRET_KEY || null
      : null,
    // Helpers
    availableProviders: [
      ...(stripeEnabled ? ["stripe"] : []),
      ...(paystackEnabled ? ["paystack"] : []),
    ],
  };
}

/**
 * Express middleware that attaches payment config to req.
 *
 *   req.paymentConfig  → result of getPaymentConfig(req.countryCode)
 *
 * Mount AFTER countryDetect.
 */
export function paymentConfigMiddleware(req, res, next) {
  try {
    req.paymentConfig = getPaymentConfig(req.countryCode || "NG");
  } catch (err) {
    console.error("paymentConfigMiddleware error:", err.message);
    // Don't block the request — individual route handlers will validate
    req.paymentConfig = null;
  }
  next();
}

/**
 * Returns the public-safe payment info the client needs at checkout.
 * Call from a /api/payment/config endpoint.
 *
 * @param {string} countryCode
 */
export function getPublicPaymentInfo(countryCode = "NG") {
  const config = getPaymentConfig(countryCode);
  return {
    availableProviders: config.availableProviders,
    currency: config.currency,
    stripePublicKey: config.stripePublicKey,
    paystackPublicKey: config.paystackPublicKey,
  };
}
