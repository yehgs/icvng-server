// routes/order.route.js - Complete order routes with Paystack
import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  DirectBankTransferOrderController,
  getOrderDetailsController,
  stripePaymentController,
  paystackPaymentController,
  webhookStripe,
  paystackWebhookController,
  verifyPaystackPaymentController,
  getShippingMethodsController,
  getOrdersForShippingController,
  updateOrderTrackingController,
  getShippingAnalyticsController,
} from '../controllers/order.controller.js';

const orderRouter = Router();

// ===== PAYMENT ENDPOINTS =====

// Direct Bank Transfer order (NGN only)
orderRouter.post(
  '/direct-bank-transfer',
  auth,
  DirectBankTransferOrderController
);

// Stripe checkout for international currencies (USD, EUR, GBP)
orderRouter.post('/checkout', auth, stripePaymentController);

// Paystack payment for NGN
orderRouter.post('/paystack-payment', auth, paystackPaymentController);

// Paystack payment verification (callback endpoint)
orderRouter.get('/verify-paystack/:reference', verifyPaystackPaymentController);

// ===== WEBHOOK ENDPOINTS (NO AUTH!) =====
orderRouter.post('/webhook/stripe', webhookStripe);
orderRouter.post('/webhook/paystack', paystackWebhookController);

// ===== ORDER MANAGEMENT =====
orderRouter.get('/order-list', auth, getOrderDetailsController);

// ===== SHIPPING ENDPOINTS =====
orderRouter.post('/shipping-methods', getShippingMethodsController);
orderRouter.get('/shipping/ready', auth, getOrdersForShippingController);
orderRouter.put(
  '/shipping/tracking/:orderId',
  auth,
  updateOrderTrackingController
);
orderRouter.get('/shipping/analytics', auth, getShippingAnalyticsController);

export default orderRouter;
