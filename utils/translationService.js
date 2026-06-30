/**
 * utils/translationService.js
 *
 * Auto-translation pipeline using LibreTranslate (self-hosted, free).
 *
 * Falls back gracefully:
 *   1. LibreTranslate self-hosted  (LIBRETRANSLATE_URL env var)
 *   2. LibreTranslate public API   (https://libretranslate.com — rate-limited)
 *   3. No-op (returns source text) if both are unavailable
 *
 * The admin panel triggers translateEntity() after saving any content.
 * The client reads from the Translation collection via getTranslation().
 */

import axios from "axios";
import TranslationModel from "../models/translation.model.js";

// ── Config ───────────────────────────────────────────────────────────────────

const LIBRE_URL =
  process.env.LIBRETRANSLATE_URL || "https://libretranslate.com";
const LIBRE_API_KEY = process.env.LIBRETRANSLATE_API_KEY || "";
const SUPPORTED_LANGUAGES = ["en", "fr", "it"];

// Fields to translate per entity type  (source language is always "en")
const TRANSLATABLE_FIELDS = {
  product: ["name", "description", "unit", "seo.title", "seo.description"],
  category: ["name", "description"],
  subCategory: ["name"],
  brand: ["name", "description"],
  blog: ["title", "content", "excerpt", "seo.title", "seo.description"],
  blogCategory: ["name", "description"],
  banner: ["title", "description", "buttonText"],
  slider: ["title", "description", "buttonText"],
  fomo: ["notificationMessage"],
  notification: ["title", "message"],
  coupon: ["description"],
};

// ── Core translation ─────────────────────────────────────────────────────────

/**
 * Translate a single string from sourceLang to targetLang.
 *
 * @param {string} text
 * @param {string} sourceLang  e.g. "en"
 * @param {string} targetLang  e.g. "fr"
 * @returns {Promise<string>}
 */
export async function translateText(
  text,
  sourceLang = "en",
  targetLang = "fr",
) {
  if (!text || typeof text !== "string" || text.trim() === "") return text;
  if (sourceLang === targetLang) return text;

  try {
    const payload = {
      q: text,
      source: sourceLang,
      target: targetLang,
      format: "text",
    };
    if (LIBRE_API_KEY) payload.api_key = LIBRE_API_KEY;

    const { data } = await axios.post(`${LIBRE_URL}/translate`, payload, {
      timeout: 10000,
    });

    return data.translatedText || text;
  } catch (err) {
    // Log but don't throw — missing translation is non-fatal
    console.warn(
      `[translationService] Failed to translate "${text.substring(0, 40)}…" to ${targetLang}:`,
      err.message,
    );
    return text; // Return source text as fallback
  }
}

/**
 * Translate multiple strings in a single batch request.
 *
 * @param {string[]} texts
 * @param {string} sourceLang
 * @param {string} targetLang
 * @returns {Promise<string[]>}
 */
export async function translateBatch(
  texts,
  sourceLang = "en",
  targetLang = "fr",
) {
  if (!texts || texts.length === 0) return texts;
  if (sourceLang === targetLang) return texts;

  try {
    const payload = {
      q: texts,
      source: sourceLang,
      target: targetLang,
      format: "text",
    };
    if (LIBRE_API_KEY) payload.api_key = LIBRE_API_KEY;

    const { data } = await axios.post(`${LIBRE_URL}/translate`, payload, {
      timeout: 15000,
    });

    // LibreTranslate returns array when q is array
    if (Array.isArray(data.translatedText)) return data.translatedText;
    return texts;
  } catch (err) {
    console.warn(
      `[translationService] Batch translate to ${targetLang} failed:`,
      err.message,
    );
    // Fall back to per-item translation
    return Promise.all(
      texts.map((t) => translateText(t, sourceLang, targetLang)),
    );
  }
}

// ── Entity translation ────────────────────────────────────────────────────────

/**
 * Extract translatable field values from a document object.
 *
 * @param {object} doc     Mongoose document or plain object
 * @param {string[]} fields  e.g. ["name", "description", "seo.title"]
 * @returns {{ key: string, value: string }[]}
 */
function extractFields(doc, fields) {
  const result = [];
  for (const field of fields) {
    const parts = field.split(".");
    let value = doc;
    for (const part of parts) {
      value = value?.[part];
    }
    if (value && typeof value === "string") {
      result.push({ key: field, value });
    }
  }
  return result;
}

/**
 * Translate all translatable fields of an entity into all supported languages
 * and persist the results to the Translation collection.
 *
 * Called after create/update in admin controllers.
 *
 * @param {{
 *   entityType: string,
 *   entityId: string | import('mongoose').ObjectId,
 *   document: object,
 *   sourceLang?: string,
 * }} options
 */
