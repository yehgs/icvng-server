// route/order.route.js - Website orders WITH GROUPING
import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  paystackWebhookController,
  paystackPaymentController,
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
