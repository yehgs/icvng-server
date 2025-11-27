import stripe from 'stripe';

const Stripe = stripe(process.env.STRIPE_SECRET_KEY);

export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

export default Stripe;
