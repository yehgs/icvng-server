/**
 * models/language.model.js
 *
 * The "language lib" — every language the platform can display UI chrome
 * and AI-translated content in. Previously this list only existed as
 * hardcoded arrays duplicated across several admin files (some limited to
 * just French/Italian) and static i18n locale files in both the client and
 * admin codebases (admin/src/i18n/index.js, client/src/i18n/index.js —
 * those two already agreed on the same 9 languages: en, fr, it, es, pt,
 * nl, ar, hi, zh). This collection makes that list admin-manageable
 * (add/rename/reorder/deactivate a language without a code deploy) instead
 * of frozen in source.
 *
 * This does NOT replace `ALL_SUPPORTED_LANGUAGES`
 * (config/countries/index.js) as the source of truth for which language
 * codes the Translation model will accept — that stays a static export
 * (Mongoose enums are resolved at schema-compile time, so it can't read
 * this collection directly). This collection is the *metadata* layer
 * (display name, native name, flag, RTL, active/inactive) that the admin
 * CRUD and the client/admin language switchers read — see
 * scripts/seedLanguages.js for the initial 9-language seed matching
 * ALL_SUPPORTED_LANGUAGES exactly.
 */

import mongoose from "mongoose";

const languageSchema = new mongoose.Schema(
  {
    // ISO 639-1 code, e.g. "fr". Lowercase, unique.
    code: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    // English display name, e.g. "French" — used in admin UI labels/prompts.
    name: {
      type: String,
      required: true,
      trim: true,
    },
    // Native display name, e.g. "Français" — used in language switchers.
    nativeName: {
      type: String,
      required: true,
      trim: true,
    },
    flagEmoji: {
      type: String,
      default: "",
    },
    isRTL: {
      type: Boolean,
      default: false,
    },
    // Whether this language is currently offered — inactive languages are
    // hidden from language switchers and skipped by the translation
    // pipeline/bulk-translate script, but existing Translation documents
    // for it are left alone (so re-activating doesn't lose work).
    isActive: {
      type: Boolean,
      default: true,
    },
    // Display order in language switchers/pickers, ascending.
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

const LanguageModel = mongoose.model("language", languageSchema);

export default LanguageModel;
