/**
 * utils/translationService.js
 *
 * Auto-translation pipeline powered by OpenAI (see
 * services/ai/openaiTranslationClient.js for the actual API calls, prompts,
 * and retry logic — this file is the business logic layer on top of it:
 * which fields to translate per entity, the "don't clobber manual edits"
 * guard, and reading translations back out for the storefront/admin).
 *
 * Requires OPENAI_API_KEY to be set server-side (see openaiTranslationClient
 * for details). Never hardcode the key, never expose it to the frontend.
 *
 * The admin panel triggers translateEntity() after saving any content.
 * The client reads from the Translation collection via getTranslation().
 */

import TranslationModel from "../models/translation.model.js";
import { ALL_SUPPORTED_LANGUAGES } from "../config/countries/index.js";
import {
  translateBatchAI,
  translateBatchAIDetailed,
  translateOneAI,
} from "../services/ai/openaiTranslationClient.js";

// ── Config ───────────────────────────────────────────────────────────────────

// Driven by country config (same source of truth the Translation model
// uses) rather than a frozen list — a new market/language needs no edit
// here.
export const SUPPORTED_LANGUAGES = ALL_SUPPORTED_LANGUAGES.length
  ? ALL_SUPPORTED_LANGUAGES
  : ["en", "fr", "it"];

if (!process.env.OPENAI_API_KEY) {
  console.warn(
    "[translationService] OPENAI_API_KEY is not set — AI auto-translation " +
      "will fail at request time (translations fall back to source text). " +
      "Set OPENAI_API_KEY in the server environment to enable it. " +
      "Manual translations (admin-entered) are unaffected."
  );
}

// Fields to translate per entity type  (source language is always "en")
// NOTE: field paths must match the actual Mongoose schema shape. Products
// and blog posts store `seoTitle`/`seoDescription` as flat top-level
// fields (not a nested `seo: { title, description }` object) — using
// "seo.title" here silently matched nothing, so SEO copy was never
// auto-translated. Fixed to the real flat field names below.
// Exported (not just module-private) so scripts/bulkTranslateContent.js can
// discover every translatable entityType dynamically — including any added
// after this comment was written — instead of hardcoding a list that
// silently drifts out of sync with this file.
export const TRANSLATABLE_FIELDS = {
  product: ["name", "description", "unit", "seoTitle", "seoDescription", "roastOrigin", "coffeeOrigin", "blend", "shortDescription", "additionalInfo"],
  category: ["name"],
  subCategory: ["name"],
  // NOTE: "brand" intentionally has no entry here. Brand names are proper
  // nouns (Nescafé, Lavazza, etc.) — translating them would corrupt them
  // rather than localize them. Do not add it back without a fields list
  // that excludes `name`.
  blog: ["title", "content", "excerpt", "seoTitle", "seoDescription", "seoKeywords", "socialTitle"],
  blogCategory: ["name", "description", "seoTitle", "seoDescription"],
  blogTag: ["name", "description"],
  // FIX: these previously listed "description"/"buttonText", which don't
  // exist on either schema (Banner uses subtitle/linkText, Slider has no
  // button field at all — see models/banner.model.js, models/slider.model.js
  // and the admin forms' InlineTranslateFields `fields` props, which were
  // always correct). The mismatch meant extractFields() found nothing for
  // those keys and AI auto-translate silently only ever translated the
  // "title" field on banners/sliders — subtitle and button text never got
  // machine-translated no matter how many times "Auto" was clicked.
  banner: ["title", "subtitle", "linkText"],
  slider: ["title", "description"],
  // Site-wide promotional pop-up — title/body copy/CTA button label.
  popup: ["title", "bodyText", "ctaText"],
  fomo: ["notificationMessage"],
  notification: ["title", "message"],
  coupon: ["description"],
  country: ["content.preheaderMessage", "contacts.address"],
  homeContentBlock: ["title", "description", "quote", "badge", "message", "contactAddress"],
  // Small shared catalog dictionaries used across products (filters,
  // variant options) — translating just "name" covers what shoppers see;
  // an attribute's `values` array (e.g. Size: Small/Medium/Large) isn't
  // translated yet — the generic field-translation system handles simple
  // string/dot-path fields, not array elements.
  tag: ["name"],
  attribute: ["name"],
  color: ["name"],
};

