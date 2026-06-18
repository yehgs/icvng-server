//server
// models/password-vault.model.js  (UPDATED — adds entry-level subscription fields)
import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    type: { type: String, enum: ['hosting', 'domain', 'ssl', 'email', 'other'], default: 'other' },
    username: { type: String, default: '' },
    password: { type: String, default: '' },
    purchaseDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null },
    renewalCost: { type: Number, default: null },
    autoRenew: { type: Boolean, default: false },
    reminderEnabled: { type: Boolean, default: false },
    reminderDaysBefore: { type: Number, default: 30 },
    notes: { type: String, default: '' },
    status: { type: String, enum: ['active', 'expired', 'expiring_soon'], default: 'active' },
  },
  { timestamps: true }
);

const passwordVaultSchema = new mongoose.Schema(
  {
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    category: {
      type: String,
      enum: ['Domain & Hosting', 'Email Account', 'Social Media', 'E-commerce Platform',
        'Payment Gateway', 'Cloud Service', 'Software License', 'Database', 'API Key', 'Subscription', 'Other'],
      default: 'Other',
    },
    platformName: { type: String, required: true },
    websiteUrl: { type: String, default: '' },
    accountEmail: { type: String, default: '' },
    accountUsername: { type: String, default: '' },
    password: { type: String, default: '' },
    twoFactorSecret: { type: String, default: '' },
    notes: { type: String, default: '' },
    visibleTo: [{ type: String }],

    // ── Subscription fields (entry-level) ──────────────────────────────────
    isSubscription: { type: Boolean, default: false },
    subscriptionPlan: { type: String, default: '' },       // e.g. "Pro Monthly"
    subscriptionCost: { type: Number, default: null },
    subscriptionCurrency: { type: String, default: 'USD' },
    subscriptionPeriod: {
      type: String,
      enum: ['monthly', 'quarterly', 'biannual', 'yearly', 'lifetime', null],
      default: null,
    },
    subscriptionStartDate: { type: Date, default: null },
    subscriptionExpiryDate: { type: Date, default: null },
    subscriptionAutoRenew: { type: Boolean, default: false },
    subscriptionReminderEnabled: { type: Boolean, default: false },
    subscriptionReminderDaysBefore: { type: Number, default: 30 },
    lastReminderSentAt: { type: Date, default: null },
    // ────────────────────────────────────────────────────────────────────────

    products: [productSchema],
    tags: [{ type: String }],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// ─── route/password-vault.route.js  (UPDATED) ────────────────────────────────
// Appended below as a comment for convenience — use as a separate file

const PasswordVaultModel = mongoose.model('PasswordVault', passwordVaultSchema);
export default PasswordVaultModel;

/*
ROUTE FILE: route/password-vault.route.js

import { Router } from 'express';
import auth from '../middleware/auth.js';
import adminAuth from '../middleware/adminAuth.js';
import {
  getVaultEntriesController, createVaultEntryController, updateVaultEntryController,
  deleteVaultEntryController, addProductController, updateProductController,
  deleteProductController, getExpiringProductsController, sendExpiryRemindersController,
} from '../controllers/password-vault.controller.js';

const passwordVaultRouter = Router();
passwordVaultRouter.use(auth);
passwordVaultRouter.use(adminAuth);

passwordVaultRouter.get('/expiring', getExpiringProductsController);
passwordVaultRouter.post('/send-reminders', sendExpiryRemindersController);
passwordVaultRouter.get('/', getVaultEntriesController);
passwordVaultRouter.post('/', createVaultEntryController);
passwordVaultRouter.put('/:id', updateVaultEntryController);
passwordVaultRouter.delete('/:id', deleteVaultEntryController);
passwordVaultRouter.post('/:id/products', addProductController);
passwordVaultRouter.put('/:id/products/:productId', updateProductController);
passwordVaultRouter.delete('/:id/products/:productId', deleteProductController);

export default passwordVaultRouter;
*/
