/**
 * controllers/translation.controller.js
 */

import TranslationModel from "../models/translation.model.js";
import {
  translateEntity,
  translateText,
  getTranslation,
} from "../utils/translationService.js";

/**
 * POST /api/translations/trigger
 * Admin-triggered: translate a single entity now.
 */
export async function triggerTranslation(req, res) {
  try {
    const { entityType, entityId, document, sourceLang = "en" } = req.body;

    if (!entityType || !entityId || !document) {
      return res.status(400).json({
        message: "entityType, entityId, and document are required",
        error: true,
        success: false,
      });
    }

    // Run translation async — don't block the response
    translateEntity({ entityType, entityId, document, sourceLang }).catch(
      (err) => console.error("Background translation error:", err.message)
    );

    return res.json({
      message: "Translation queued",
      success: true,
      error: false,
    });
  } catch (err) {
    console.error("triggerTranslation error:", err);
    return res.status(500).json({
      message: err.message,
      error: true,
      success: false,
    });
  }
}

/**
 * GET /api/translations/:entityType/:entityId/:language
 * Client: get translated fields for one entity.
 */
export async function getEntityTranslation(req, res) {
  try {
    const { entityType, entityId, language } = req.params;

    const fields = await getTranslation(entityType, entityId, language);

    return res.json({
      success: true,
      error: false,
      data: fields || {},
    });
  } catch (err) {
    console.error("getEntityTranslation error:", err);
    return res.status(500).json({
      message: err.message,
      error: true,
      success: false,
    });
  }
}

/**
 * GET /api/translations/:entityType/:entityId
 * Returns all language variants for an entity (for admin review panel).
 */
export async function getAllTranslationsForEntity(req, res) {
  try {
    const { entityType, entityId } = req.params;

    const docs = await TranslationModel.find({
      entityType,
      entityId,
    }).lean();

    return res.json({
      success: true,
      error: false,
      data: docs,
    });
  } catch (err) {
    console.error("getAllTranslationsForEntity error:", err);
    return res.status(500).json({
      message: err.message,
      error: true,
      success: false,
    });
  }
}

/**
 * PUT /api/translations/:entityType/:entityId/:language
 * Manual override: admin edits a specific translation.
 */
export async function updateTranslation(req, res) {
  try {
    const { entityType, entityId, language } = req.params;
    const { fields } = req.body;

    if (!fields) {
      return res.status(400).json({
        message: "fields is required",
        error: true,
        success: false,
      });
    }

    const doc = await TranslationModel.findOneAndUpdate(
      { entityType, entityId, language },
      {
        fields,
        autoTranslated: false,
        translatedAt: new Date(),
        engine: "manual",
      },
      { upsert: true, new: true }
    );

    return res.json({
      success: true,
      error: false,
      data: doc,
    });
  } catch (err) {
    console.error("updateTranslation error:", err);
    return res.status(500).json({
      message: err.message,
      error: true,
      success: false,
    });
  }
}

/**
 * POST /api/translations/text
 * Quick single-string translation endpoint (used by admin form previews).
 */
export async function translateSingleText(req, res) {
  try {
    const { text, sourceLang = "en", targetLang } = req.body;

    if (!text || !targetLang) {
      return res.status(400).json({
        message: "text and targetLang are required",
        error: true,
        success: false,
      });
    }

    const translated = await translateText(text, sourceLang, targetLang);

    return res.json({
      success: true,
      error: false,
      data: { translated },
    });
  } catch (err) {
    console.error("translateSingleText error:", err);
    return res.status(500).json({
      message: err.message,
      error: true,
      success: false,
    });
  }
}
