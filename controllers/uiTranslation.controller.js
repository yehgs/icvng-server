// controllers/uiTranslation.controller.js
import UiTranslationModel from "../models/uiTranslation.model.js";

const APPS = ["admin", "client"];

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Public — called by the live admin/client apps on boot and on language
// change. Returns a flat { key: value } map for one app+language, which
// i18n/index.js in each app overlays on top of its bundled static locale
// (see applyDbOverrides()/EFFECTIVE there). Not gated behind auth: this is
// UI chrome, not sensitive data, and both apps need it before/without login.
export const getMergedUiTranslationsController = async (request, response) => {
  try {
    const { app, language } = request.query;
    if (!APPS.includes(app)) {
      return response.status(400).json({
        message: "app must be 'admin' or 'client'",
        error: true,
        success: false,
      });
    }
    if (!language) {
      return response.status(400).json({
        message: "language is required",
        error: true,
        success: false,
      });
    }

    const rows = await UiTranslationModel.find(
      { app, language: String(language).toLowerCase() },
      "key value",
    ).lean();

    const flat = {};
    for (const row of rows) {
      if (row.value) flat[row.key] = row.value;
    }

    return response.json({ data: flat, error: false, success: true });
  } catch (error) {
    return response.status(500).json({
      message: error.message || "Failed to load UI translations",
      error: true,
      success: false,
    });
  }
};

// Admin — distinct top-level namespaces (first key segment, e.g. "common",
// "productForm") for the browse table's filter dropdown.
export const getUiTranslationNamespacesController = async (request, response) => {
  try {
    const { app } = request.query;
    if (!APPS.includes(app)) {
      return response.status(400).json({
        message: "app must be 'admin' or 'client'",
        error: true,
        success: false,
      });
    }
    const keys = await UiTranslationModel.distinct("key", { app, language: "en" });
    const namespaces = Array.from(new Set(keys.map((k) => k.split(".")[0]))).sort();
    return response.json({ data: namespaces, error: false, success: true });
  } catch (error) {
    return response.status(500).json({
      message: error.message || "Failed to load namespaces",
      error: true,
      success: false,
    });
  }
};

// Admin — paginated/searchable browse+edit table. Keyed off the English
// rows (the canonical key set — every key is seeded in English first), with
// the requested target language's value (if any) joined in per key.
export const listUiTranslationsController = async (request, response) => {
  try {
    const {
      app,
      language = "en",
      search = "",
      namespace = "",
      page = "1",
      limit = "50",
    } = request.query;

    if (!APPS.includes(app)) {
      return response.status(400).json({
        message: "app must be 'admin' or 'client'",
        error: true,
        success: false,
      });
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

    const andConds = [];
    if (search) andConds.push({ key: { $regex: escapeRegExp(search), $options: "i" } });
    if (namespace) andConds.push({ key: { $regex: `^${escapeRegExp(namespace)}\\.` } });

    const enFilter = { app, language: "en", ...(andConds.length ? { $and: andConds } : {}) };

    const total = await UiTranslationModel.countDocuments(enFilter);
    const enRows = await UiTranslationModel.find(enFilter)
      .sort({ key: 1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean();

    const targetLang = String(language).toLowerCase();
    const keys = enRows.map((r) => r.key);
    const targetRows =
      targetLang === "en"
        ? []
        : await UiTranslationModel.find({ app, language: targetLang, key: { $in: keys } }).lean();
    const targetByKey = Object.fromEntries(targetRows.map((r) => [r.key, r]));

    const data = enRows.map((enRow) => {
      const targetRow = targetByKey[enRow.key];
      return {
        key: enRow.key,
        en: enRow.value,
        value: targetLang === "en" ? enRow.value : targetRow?.value ?? "",
        isEdited: targetLang === "en" ? false : !!targetRow?.isEdited,
      };
    });

    return response.json({
      data,
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.max(1, Math.ceil(total / limitNum)),
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || "Failed to load UI translations",
      error: true,
      success: false,
    });
  }
};

// Admin — save one key's value for one language. English rows are the
// canonical source string and aren't editable through this system (change
// en.js in the repo and re-run the seed script instead — that's the
// baseline every other language merges over).
export const upsertUiTranslationController = async (request, response) => {
  try {
    const { app, key, language, value } = request.body;
    if (!app || !key || !language) {
      return response.status(400).json({
        message: "app, key, and language are required",
        error: true,
        success: false,
      });
    }
    if (!APPS.includes(app)) {
      return response.status(400).json({
        message: "app must be 'admin' or 'client'",
        error: true,
        success: false,
      });
    }
    const normalizedLang = String(language).toLowerCase();
    if (normalizedLang === "en") {
      return response.status(400).json({
        message: "English is the base copy — edit en.js in the repo and re-run scripts/seedUiTranslations.js instead",
        error: true,
        success: false,
      });
    }

    const doc = await UiTranslationModel.findOneAndUpdate(
      { app, key, language: normalizedLang },
      {
        $set: {
          value: value ?? "",
          isEdited: true,
          updatedBy: request.user?._id,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    return response.json({ message: "Saved", data: doc, error: false, success: true });
  } catch (error) {
    return response.status(500).json({
      message: error.message || "Failed to save",
      error: true,
      success: false,
    });
  }
};
