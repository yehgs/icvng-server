import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  CashOnDeliveryOrderController,
  getOrderDetailsController,
  paymentController,
  flutterwavePaymentController,
  webhookStripe,
  flutterwaveWebhookController,
} from '../controllers/order.controller.js';

const orderRouter = Router();

// Cash on delivery order (NGN only)
orderRouter.post('/cash-on-delivery', auth, CashOnDeliveryOrderController);

// Stripe checkout for international currencies
orderRouter.post('/checkout', auth, paymentController);

// Flutterwave payment for NGN
orderRouter.post('/flutterwave-payment', auth, flutterwavePaymentController);

// Webhook endpoints
orderRouter.post('/webhook/stripe', webhookStripe);
orderRouter.post('/webhook/flutterwave', flutterwaveWebhookController);

// Get user orders
orderRouter.get('/order-list', auth, getOrderDetailsController);

export default orderRouter;