export async function translateEntity({
  entityType,
  entityId,
  document,
  sourceLang = "en",
}) {
  const fields = TRANSLATABLE_FIELDS[entityType];
  if (!fields) {
    console.warn(
      `[translationService] No fields config for entityType: ${entityType}`,
    );
    return;
  }

  const extracted = extractFields(document, fields);
  if (extracted.length === 0) return;

  const targetLanguages = SUPPORTED_LANGUAGES.filter((l) => l !== sourceLang);

  for (const targetLang of targetLanguages) {
    try {
      // ── Guard: never overwrite fields a human has manually edited ─────────
      // Check for an existing doc where autoTranslated === false (human-edited).
      // For those fields we skip auto-translation entirely so foreign-admin
      // copy is preserved even when the Nigerian team updates the source content.
      const existing = await TranslationModel.findOne({
        entityType,
        entityId,
        language: targetLang,
      }).lean();

      // Determine which fields are safe to auto-translate:
      // - If no existing doc → translate everything
      // - If existing doc with autoTranslated === false → skip fields that
      //   are already in existing.fields (human-reviewed); translate the rest
      // - If existing doc with autoTranslated === true  → re-translate all
      //   (source content changed; no human edits to protect)
      const manualFields =
        existing && existing.autoTranslated === false
          ? Object.keys(existing.fields || {})
          : [];

      const fieldsToTranslate =
        manualFields.length > 0
          ? extracted.filter((e) => !manualFields.includes(e.key))
          : extracted;

      if (fieldsToTranslate.length === 0) {
        console.log(
          `[translationService] Skipped ${entityType}:${entityId} → ${targetLang} (all fields manually edited)`,
        );
        continue;
      }

      const texts = fieldsToTranslate.map((e) => e.value);
      const translated = await translateBatch(texts, sourceLang, targetLang);

      // Merge new auto-translations on top of any existing manual fields
      const translatedFields = { ...(existing?.fields || {}) };
      fieldsToTranslate.forEach((entry, idx) => {
        translatedFields[entry.key] = translated[idx];
      });

      // autoTranslated stays false if there are still manually-edited fields
      const hasManualFields = manualFields.length > 0;

      // Upsert: replace if already exists
      await TranslationModel.findOneAndUpdate(
        { entityType, entityId, language: targetLang },
        {
          fields: translatedFields,
          autoTranslated: !hasManualFields,
          translatedAt: new Date(),
          engine: hasManualFields ? "mixed" : "libre",
        },
        { upsert: true, new: true },
      );

      console.log(
        `[translationService] Translated ${entityType}:${entityId} → ${targetLang}`,
      );
    } catch (err) {
      console.error(
        `[translationService] Error translating ${entityType}:${entityId} → ${targetLang}:`,
        err.message,
      );
    }
  }
}

// ── Retrieval ─────────────────────────────────────────────────────────────────

/**
 * Get a stored translation for a single entity.
 *
 * @param {string} entityType
 * @param {string | ObjectId} entityId
 * @param {string} language
 * @returns {Promise<object|null>}  The `fields` map or null
 */
export async function getTranslation(entityType, entityId, language) {
  if (language === "en") return null; // English is the source — no translation needed

  const doc = await TranslationModel.findOne({
    entityType,
    entityId,
    language,
  }).lean();

  return doc ? doc.fields : null;
}

/**
 * Merge translation fields into a document object.
 * Mutates a shallow copy — original is not modified.
 *
 * @param {object} doc         The source document (plain object)
 * @param {object|null} fields The translation fields map
 * @returns {object}
 */
export function applyTranslation(doc, fields) {
  if (!fields || Object.keys(fields).length === 0) return doc;

  const result = { ...doc };
  for (const [key, value] of Object.entries(fields)) {
    const parts = key.split(".");
    if (parts.length === 1) {
      result[key] = value;
    } else {
      // Shallow nested merge (seo.title, seo.description)
      const parent = parts[0];
      if (!result[parent]) result[parent] = {};
      else result[parent] = { ...result[parent] };
      result[parent][parts[1]] = value;
    }
  }
  return result;
}

/**
 * Convenience: fetch translations for a list of entity IDs.
 *
 * @param {string} entityType
 * @param {string[]} entityIds
 * @param {string} language
 * @returns {Promise<Map<string, object>>}  entityId → fields
 */
export async function getBulkTranslations(entityType, entityIds, language) {
  if (language === "en" || !entityIds?.length) return new Map();

  const docs = await TranslationModel.find({
    entityType,
    entityId: { $in: entityIds },
    language,
  }).lean();

  const map = new Map();
  for (const doc of docs) {
    map.set(doc.entityId.toString(), doc.fields);
  }
  return map;
}
