// server/controllers/fomo.controller.js
import FomoModel from '../models/fomo.model.js';
import OrderModel from '../models/order.model.js';
import ProductModel from '../models/product.model.js';

// ── Helpers ──────────────────────────────────────────────────────────────────
//
// FOMO settings/dummy-users are per-country content (countryScopedPlugin on
// FomoModel), but WHO the "target country" is depends on who's asking:
//   - A COUNTRY-scoped admin (e.g. an editor tagged to Togo) is always
//     locked to their own assignedCountry — never trust a client-supplied
//     countryCode for them.
//   - A GLOBAL/HQ admin has no implicit scope, so the admin UI must tell us
//     which market's settings to load/edit via ?countryCode= (or
//     body.countryCode for writes).
//   - A public storefront request has no admin scope at all — the target is
//     whichever country the visited domain resolved to (req.country).
function resolveTargetCountry(req) {
  if (req.countryScope) return req.countryScope; // COUNTRY-scoped admin — always their own market
  const explicit = req.query?.countryCode || req.body?.countryCode;
  if (explicit) return String(explicit).toUpperCase(); // GLOBAL admin picking a market in the UI
  if (req.country?.code) return req.country.code; // public storefront request
  return 'NG';
}

const getOrCreateSettings = async (countryCode) => {
  let settings = await FomoModel.findOne({ countryCode });
  if (!settings) settings = await FomoModel.create({ countryCode });
  return settings;
};

// Human-readable "time ago" — caps out at 11 months (never says "1 year ago")
export const timeAgoString = (date) => {
  const diffMs = Date.now() - new Date(date).getTime();
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours   = Math.floor(minutes / 60);
  const days    = Math.floor(hours / 24);
  const months  = Math.floor(days / 30);

  if (seconds < 60)  return seconds <= 1 ? '1 sec ago' : `${seconds} sec${seconds === 1 ? '' : 's'} ago`;
  if (minutes < 60)  return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  if (hours < 24)    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  if (days < 30)     return `${days} day${days === 1 ? '' : 's'} ago`;

  const cappedMonths = Math.min(months, 11);
  return `${cappedMonths} month${cappedMonths === 1 ? '' : 's'} ago`;
};