// PHASE 6: SitePage (`page` entityType) content is a free-form, admin-grown
// dictionary rather than a fixed field list (that's the whole point of the
// CMS being "dynamic" — editors add new keys without a deploy). So instead
// of a static TRANSLATABLE_FIELDS list, walk the document's `content` object
// and its `seo` block and translate every string it finds (recursing into
// arrays/objects for list-style content like FAQ items or table rows).
// A handful of keys are deliberately left alone — they're configuration,
// not copy, and running them through MT would corrupt them.
const PAGE_NON_TRANSLATABLE_KEYS = new Set([
  "icon", "iconKey", "color", "image", "img", "src", "href", "link", "url",
  "id", "_id", "key", "slug", "type", "order", "phone", "whatsapp", "email",
  "embedUrl", "mapEmbedUrl", "countryCode", "lat", "lng", "rating",
  // Structural/config values that happen to be strings but aren't copy:
  // stat counts ("797+"), i18n key references ("statCustomers"), step
  // numerals ("1", "2", ...), and internal filter taxonomy ("ordering",
  // "shipping", ...) on FAQ items. Translating these produced garbage
  // (e.g. "statStates" and "797+" being sent to the MT API as if they
  // were sentences).
  "number", "labelKey", "step", "category",
]);

function isPlainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Recursively collect translatable string leaves found under `node`,
 * skipping configuration-only keys, in a stable, repeatable order.
 */
function collectPageStrings(node, keyName, out) {
  if (node == null) return;
  if (typeof node === "string") {
    if (node.trim() && !PAGE_NON_TRANSLATABLE_KEYS.has(keyName)) {
      out.push(node);
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item) => collectPageStrings(item, keyName, out));
    return;
  }
  if (isPlainObject(node)) {
    for (const [k, v] of Object.entries(node)) {
      collectPageStrings(v, k, out);
    }
  }
}

/**
 * Rebuild a deep clone of `node`, replacing translatable string leaves with
 * the next value from `translatedQueue` (consumed in the exact same order
 * collectPageStrings produced them — the two walks must stay in lockstep).
 */
function applyPageStrings(node, keyName, translatedQueue) {
  if (node == null) return node;
  if (typeof node === "string") {
    if (node.trim() && !PAGE_NON_TRANSLATABLE_KEYS.has(keyName)) {
      const next = translatedQueue.shift();
      return next !== undefined ? next : node;
    }
    return node;
  }
  if (Array.isArray(node)) {
    return node.map((item) => applyPageStrings(item, keyName, translatedQueue));
  }
  if (isPlainObject(node)) {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = applyPageStrings(v, k, translatedQueue);
    }
    return out;
  }
  return node;
}

/**
 * Translate an entire SitePage's `content` (+ `seo`) dictionary into every
 * target language and persist to the Translation collection, honoring the
 * same "don't clobber a human's manual edits" guard as translateEntity().
 *
 * @param {{ entityId: string, document: { content: object, seo?: object }, sourceLang?: string, targetLangs?: string[] }} opts
 */
