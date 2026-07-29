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
} from '../controllers/order.controller.js';

const orderRouter = Router();

// Webhooks (no auth)
orderRouter.post('/webhook', webhookStripe);
orderRouter.post('/paystack-webhook', paystackWebhookController);

// Called by the browser after Paystack redirects back (checkout always
// requires login first — no true guest flow — so this is the primary path
// that actually creates the order; the webhook above is a backup). No auth
// middleware: trust comes from verifying the reference server-side against
// Paystack's API, not from the request itself.
orderRouter.get('/verify-paystack/:reference', verifyPaystackController);

// Payment initiation (auth required)
orderRouter.post('/paystack-payment', auth, paystackPaymentController);
orderRouter.post(
  '/direct-bank-transfer',
  auth,
  DirectBankTransferOrderController
);
orderRouter.post('/checkout', auth, stripePaymentController);

orderRouter.get('/order-list', auth, getOrderDetailsController);

orderRouter.get('/order-group/:orderGroupId', auth, getOrderGroupController);

export default orderRouter;
