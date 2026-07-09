/**
 * utils/mediaLocalization.js
 *
 * PHASE 5 — country/language-specific media with HQ fallback.
 *
 * A localizable media field is stored as:
 *   {
 *     default: "https://.../hq-banner.jpg",   // HQ/master (required)
 *     byCountry: { TG: "https://.../tg.jpg" },
 *     byLanguage: { fr: "https://.../fr.jpg" }
 *   }
 * or simply a plain URL string (legacy) — both are supported.
 *
 * Resolution order (most specific wins):
 *   1. byCountry[countryCode]
 *   2. byLanguage[language]
 *   3. default
 *   4. the raw string (legacy)
 */

import mongoose from "mongoose";

/** Reusable sub-schema for a localizable image/media field. */
export const localizedMediaSchema = new mongoose.Schema(
  {
    default: { type: String, default: "" },
    byCountry: { type: Map, of: String, default: {} },
    byLanguage: { type: Map, of: String, default: {} },
  },
  { _id: false },
);

/**
 * Resolve the best media URL for a given country + language.
 *
 * @param {object|string|null} media   localized media object or legacy string
 * @param {object} ctx  { countryCode, language }
 * @returns {string}    the resolved URL (may be "")
 */
export function resolveMedia(media, { countryCode, language } = {}) {
  if (!media) return "";
  if (typeof media === "string") return media; // legacy plain URL

  // Support both Mongoose Map and plain object shapes.
  const getFrom = (container, key) => {
    if (!container || !key) return undefined;
    if (typeof container.get === "function") return container.get(key);
    return container[key];
  };

  const byCountry = getFrom(media.byCountry, countryCode);
  if (byCountry) return byCountry;

  const byLanguage = getFrom(media.byLanguage, language);
  if (byLanguage) return byLanguage;

  return media.default || "";
}

/**
 * Localize every localizable media field on a plain document.
 *
 * @param {object} doc
 * @param {string[]} mediaFields   field names holding localized media
 * @param {object} ctx  { countryCode, language }
 * @returns {object}  shallow copy with media fields resolved to strings
 */
export function localizeMedia(doc, mediaFields = [], ctx = {}) {
  if (!doc || !mediaFields.length) return doc;
  const out = { ...doc };
  for (const f of mediaFields) {
    if (f in out) out[f] = resolveMedia(out[f], ctx);
  }
  return out;
}