// ── GET settings ───────────────────────────────────────────────────────────
// Public (storefront widget config) AND admin (loads the editor) share this
// handler — the only difference is how resolveTargetCountry() picks the
// market. Public reads that come up empty fall back to HQ (Nigeria) so a
// market without its own FOMO setup still shows something sensible instead
// of nothing.
export const getFomoSettings = async (req, res) => {
  try {
    const isAdminRequest = !!req.user;
    const targetCountry = resolveTargetCountry(req);

    if (!isAdminRequest) {
      let settings = await FomoModel.findOne({ countryCode: targetCountry, enabled: true });
      if (!settings && targetCountry !== 'NG') {
        settings = await FomoModel.findOne({ countryCode: 'NG', enabled: true });
      }
      if (!settings) settings = await getOrCreateSettings(targetCountry);
      return res.json({ success: true, data: settings });
    }

    const settings = await getOrCreateSettings(targetCountry);
    return res.json({ success: true, data: settings });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── UPDATE settings (admin only) ─────────────────────────────────────────────
export const updateFomoSettings = async (req, res) => {
  try {
    const {
      enabled, animationType, position,
      displayDurationMs, pauseBetweenMs, fadeInMs, fadeOutMs,
      useDummyUsers, maxRealPurchases, notificationMessage,
    } = req.body;

    const settings = await getOrCreateSettings(resolveTargetCountry(req));

    if (enabled !== undefined)           settings.enabled            = enabled;
    if (animationType !== undefined)     settings.animationType      = animationType;
    if (position !== undefined)          settings.position           = position;
    if (displayDurationMs !== undefined) settings.displayDurationMs  = Number(displayDurationMs);
    if (pauseBetweenMs !== undefined)    settings.pauseBetweenMs     = Number(pauseBetweenMs);
    if (fadeInMs !== undefined)          settings.fadeInMs           = Number(fadeInMs);
    if (fadeOutMs !== undefined)         settings.fadeOutMs          = Number(fadeOutMs);
    if (useDummyUsers !== undefined)     settings.useDummyUsers      = useDummyUsers;
    if (maxRealPurchases !== undefined)  settings.maxRealPurchases   = Number(maxRealPurchases);
    if (notificationMessage !== undefined) settings.notificationMessage = notificationMessage;

    settings.updatedBy = req.user?._id;
    await settings.save();

    return res.json({ success: true, data: settings, message: 'FOMO settings updated' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── DUMMY USER CRUD ───────────────────────────────────────────────────────────
export const addDummyUser = async (req, res) => {
  try {
    const { name, avatar, state, product, quantity, purchasedAt } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, message: 'Name required' });

    const settings = await getOrCreateSettings(resolveTargetCountry(req));

    // Resolve product details (name, image, price) from the selected product
    let productName  = '';
    let productImage = '';
    let price        = 0;

    if (product) {
      const prod = await ProductModel.findById(product).select('name image btcPrice price').lean();
      if (prod) {
        productName  = prod.name || '';
        productImage = prod.image?.[0] || '';
        price        = (prod.btcPrice > 0 ? prod.btcPrice : prod.price) || 0;
      }
    }

    settings.dummyUsers.push({
      name: name.trim(),
      avatar: avatar || '',
      state: state || 'Lagos',
      product: product || undefined,
      productName,
      productImage,
      price,
      quantity: Number(quantity) > 0 ? Number(quantity) : 1,
      purchasedAt: purchasedAt ? new Date(purchasedAt) : new Date(),
    });
    await settings.save();

    return res.json({ success: true, data: settings.dummyUsers, message: 'Dummy user added' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const updateDummyUser = async (req, res) => {
  try {
    const { userId, name, avatar, state, isActive, product, quantity, purchasedAt } = req.body;
    const settings = await getOrCreateSettings(resolveTargetCountry(req));
    const user = settings.dummyUsers.id(userId);
    if (!user) return res.status(404).json({ success: false, message: 'Dummy user not found' });

    if (name  !== undefined) user.name     = name.trim();
    if (avatar!== undefined) user.avatar   = avatar;
    if (state !== undefined) user.state    = state;
    if (isActive !== undefined) user.isActive = isActive;
    if (quantity !== undefined) user.quantity = Number(quantity) > 0 ? Number(quantity) : 1;
    if (purchasedAt !== undefined) user.purchasedAt = purchasedAt ? new Date(purchasedAt) : new Date();

    // Re-resolve product details if a new product was selected
    if (product !== undefined) {
      if (product) {
        const prod = await ProductModel.findById(product).select('name image btcPrice price').lean();
        if (prod) {
          user.product      = product;
          user.productName  = prod.name || '';
          user.productImage = prod.image?.[0] || '';
          user.price        = (prod.btcPrice > 0 ? prod.btcPrice : prod.price) || 0;
        }
      } else {
        user.product      = undefined;
        user.productName  = '';
        user.productImage = '';
        user.price        = 0;
      }
    }

    await settings.save();
    return res.json({ success: true, data: settings.dummyUsers, message: 'Dummy user updated' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteDummyUser = async (req, res) => {
  try {
    const { userId } = req.body;
    const settings = await getOrCreateSettings(resolveTargetCountry(req));
    settings.dummyUsers.pull({ _id: userId });
    await settings.save();
    return res.json({ success: true, data: settings.dummyUsers, message: 'Dummy user removed' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUBLIC: get recent purchases for FOMO widget ─────────────────────────────
export const getRecentPurchases = async (req, res) => {
  try {
    const targetCountry = resolveTargetCountry(req);
    const settings = await getOrCreateSettings(targetCountry);

    if (!settings.enabled) {
      return res.json({ success: true, data: [], settings: { enabled: false } });
    }

    // Pull recent paid orders FOR THIS COUNTRY ONLY — showing e.g. a Lagos
    // customer's real purchase on the Togo storefront would be misleading,
    // not just wrong-language, so (unlike banners/sliders) there's no
    // cross-country fallback here: an unconfigured market simply shows
    // fewer/no toasts until it has its own orders or dummy users.
    // product_details is a single EMBEDDED OBJECT per order (not an array),
    // so each order corresponds to exactly one purchase entry.
    const recentOrders = await OrderModel.find({
      payment_status: 'PAID',
      countryCode: targetCountry,
    })
      .sort({ createdAt: -1 })
      .limit(settings.maxRealPurchases || 20)
      .populate('userId', 'name avatar')
      .populate({ path: 'delivery_address', select: 'state city' })
      .select('userId product_details quantity unitPrice createdAt delivery_address deliveryAddress')
      .lean();

    const realPurchases = recentOrders
      .filter((order) => order.product_details?.name) // skip orders with no product snapshot
      .map((order) => {
        const pd = order.product_details || {};
        const state =
          order.delivery_address?.state ||
          order.deliveryAddress?.state ||
          'Nigeria';

        return {
          id: `real_${order._id}`,
          name: order.userId?.name || 'Someone',
          avatar: order.userId?.avatar || '',
          state,
          productName: pd.name || 'a product',
          productImage: pd.image?.[0] || '',
          quantity: order.quantity || 1,
          price: order.unitPrice || 0,
          purchasedAt: order.createdAt,
          isDummy: false,
        };
      });

    let combined = [...realPurchases];

    // Mix in dummy users if enabled
    if (settings.useDummyUsers && settings.dummyUsers?.length > 0) {
      const activeDummy = settings.dummyUsers.filter((u) => u.isActive);
      const dummyPurchases = activeDummy.map((u) => ({
        id: `dummy_${u._id}`,
        name: u.name,
        avatar: u.avatar || '',
        state: u.state || 'Lagos',
        productName: u.productName || 'a product',
        productImage: u.productImage || '',
        quantity: u.quantity || 1,
        price: u.price || 0,
        purchasedAt: u.purchasedAt || new Date(),
        isDummy: true,
      }));
      combined = [...realPurchases, ...dummyPurchases];
    }

    // Shuffle so dummy and real are interleaved
    for (let i = combined.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [combined[i], combined[j]] = [combined[j], combined[i]];
    }

    return res.json({
      success: true,
      data: combined,
      settings: {
        enabled: settings.enabled,
        animationType: settings.animationType,
        position: settings.position,
        displayDurationMs: settings.displayDurationMs,
        pauseBetweenMs: settings.pauseBetweenMs,
        fadeInMs: settings.fadeInMs,
        fadeOutMs: settings.fadeOutMs,
      },
    });
  } catch (err) {
    console.error('FOMO getRecentPurchases error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
