// server/controllers/homeContentBlock.controller.js
import HomeContentBlockModel from "../models/homeContentBlock.model.js";
import { localizeList } from "../utils/translationService.js";

// ── Public: storefront reads, scoped to the visited domain's country ───────
// Falls back to HQ (Nigeria) if that market hasn't added its own blocks yet.
export const getPublicHomeContentBlocks = async (req, res) => {
  try {
    const { type } = req.query; // 'trustBadge' | 'testimonial'
    const targetCountry = req.country?.code || "NG";
    const language =
      (req.headers["x-language"] || "").toLowerCase() ||
      req.country?.language?.default ||
      "en";

    const query = { isActive: true, ...(type && { type }) };

    let blocks = await HomeContentBlockModel.find({ ...query, countryCode: targetCountry })
      .sort({ order: 1, createdAt: 1 })
      .lean();

    if (blocks.length === 0 && targetCountry !== "NG") {
      blocks = await HomeContentBlockModel.find({ ...query, countryCode: "NG" })
        .sort({ order: 1, createdAt: 1 })
        .lean();
    }

    const localized = await localizeList("homeContentBlock", blocks, language);

    return res.json({ success: true, error: false, data: localized });
  } catch (err) {
    return res.status(500).json({ success: false, error: true, message: err.message });
  }
};

// ── Admin: list, scoped by countryScope (COUNTRY admin) or ?countryCode= (GLOBAL) ──
export const getAdminHomeContentBlocks = async (req, res) => {
  try {
    const { type } = req.query;
    const query = { ...(type && { type }) };

    // GLOBAL admins aren't auto-filtered by the plugin — let them target a
    // market explicitly; COUNTRY-scoped admins are always forced to their
    // own via the plugin's query hooks regardless of this.
    if (!req.countryScope && req.query.countryCode) {
      query.countryCode = req.query.countryCode.toUpperCase();
    }

    const blocks = await HomeContentBlockModel.find(query).sort({ type: 1, order: 1 });
    return res.json({ success: true, error: false, data: blocks });
  } catch (err) {
    return res.status(500).json({ success: false, error: true, message: err.message });
  }
};

export const createHomeContentBlock = async (req, res) => {
  try {
    const { countryCode, ...rest } = req.body;
    const block = new HomeContentBlockModel({
      ...rest,
      // A COUNTRY-scoped admin is stamped with their own country regardless
      // (countryScopedPlugin pre-save hook) — this only takes effect for
      // GLOBAL/HQ admins explicitly targeting a specific market.
      ...(countryCode && { countryCode: countryCode.toUpperCase() }),
    });
    await block.save();
    return res.json({ success: true, error: false, data: block, message: "Content block created" });
  } catch (err) {
    return res.status(500).json({ success: false, error: true, message: err.message });
  }
};

export const updateHomeContentBlock = async (req, res) => {
  try {
    const { _id, ...updates } = req.body;
    if (!_id) return res.status(400).json({ success: false, message: "_id is required" });
    delete updates.countryCode; // country is set at creation time only, not reassignable

    const block = await HomeContentBlockModel.findByIdAndUpdate(_id, updates, { new: true });
    if (!block) return res.status(404).json({ success: false, message: "Content block not found" });
    return res.json({ success: true, error: false, data: block, message: "Content block updated" });
  } catch (err) {
    return res.status(500).json({ success: false, error: true, message: err.message });
  }
};

export const deleteHomeContentBlock = async (req, res) => {
  try {
    const { _id } = req.body;
    const block = await HomeContentBlockModel.findByIdAndDelete(_id);
    if (!block) return res.status(404).json({ success: false, message: "Content block not found" });
    return res.json({ success: true, error: false, message: "Content block deleted" });
  } catch (err) {
    return res.status(500).json({ success: false, error: true, message: err.message });
  }
};
