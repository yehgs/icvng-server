// routes/order.route.js - Updated order routes with Paystack integration
import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  DirectBankTransferOrderController,
  getOrderDetailsController,
  stripePaymentController,
  paystackPaymentController,
  webhookStripe,
  paystackWebhookController,
  getShippingMethodsController,
  getOrdersForShippingController,
  updateOrderTrackingController,
  getShippingAnalyticsController,
} from '../controllers/order.controller.js';

const orderRouter = Router();

// Direct Bank Transfer order (NGN only)
orderRouter.post(
  '/direct-bank-transfer',
  auth,
  DirectBankTransferOrderController
);

// Stripe checkout for international currencies (USD, EUR, GBP)
orderRouter.post('/checkout', auth, stripePaymentController);

// Paystack payment for NGN (replaces Flutterwave)
orderRouter.post('/paystack-payment', auth, paystackPaymentController);

// Webhook endpoints
orderRouter.post('/webhook/stripe', webhookStripe);
orderRouter.post('/webhook/paystack', paystackWebhookController);

// Get user orders
orderRouter.get('/order-list', auth, getOrderDetailsController);

// Shipping related endpoints
orderRouter.post('/shipping-methods', getShippingMethodsController);
orderRouter.get('/shipping/ready', auth, getOrdersForShippingController);
orderRouter.put(
  '/shipping/tracking/:orderId',
  auth,
  updateOrderTrackingController
);
orderRouter.get('/shipping/analytics', auth, getShippingAnalyticsController);

export default orderRouter;
