/**
 * models/translation.model.js
 *
 * Stores translated versions of any translatable entity.
 *
 * Design:
 *   One document per (entityType, entityId, language) triple.
 *   The `fields` map holds key→translatedValue pairs so the schema
 *   is flexible — products, categories, blogs, banners etc all use
 *   the same collection.
 *
 * Example document:
 *   {
 *     entityType: "product",
 *     entityId:   ObjectId("…"),
 *     language:   "fr",
 *     fields: {
 *       name:        "Café Espresso Intenso",
 *       description: "Un espresso riche et corsé…",
 *       seoTitle:    "Achetez Café Espresso Intenso | I-Coffee Togo",
 *     },
 *     autoTranslated: true,
 *     translatedAt:   ISODate("…"),
 *   }
 */

import mongoose from "mongoose";
import { ALL_SUPPORTED_LANGUAGES } from "../config/countries/index.js";

const translationSchema = new mongoose.Schema(
  {
    // What type of content this translation belongs to
    entityType: {
      type: String,
      required: true,
      enum: [
        "product",
        "category",
        "subCategory",
        "brand",
        "blog",
        "blogCategory",
        "banner",
        "slider",
        "coupon",
        "notification",
        "email",
        "page",
        "fomo",
        "country",
        "homeContentBlock",
        "tag",
        "attribute",
        "color",
      ],
      index: true,
    },

    // The _id of the source document
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    // Target language code — PHASE 5: driven by country config, not a frozen
    // enum, so new markets/languages need no schema change.
    language: {
      type: String,
      required: true,
      enum: ALL_SUPPORTED_LANGUAGES.length ? ALL_SUPPORTED_LANGUAGES : ["en", "fr", "it"],
      index: true,
    },

    /**
     * Translated field values.
     * Stored as a plain object so any field can be included without
     * schema changes.  Use dot-notation keys for nested paths:
     *   { "seo.title": "...", "seo.description": "..." }
     */
    fields: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Was this translation auto-generated (true) or manually edited (false)?
    autoTranslated: {
      type: Boolean,
      default: true,
    },

    // Timestamp of the last translation run
    translatedAt: {
      type: Date,
      default: Date.now,
    },

    // Which translation engine produced this  (e.g. "libre" | "manual")
    engine: {
      type: String,
      default: "libre",
    },

    // PHASE 5: the language the MASTER content was authored in. Defaults to
    // English, but a Togo admin authoring in French should set this to "fr"
    // so the pipeline doesn't mislabel French master text as English
    // (audit §5.8). Used to skip needless self-translation and to translate
    // FROM the correct source.
    sourceLanguage: {
      type: String,
      default: "en",
    },
  },
  {
    timestamps: true,
  }
);

// Unique constraint: one translation per (entity, language)
translationSchema.index(
  { entityType: 1, entityId: 1, language: 1 },
  { unique: true }
);

const TranslationModel = mongoose.model("Translation", translationSchema);

export default TranslationModel;
