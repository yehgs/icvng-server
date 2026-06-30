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
      ],
      index: true,
    },

    // The _id of the source document
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    // Target language code  e.g. "fr" | "it" | "en"
    language: {
      type: String,
      required: true,
      enum: ["en", "fr", "it"],
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
