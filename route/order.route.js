// route/order.route.js - Website orders WITH GROUPING
import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  paystackWebhookController,
  paystackPaymentController,
  verifyPaystackController,
  webhookStripe,
  DirectBankTransferOrderController,
  getOrderDetailsController,
  stripePaymentController,
  getOrderGroupController,
  cinetpayPaymentController,
  cinetpayWebhookController,
  verifyCinetpayController,
} from '../controllers/order.controller.js';

const orderRouter = Router();

// Webhooks (no auth)
orderRouter.post('/webhook', webhookStripe);
orderRouter.post('/paystack-webhook', paystackWebhookController);
// CinetPay's notify_url carries the country in the PATH, not in its body —
// see cinetpayWebhookController's own comment on why (no signature, no
// storefront host to detect country from, one webhook URL per country
// instead).
orderRouter.post('/cinetpay-webhook/:countryCode', cinetpayWebhookController);

// Called by the browser after Paystack redirects back (checkout always
// requires login first — no true guest flow — so this is the primary path
// that actually creates the order; the webhook above is a backup). No auth
// middleware: trust comes from verifying the reference server-side against
// Paystack's API, not from the request itself.
orderRouter.get('/verify-paystack/:reference', verifyPaystackController);
orderRouter.get('/verify-cinetpay/:reference', verifyCinetpayController);

// Payment initiation (auth required)
orderRouter.post('/paystack-payment', auth, paystackPaymentController);
orderRouter.post('/cinetpay-payment', auth, cinetpayPaymentController);
orderRouter.post(
  '/direct-bank-transfer',
  auth,
  DirectBankTransferOrderController
);
orderRouter.post('/checkout', auth, stripePaymentController);

orderRouter.get('/order-list', auth, getOrderDetailsController);

orderRouter.get('/order-group/:orderGroupId', auth, getOrderGroupController);

export default orderRouter;