export async function translateSitePage({ entityId, document, sourceLang = "en", targetLangs }) {
  const results = {};

  if (!process.env.OPENAI_API_KEY) {
    const msg =
      "OPENAI_API_KEY is not set on the server — auto-translation cannot run.";
    console.error(`[translationService] ${msg}`);
    return { ok: false, error: msg, results };
  }

  const sourceTree = { content: document.content || {}, seo: document.seo || {} };
  const strings = [];
  collectPageStrings(sourceTree, "", strings);
  if (strings.length === 0) return { ok: true, error: null, results, note: "No translatable text found on this page" };

  const targetLanguages = (targetLangs && targetLangs.length ? targetLangs : SUPPORTED_LANGUAGES).filter(
    (l) => l !== sourceLang
  );

  for (const targetLang of targetLanguages) {
    try {
      const existing = await TranslationModel.findOne({
        entityType: "page",
        entityId,
        language: targetLang,
      }).lean();

      // A human has reviewed/edited this language for this page already —
      // never silently overwrite their work with a fresh machine pass.
      if (existing && existing.autoTranslated === false) {
        console.log(`[translationService] Skipped page:${entityId} → ${targetLang} (manually reviewed)`);
        results[targetLang] = { status: "skipped", reason: "manually reviewed" };
        continue;
      }

      const { results: translatedFlat, failedCount, lastError, lastErrorCode } =
        await translateBatchDetailed(strings, sourceLang, targetLang);

      if (failedCount === strings.length) {
        // Total failure — the reconstructed tree would be 100% untranslated
        // English, so don't persist it as if it were a real translation.
        console.error(
          `[translationService] All ${strings.length} string(s) failed to translate ` +
            `page:${entityId} → ${targetLang}. Last error: ${lastError}. ` +
            `See [openaiTranslationClient] log lines above for the underlying OpenAI error.`,
        );
        results[targetLang] = {
          status: "error",
          errorCode: lastErrorCode || "unknown",
          error:
            lastErrorCode && lastErrorCode !== "unknown"
              ? `${lastError} (${strings.length} string(s) affected.)`
              : `OpenAI translation failed for all ${strings.length} string(s): ${lastError}. Check server logs for [openaiTranslationClient] entries.`,
        };
        continue;
      }

      const queue = [...translatedFlat];
      const translatedTree = applyPageStrings(sourceTree, "", queue);

      await TranslationModel.findOneAndUpdate(
        { entityType: "page", entityId, language: targetLang },
        {
          fields: { content: translatedTree.content, seo: translatedTree.seo },
          autoTranslated: true,
          translatedAt: new Date(),
          engine: "openai",
          sourceLanguage: sourceLang,
        },
        { upsert: true, new: true }
      );

      if (failedCount > 0) {
        // Partial failure: the tree was still saved (structurally, every
        // leaf needs a value), but some leaves are still English pending a
        // retry — say so plainly rather than reporting "ok".
        console.warn(
          `[translationService] Partially translated page:${entityId} → ${targetLang}: ` +
            `${strings.length - failedCount}/${strings.length} string(s) succeeded, ` +
            `${failedCount} failed and are still English. Last error: ${lastError}`,
        );
        results[targetLang] = {
          status: "partial",
          stringsTranslated: strings.length - failedCount,
          stringsFailed: failedCount,
          errorCode: lastErrorCode || "unknown",
          error: `${failedCount} of ${strings.length} string(s) failed to translate: ${lastError}`,
        };
      } else {
        console.log(`[translationService] Translated page:${entityId} → ${targetLang}`);
        results[targetLang] = { status: "ok", stringsTranslated: strings.length };
      }
    } catch (err) {
      console.error(`[translationService] Error translating page:${entityId} → ${targetLang}:`, err.message);
      results[targetLang] = { status: "error", error: err.message };
    }
  }

  const languages = Object.keys(results);
  const anyError = languages.some((l) => ["error", "partial"].includes(results[l].status));
  const allSkippedOrError = languages.length > 0 && languages.every(
    (l) => results[l].status !== "ok",
  );

  return {
    ok: !anyError && !allSkippedOrError,
    error: anyError
      ? "One or more languages failed to translate — see results for details"
      : null,
    results,
  };
}

// ── Core translation ─────────────────────────────────────────────────────────

