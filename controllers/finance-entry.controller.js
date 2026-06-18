//server
import FinanceEntryModel, {
  INCOME_CATEGORIES,
  EXPENSE_CATEGORIES,
  CURRENCIES,
  PAYMENT_METHODS,
} from '../models/finance-entry.model.js';
import ExchangeRateModel from '../models/exchange-rate.model.js';
import uploadImageCloudinary from '../utils/uploadImageCloudinary.js';

function directorOnly(user, res) {
  if (user?.subRole !== 'DIRECTOR') {
    res.status(403).json({ success: false, message: 'Director access only' });
    return false;
  }
  return true;
}

// ─── GET /finance/meta — categories, currencies, payment methods ─────────────
export async function getFinanceMetaController(req, res) {
  try {
    if (!directorOnly(req.user, res)) return;
    return res.json({
      success: true,
      data: { INCOME_CATEGORIES, EXPENSE_CATEGORIES, CURRENCIES, PAYMENT_METHODS },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── GET /finance/exchange-rate/:currency ────────────────────────────────────
export async function getLiveExchangeRateController(req, res) {
  try {
    if (!directorOnly(req.user, res)) return;
    const { currency } = req.params;
    if (currency === 'NGN') return res.json({ success: true, rate: 1 });

    const rate = await ExchangeRateModel.findOne({
      baseCurrency: 'NGN',
      targetCurrency: currency.toUpperCase(),
      isActive: true,
    }).sort({ lastUpdated: -1 });

    // Try reversed pair
    const rateAlt = await ExchangeRateModel.findOne({
      baseCurrency: currency.toUpperCase(),
      targetCurrency: 'NGN',
      isActive: true,
    }).sort({ lastUpdated: -1 });

    let rateValue = null;
    if (rate) rateValue = 1 / rate.rate;
    else if (rateAlt) rateValue = rateAlt.rate;

    return res.json({ success: true, rate: rateValue, found: !!rateValue });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── GET /finance ─────────────────────────────────────────────────────────────
export async function getEntriesController(req, res) {
  try {
    if (!directorOnly(req.user, res)) return;
    const {
      type, category, currency, paymentMethod,
      startDate, endDate, search, page = 1, limit = 50,
    } = req.query;

    const query = { isArchived: false };
    if (type) query.type = type;
    if (category) query.category = category;
    if (currency) query.currency = currency;
    if (paymentMethod) query.paymentMethod = paymentMethod;
    if (startDate || endDate) {
      query.transactionDate = {};
      if (startDate) query.transactionDate.$gte = new Date(startDate);
      if (endDate) query.transactionDate.$lte = new Date(new Date(endDate).setHours(23, 59, 59));
    }
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { referenceNumber: { $regex: search, $options: 'i' } },
      ];
    }

    const total = await FinanceEntryModel.countDocuments(query);
    const entries = await FinanceEntryModel.find(query)
      .sort({ transactionDate: -1, createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean();

    // Aggregated totals in NGN
    const [totals] = await FinanceEntryModel.aggregate([
      { $match: { isArchived: false } },
      {
        $group: {
          _id: '$type',
          totalNGN: { $sum: '$amountInNGN' },
          count: { $sum: 1 },
        },
      },
    ]);

    const aggResult = await FinanceEntryModel.aggregate([
      { $match: { isArchived: false } },
      { $group: { _id: '$type', totalNGN: { $sum: '$amountInNGN' }, count: { $sum: 1 } } },
    ]);

    const summary = { income: { totalNGN: 0, count: 0 }, expense: { totalNGN: 0, count: 0 } };
    aggResult.forEach((r) => { summary[r._id] = { totalNGN: r.totalNGN, count: r.count }; });
    summary.netNGN = summary.income.totalNGN - summary.expense.totalNGN;

    // Monthly breakdown (last 12 months)
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
    twelveMonthsAgo.setDate(1);
    twelveMonthsAgo.setHours(0, 0, 0, 0);

    const monthly = await FinanceEntryModel.aggregate([
      { $match: { isArchived: false, transactionDate: { $gte: twelveMonthsAgo } } },
      {
        $group: {
          _id: {
            year: { $year: '$transactionDate' },
            month: { $month: '$transactionDate' },
            type: '$type',
          },
          total: { $sum: '$amountInNGN' },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    // Category breakdown
    const categoryBreakdown = await FinanceEntryModel.aggregate([
      { $match: { isArchived: false } },
      { $group: { _id: { type: '$type', category: '$category' }, total: { $sum: '$amountInNGN' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]);

    return res.json({
      success: true,
      data: entries,
      summary,
      monthly,
      categoryBreakdown,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── POST /finance ────────────────────────────────────────────────────────────
export async function createEntryController(req, res) {
  try {
    if (!directorOnly(req.user, res)) return;
    const entry = await FinanceEntryModel.create({ ...req.body, createdBy: req.user._id });
    return res.status(201).json({ success: true, message: 'Entry created', data: entry });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── PUT /finance/:id ─────────────────────────────────────────────────────────
export async function updateEntryController(req, res) {
  try {
    if (!directorOnly(req.user, res)) return;
    const entry = await FinanceEntryModel.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!entry) return res.status(404).json({ success: false, message: 'Not found' });
    return res.json({ success: true, message: 'Entry updated', data: entry });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── DELETE /finance/:id ──────────────────────────────────────────────────────
export async function deleteEntryController(req, res) {
  try {
    if (!directorOnly(req.user, res)) return;
    await FinanceEntryModel.findByIdAndUpdate(req.params.id, { isArchived: true });
    return res.json({ success: true, message: 'Entry removed' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── POST /finance/:id/attachment — upload image/file ────────────────────────
export async function addAttachmentController(req, res) {
  try {
    if (!directorOnly(req.user, res)) return;
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, message: 'No file provided' });

    const upload = await uploadImageCloudinary(file);
    const entry = await FinanceEntryModel.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Entry not found' });

    const isImage = file.mimetype.startsWith('image/');
    entry.attachments.push({
      url: upload.secure_url,
      public_id: upload.public_id,
      name: file.originalname,
      type: isImage ? 'image' : file.mimetype === 'application/pdf' ? 'pdf' : 'other',
    });
    await entry.save();

    return res.json({ success: true, message: 'Attachment added', data: entry });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── DELETE /finance/:id/attachment/:pubId ────────────────────────────────────
export async function removeAttachmentController(req, res) {
  try {
    if (!directorOnly(req.user, res)) return;
    const entry = await FinanceEntryModel.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Entry not found' });
    entry.attachments = entry.attachments.filter(
      (a) => a.public_id !== decodeURIComponent(req.params.pubId)
    );
    await entry.save();
    return res.json({ success: true, message: 'Attachment removed', data: entry });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}
