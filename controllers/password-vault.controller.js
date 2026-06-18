//server
// controllers/password-vault.controller.js
import PasswordVaultModel from '../models/password-vault.model.js';

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

    // Check for expiring products (within 60 days)
    const now = new Date();
    const entries60 = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const enriched = entries.map((entry) => ({
      ...entry,
      products: entry.products.map((p) => ({
        ...p,
        status: p.expiryDate
          ? new Date(p.expiryDate) < now
            ? 'expired'
            : new Date(p.expiryDate) < entries60
            ? 'expiring_soon'
            : 'active'
          : 'active',
      })),
    }));

    return res.json({
      success: true,
      data: enriched,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── POST /password-vault ─────────────────────────────────────────────────────
export async function createVaultEntryController(req, res) {
  try {
    if (!checkAccess(req.user, res)) return;
    const entry = await PasswordVaultModel.create({
      ...req.body,
      createdBy: req.user._id,
      lastModifiedBy: req.user._id,
      visibleTo: ['IT', 'DIRECTOR'],
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
      req.params.id,
      { ...req.body, lastModifiedBy: req.user._id },
      { new: true }
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

// ─── POST /password-vault/:id/products ───────────────────────────────────────
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

// ─── PUT /password-vault/:id/products/:productId ─────────────────────────────
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

// ─── DELETE /password-vault/:id/products/:productId ──────────────────────────
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

    const entries = await PasswordVaultModel.find({
      isActive: true,
      'products.expiryDate': { $lte: cutoff, $gt: new Date() },
      'products.reminderEnabled': true,
    }).lean();

    const expiring = [];
    entries.forEach((entry) => {
      entry.products.forEach((p) => {
        if (p.expiryDate && p.reminderEnabled && new Date(p.expiryDate) <= cutoff && new Date(p.expiryDate) > new Date()) {
          expiring.push({ ...p, platformName: entry.platformName, entryId: entry._id });
        }
      });
    });

    return res.json({ success: true, data: expiring });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}