/**
 * Translate a single string from sourceLang to targetLang.
 *
 * @param {string} text
 * @param {string} sourceLang  e.g. "en"
 * @param {string} targetLang  e.g. "fr"
 * @returns {Promise<string>}
 */
/**
 * Translate a single string via OpenAI. Non-fatal on failure — returns the
 * source text back so callers never have to special-case errors.
 */
export async function translateText(text, sourceLang = "en", targetLang = "fr") {
  if (!text || typeof text !== "string" || text.trim() === "") return text;
  if (sourceLang === targetLang) return text;
  return translateOneAI(text, sourceLang, targetLang);
}

/**
 * Translate multiple strings via OpenAI, in as few requests as practical.
 * Order-preserving; any string that fails after retries falls back to its
 * source value rather than failing the whole batch (see
 * services/ai/openaiTranslationClient.js for chunking/retry/cache details).
 *
 * @param {string[]} texts
 * @param {string} sourceLang
 * @param {string} targetLang
 * @returns {Promise<string[]>}
 */
export async function translateBatch(texts, sourceLang = "en", targetLang = "fr") {
  if (!texts || texts.length === 0) return texts;
  if (sourceLang === targetLang) return texts;
  return translateBatchAI(texts, sourceLang, targetLang);
}

/**
 * Same as translateBatch(), but returns per-item success info instead of
 * collapsing a failed-and-fell-back-to-source item into an indistinguishable
 * "translated" string. Use this wherever the outcome gets reported back to
 * a human (translateEntity/translateSitePage below) — this is what makes a
 * real OpenAI failure show up as an actual error instead of a false
 * "Translation complete".
 *
 * @param {string[]} texts
 * @param {string} sourceLang
 * @param {string} targetLang
 * @returns {Promise<{results: string[], succeeded: boolean[], failedCount: number, lastError: string|null}>}
 */
