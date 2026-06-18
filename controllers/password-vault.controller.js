//server
// controllers/password-vault.controller.js  (UPDATED — subscription reminders)
import PasswordVaultModel from '../models/password-vault.model.js';
import { createNotificationInternal } from './notification.controller.js';

const ALLOWED_ROLES = ['IT', 'DIRECTOR'];

function checkAccess(user, res) {
  if (!ALLOWED_ROLES.includes(user.subRole)) {
    res.status(403).json({ success: false, message: 'Access restricted to IT and Director roles' });
    return false;
  }
  return true;
}

// ─── GET /password-vault ──────────────────────────────────────────────────────
export async function getVaultEntriesController(req, res) {
  try {
    if (!checkAccess(req.user, res)) return;
    const { category, search, page = 1, limit = 20 } = req.query;
    const query = { isActive: true };
    if (category) query.category = category;
    if (search) {
      query.$or = [
        { platformName: { $regex: search, $options: 'i' } },
        { accountEmail: { $regex: search, $options: 'i' } },
        { websiteUrl: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } },
      ];
    }

    const total = await PasswordVaultModel.countDocuments(query);
    const entries = await PasswordVaultModel.find(query)
      .sort({ platformName: 1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean();

    const now = new Date();
    const d60 = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

    const enriched = entries.map((entry) => ({
      ...entry,
      products: (entry.products || []).map((p) => ({
        ...p,
        status: p.expiryDate
          ? new Date(p.expiryDate) < now ? 'expired'
          : new Date(p.expiryDate) < d60 ? 'expiring_soon'
          : 'active'
          : 'active',
        daysUntilExpiry: p.expiryDate
          ? Math.ceil((new Date(p.expiryDate) - now) / (1000 * 60 * 60 * 24))
          : null,
      })),
      // Entry-level subscription status
      subscriptionStatus: entry.subscriptionExpiryDate
        ? new Date(entry.subscriptionExpiryDate) < now ? 'expired'
        : new Date(entry.subscriptionExpiryDate) < d60 ? 'expiring_soon'
        : 'active'
        : null,
    }));

    return res.json({ success: true, data: enriched, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── POST /password-vault ─────────────────────────────────────────────────────
export async function createVaultEntryController(req, res) {
  try {
    if (!checkAccess(req.user, res)) return;
    const entry = await PasswordVaultModel.create({
      ...req.body, createdBy: req.user._id, lastModifiedBy: req.user._id, visibleTo: ['IT', 'DIRECTOR'],
    });
    return res.status(201).json({ success: true, message: 'Entry created', data: entry });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── PUT /password-vault/:id ──────────────────────────────────────────────────
export async function updateVaultEntryController(req, res) {
  try {
    if (!checkAccess(req.user, res)) return;
    const entry = await PasswordVaultModel.findByIdAndUpdate(
      req.params.id, { ...req.body, lastModifiedBy: req.user._id }, { new: true }
    );
    if (!entry) return res.status(404).json({ success: false, message: 'Entry not found' });
    return res.json({ success: true, message: 'Entry updated', data: entry });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── DELETE /password-vault/:id ───────────────────────────────────────────────
export async function deleteVaultEntryController(req, res) {
  try {
    if (!checkAccess(req.user, res)) return;
    await PasswordVaultModel.findByIdAndUpdate(req.params.id, { isActive: false });
    return res.json({ success: true, message: 'Entry removed' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Product CRUD ─────────────────────────────────────────────────────────────
export async function addProductController(req, res) {
  try {
    if (!checkAccess(req.user, res)) return;
    const entry = await PasswordVaultModel.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Entry not found' });
    entry.products.push(req.body);
    entry.lastModifiedBy = req.user._id;
    await entry.save();
    return res.json({ success: true, message: 'Product added', data: entry });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function updateProductController(req, res) {
  try {
    if (!checkAccess(req.user, res)) return;
    const entry = await PasswordVaultModel.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Entry not found' });
    const product = entry.products.id(req.params.productId);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    Object.assign(product, req.body);
    entry.lastModifiedBy = req.user._id;
    await entry.save();
    return res.json({ success: true, message: 'Product updated', data: entry });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function deleteProductController(req, res) {
  try {
    if (!checkAccess(req.user, res)) return;
    const entry = await PasswordVaultModel.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Entry not found' });
    entry.products.pull({ _id: req.params.productId });
    entry.lastModifiedBy = req.user._id;
    await entry.save();
    return res.json({ success: true, message: 'Product removed', data: entry });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── GET /password-vault/expiring ─────────────────────────────────────────────
export async function getExpiringProductsController(req, res) {
  try {
    if (!checkAccess(req.user, res)) return;
    const days = parseInt(req.query.days) || 30;
    const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const now = new Date();

    const entries = await PasswordVaultModel.find({
      isActive: true,
      $or: [
        { 'products.expiryDate': { $lte: cutoff }, 'products.reminderEnabled': true },
        { subscriptionExpiryDate: { $lte: cutoff }, subscriptionReminderEnabled: true },
      ],
    }).lean();

    const expiring = [];
    entries.forEach((entry) => {
      // Check entry-level subscription
      if (
        entry.subscriptionExpiryDate &&
        entry.subscriptionReminderEnabled &&
        new Date(entry.subscriptionExpiryDate) <= cutoff
      ) {
        expiring.push({
          type: 'subscription',
          platformName: entry.platformName,
          entryId: entry._id,
          expiryDate: entry.subscriptionExpiryDate,
          daysLeft: Math.ceil((new Date(entry.subscriptionExpiryDate) - now) / (1000 * 60 * 60 * 24)),
          isExpired: new Date(entry.subscriptionExpiryDate) < now,
        });
      }
      // Check products
      (entry.products || []).forEach((p) => {
        if (p.expiryDate && p.reminderEnabled && new Date(p.expiryDate) <= cutoff) {
          expiring.push({
            type: 'product',
            name: p.name,
            platformName: entry.platformName,
            entryId: entry._id,
            productId: p._id,
            expiryDate: p.expiryDate,
            daysLeft: Math.ceil((new Date(p.expiryDate) - now) / (1000 * 60 * 60 * 24)),
            isExpired: new Date(p.expiryDate) < now,
          });
        }
      });
    });

    return res.json({ success: true, data: expiring });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── POST /password-vault/send-reminders — manually trigger reminder notifications
export async function sendExpiryRemindersController(req, res) {
  try {
    if (!checkAccess(req.user, res)) return;
    const days = parseInt(req.query.days) || 30;
    const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const now = new Date();

    const entries = await PasswordVaultModel.find({ isActive: true }).lean();

    let notificationCount = 0;

    for (const entry of entries) {
      // Entry-level subscription check
      if (entry.subscriptionExpiryDate && entry.subscriptionReminderEnabled) {
        const expDate = new Date(entry.subscriptionExpiryDate);
        const daysLeft = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));
        if (expDate <= cutoff) {
          const isExpired = expDate < now;
          await createNotificationInternal({
            triggeredByName: 'System',
            type: 'SYSTEM',
            title: isExpired
              ? `⚠️ Subscription Expired: ${entry.platformName}`
              : `🔔 Subscription Expiring: ${entry.platformName}`,
            message: isExpired
              ? `Your ${entry.platformName} subscription has expired. Please renew immediately.`
              : `${entry.platformName} subscription expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} (${new Date(entry.subscriptionExpiryDate).toLocaleDateString()}).`,
            link: '/admin/dashboard/password-vault',
            resourceId: entry._id.toString(),
            resourceType: 'PasswordVault',
            targetType: 'role',
            targetRoles: ['IT', 'DIRECTOR'],
            priority: daysLeft <= 7 ? 'urgent' : daysLeft <= 14 ? 'high' : 'medium',
            sendEmailFlag: true,
          });
          notificationCount++;
        }
      }

      // Product-level checks
      for (const p of (entry.products || [])) {
        if (p.expiryDate && p.reminderEnabled) {
          const expDate = new Date(p.expiryDate);
          const daysLeft = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));
          if (expDate <= cutoff) {
            const isExpired = expDate < now;
            await createNotificationInternal({
              triggeredByName: 'System',
              type: 'SYSTEM',
              title: isExpired
                ? `⚠️ Service Expired: ${p.name} (${entry.platformName})`
                : `🔔 Service Expiring: ${p.name} (${entry.platformName})`,
              message: isExpired
                ? `${p.name} on ${entry.platformName} has expired. Please renew.`
                : `${p.name} on ${entry.platformName} expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} (${new Date(p.expiryDate).toLocaleDateString()}).`,
              link: '/admin/dashboard/password-vault',
              resourceId: entry._id.toString(),
              resourceType: 'PasswordVault',
              targetType: 'role',
              targetRoles: ['IT', 'DIRECTOR'],
              priority: daysLeft <= 7 ? 'urgent' : daysLeft <= 14 ? 'high' : 'medium',
              sendEmailFlag: true,
            });
            notificationCount++;
          }
        }
      }
    }

    return res.json({ success: true, message: `${notificationCount} reminder notification${notificationCount !== 1 ? 's' : ''} sent` });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}
