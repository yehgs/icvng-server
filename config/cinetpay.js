// config/cinetpay.js
//
// Thin adapter over CinetPay's Checkout API v2 (docs.cinetpay.com). Two
// calls only — this app uses the hosted-checkout-page flow (payment_url),
// the same shape as Paystack's authorization_url, not CinetPay's embedded
// "Seamless" JS widget.
//
//   initiateCinetPayPayment()  → POST /v2/payment        (get payment_url)
//   verifyCinetPayTransaction() → POST /v2/payment/check  (confirm status)
//
// CRITICAL — CinetPay's notify_url webhook is NOT signed. Its body only
// carries cpm_trans_id; CinetPay's own docs are explicit that a merchant
// MUST call the check endpoint server-to-server before trusting a
// notification, never act on the webhook payload directly. Every call site
// in this app (cinetpayWebhookController, verifyCinetpayController) follows
// that — see order.controller.js.
//
// Test credentials/mode: CinetPay merchant accounts have a TEST mode
// toggle in their dashboard tied to the same apikey/site_id (unlike
// Stripe/Paystack's separate test-key pairs) — this adapter has no
// TEST/PRODUCTION branching of its own; models/paymentGateway.model.js's
// `mode` field is informational for the admin UI only, so a country
// manager remembers to test against CinetPay's sandbox before flipping
// isActive on for real shoppers.

const CINETPAY_INIT_URL = "https://api-checkout.cinetpay.com/v2/payment";
const CINETPAY_CHECK_URL = "https://api-checkout.cinetpay.com/v2/payment/check";

/**
 * @param {object} params
 * @param {string} params.apiKey
 * @param {string} params.siteId
 * @param {string} params.transactionId  our own reference, e.g. "CTP-..."
 * @param {number} params.amount         CinetPay requires XOF amounts to be
 *   a multiple of 5 — round upstream before calling this.
 * @param {string} params.currency       "XOF" for Togo/Benin
 * @param {string} params.description
 * @param {string} params.notifyUrl      per-country webhook URL (see
 *   route/order.route.js — includes :countryCode in the path since
 *   CinetPay's payload can't tell us which country's keys to verify with)
 * @param {string} params.returnUrl
 * @param {object} [params.customer]     { name, surname, email, phone }
 * @returns {Promise<{ paymentUrl: string, paymentToken: string }>}
 * @throws on any non-success response — caller decides how to surface it.
 */
export async function initiateCinetPayPayment({
  apiKey,
  siteId,
  transactionId,
  amount,
  currency,
  description,
  notifyUrl,
  returnUrl,
  customer = {},
}) {
  const body = {
    apikey: apiKey,
    site_id: siteId,
    transaction_id: transactionId,
    amount,
    currency,
    description,
    notify_url: notifyUrl,
    return_url: returnUrl,
    channels: "ALL",
    customer_name: customer.name || "Customer",
    customer_surname: customer.surname || "",
    customer_email: customer.email || "",
    customer_phone_number: customer.phone || "",
  };

  const res = await fetch(CINETPAY_INIT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();

  if (data.code !== "201" || !data.data?.payment_url) {
    throw new Error(
      data.description || data.message || "CinetPay could not create a payment link",
    );
  }

  return { paymentUrl: data.data.payment_url, paymentToken: data.data.payment_token };
}

/**
 * Server-to-server confirmation — the ONLY source of truth for whether a
 * CinetPay transaction actually succeeded. Never trust the webhook body's
 * own status field.
 *
 * @param {object} params
 * @param {string} params.apiKey
 * @param {string} params.siteId
 * @param {string} params.transactionId
 * @returns {Promise<{ accepted: boolean, amount: number, currency: string, raw: object }>}
 */
export async function verifyCinetPayTransaction({ apiKey, siteId, transactionId }) {
  const res = await fetch(CINETPAY_CHECK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: apiKey, site_id: siteId, transaction_id: transactionId }),
  });
  const data = await res.json();

  const status = data?.data?.status;
  return {
    accepted: data.code === "00" && status === "ACCEPTED",
    amount: data?.data?.amount ? Number(data.data.amount) : undefined,
    currency: data?.data?.currency,
    raw: data,
  };
}

/**
 * CinetPay requires XOF amounts to be a multiple of 5 (undocumented in the
 * quickstart but enforced by the API — an off-multiple amount is rejected
 * at initiation). Applied only for zero-decimal currencies; harmless
 * no-op otherwise.
 */
export function roundForCinetPay(amount, currency) {
  if (currency !== "XOF") return amount;
  return Math.ceil(amount / 5) * 5;
}