export async function translateBatchDetailed(texts, sourceLang = "en", targetLang = "fr") {
  if (!texts || texts.length === 0) {
    return { results: texts, succeeded: [], failedCount: 0, lastError: null };
  }
  if (sourceLang === targetLang) {
    return { results: texts, succeeded: texts.map(() => true), failedCount: 0, lastError: null };
  }
  return translateBatchAIDetailed(texts, sourceLang, targetLang);
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
  // Optional — restrict this run to a subset of languages instead of every
  // language in SUPPORTED_LANGUAGES. Mirrors translateSitePage()'s
  // targetLangs param. Used by scripts/bulkTranslateContent.js so a bulk
  // run for newly-added languages doesn't redundantly re-translate
  // languages that already have a full pass done (e.g. re-running fr/it
  // for every blog post again just because a new language was added).
  targetLangs,
  // Optional — when true, a field that already has ANY existing
  // auto-translated value for a language is left alone instead of being
  // re-translated, even though the normal rule below is "re-translate
  // everything when there are no manual edits to protect" (appropriate for
  // the auto-on-save trigger, where the doc was just edited so a fresh
  // translation is exactly what's wanted). For a BULK backfill run,
  // though, that default behavior means any interruption — a dropped DB
  // connection, a bad API key discovered partway through, Ctrl+C — forces
  // a full from-scratch re-run next time, re-billing OpenAI for hundreds
  // of fields that already succeeded. skipExisting=true makes a re-run
  // pick up only what's actually still missing. Used by
  // scripts/bulkTranslateContent.js by default (pass --force there to get
  // the normal full-re-translate behavior instead).
  skipExisting = false,
}) {
  // Per-language outcome, so callers (the /translations/trigger endpoint in
  // particular) can tell the admin what actually happened instead of just
  // assuming success. Shape: { fr: { status: "ok"|"error"|"skipped", error?, fieldsTranslated? }, it: {...} }
  const results = {};

  const fields = TRANSLATABLE_FIELDS[entityType];
  if (!fields) {
    const msg = `No translatable-fields config for entityType "${entityType}"`;
    console.warn(`[translationService] ${msg}`);
    return { ok: false, error: msg, results };
  }

  if (!process.env.OPENAI_API_KEY) {
    const msg =
      "OPENAI_API_KEY is not set on the server — auto-translation cannot run.";
    console.error(`[translationService] ${msg}`);
    return { ok: false, error: msg, results };
  }

  const extracted = extractFields(document, fields);
  if (extracted.length === 0) {
    return { ok: true, error: null, results, note: "No translatable text found on this entity" };
  }

  const targetLanguages = (targetLangs && targetLangs.length ? targetLangs : SUPPORTED_LANGUAGES).filter(
    (l) => l !== sourceLang,
  );

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
      //   (source content changed; no human edits to protect) — UNLESS
      //   skipExisting is set, in which case a field that already has a
      //   value is left alone too (see the skipExisting param doc above).
      const manualFields =
        existing && existing.autoTranslated === false
          ? Object.keys(existing.fields || {})
          : [];

      const alreadyDoneFields =
        skipExisting && existing?.fields
          ? Object.keys(existing.fields).filter(
              (k) => existing.fields[k] && String(existing.fields[k]).trim() !== "",
            )
          : [];

      const skipFields = new Set([...manualFields, ...alreadyDoneFields]);
      const fieldsToTranslate =
        skipFields.size > 0
          ? extracted.filter((e) => !skipFields.has(e.key))
          : extracted;

      if (fieldsToTranslate.length === 0) {
        const reason =
          manualFields.length > 0 && alreadyDoneFields.length > 0
            ? "all fields already manually edited or already translated"
            : manualFields.length > 0
              ? "all fields manually edited"
              : "all fields already translated (skipExisting)";
        console.log(
          `[translationService] Skipped ${entityType}:${entityId} → ${targetLang} (${reason})`,
        );
        results[targetLang] = { status: "skipped", reason };
        continue;
      }

      const texts = fieldsToTranslate.map((e) => e.value);
      const { results: translated, succeeded, failedCount, lastError, lastErrorCode } =
        await translateBatchDetailed(texts, sourceLang, targetLang);

      // Merge new auto-translations on top of any existing manual fields.
      // Only merge fields OpenAI actually translated — a field that fell
      // back to its English source (succeeded[idx] === false) is left out
      // entirely rather than written to the Translation collection as if
      // it were real translated content. Previously every field got
      // merged regardless of success, so a total OpenAI outage could still
      // upsert a doc full of untranslated English text stamped
      // autoTranslated/engine: "openai" — indistinguishable from a real
      // translation to anything reading it back, and the caller had no way
      // to know it happened (this is the root cause of "it displayed
      // Translation complete yet nothing was translated").
      const translatedFields = { ...(existing?.fields || {}) };
      let actuallyTranslatedCount = 0;
      fieldsToTranslate.forEach((entry, idx) => {
        if (succeeded[idx]) {
          translatedFields[entry.key] = translated[idx];
          actuallyTranslatedCount++;
        }
      });

      if (actuallyTranslatedCount === 0) {
        // Every field failed — don't touch the Translation collection at
        // all (nothing to persist), and report a real error instead of a
        // false "ok".
        console.error(
          `[translationService] All ${fieldsToTranslate.length} field(s) failed to translate ` +
            `${entityType}:${entityId} → ${targetLang}. Last error: ${lastError}. ` +
            `See [openaiTranslationClient] log lines above for the underlying OpenAI error ` +
            `(check OPENAI_API_KEY, model name, quota/billing, and network egress to api.openai.com).`,
        );
        results[targetLang] = {
          status: "error",
          errorCode: lastErrorCode || "unknown",
          // Lead with the friendly, cause-specific message (e.g. quota
          // exhausted) when we have one — that's what actually gets shown
          // to the admin. The raw OpenAI text + "check server logs" pointer
          // stays available for whoever investigates, appended after it.
          error:
            lastErrorCode && lastErrorCode !== "unknown"
              ? `${lastError} (${fieldsToTranslate.length} field(s) affected. See server logs for [openaiTranslationClient] entries.)`
              : `OpenAI translation failed for all ${fieldsToTranslate.length} field(s): ${lastError}. ` +
                `Check server logs for [openaiTranslationClient] entries for the underlying cause.`,
        };
        continue;
      }

      // autoTranslated stays false if there are still manually-edited fields
      const hasManualFields = manualFields.length > 0;

      // Upsert: replace if already exists
      await TranslationModel.findOneAndUpdate(
        { entityType, entityId, language: targetLang },
        {
          fields: translatedFields,
          autoTranslated: !hasManualFields,
          translatedAt: new Date(),
          engine: hasManualFields ? "mixed" : "openai",
        },
        { upsert: true, new: true },
      );

      if (failedCount > 0) {
        console.warn(
          `[translationService] Partially translated ${entityType}:${entityId} → ${targetLang}: ` +
            `${actuallyTranslatedCount}/${fieldsToTranslate.length} field(s) succeeded, ` +
            `${failedCount} failed and were left as-is (not overwritten with English). ` +
            `Last error: ${lastError}`,
        );
        results[targetLang] = {
          status: "partial",
          fieldsTranslated: actuallyTranslatedCount,
          fieldsFailed: failedCount,
          errorCode: lastErrorCode || "unknown",
          error: `${failedCount} of ${fieldsToTranslate.length} field(s) failed to translate: ${lastError}`,
        };
      } else {
        console.log(
          `[translationService] Translated ${entityType}:${entityId} → ${targetLang}`,
        );
        results[targetLang] = { status: "ok", fieldsTranslated: actuallyTranslatedCount };
      }
    } catch (err) {
      console.error(
        `[translationService] Error translating ${entityType}:${entityId} → ${targetLang}:`,
        err.message,
      );
      results[targetLang] = { status: "error", error: err.message };
    }
  }

  const languages = Object.keys(results);
  const anyError = languages.some((l) => ["error", "partial"].includes(results[l].status));
  const allSkippedOrError = languages.length > 0 && languages.every(
    (l) => results[l].status !== "ok",
  );

  return {
    ok: !anyError && !allSkippedOrError,
    error: anyError
      ? "One or more languages failed to translate — see results for details"
      : null,
    results,
  };
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

/**
 * PHASE 5: localize a list of documents in one shot.
 *
 * Bulk-fetches translations for the given language and merges them into each
 * doc with per-field fallback to the source (master) value — a field missing a
 * translation keeps its master text rather than disappearing.
 *
 * @param {string} entityType
 * @param {object[]} docs        plain objects (use .lean() or .toObject())
 * @param {string} language      target language ("en" is a no-op passthrough)
 * @param {object} [opts]
 * @param {(d:object)=>string} [opts.idOf]  how to read each doc's id
 * @returns {Promise<object[]>}  localized copies (originals untouched)
 */
export async function localizeList(entityType, docs, language, opts = {}) {
  if (!Array.isArray(docs) || !docs.length) return docs || [];
  if (!language || language === "en") return docs;

  const idOf = opts.idOf || ((d) => (d._id || d.id)?.toString());
  const ids = docs.map(idOf).filter(Boolean);
  const map = await getBulkTranslations(entityType, ids, language);
  if (map.size === 0) return docs;

  return docs.map((d) => {
    const fields = map.get(idOf(d));
    return fields ? applyTranslation(d, fields) : d;
  });
}

/**
 * PHASE 5: localize a single document with per-field fallback to master.
 */
export async function localizeOne(entityType, doc, language) {
  if (!doc || !language || language === "en") return doc;
  const id = (doc._id || doc.id)?.toString();
  if (!id) return doc;
  const fields = await getTranslation(entityType, id, language);
  return fields ? applyTranslation(doc, fields) : doc;
}
