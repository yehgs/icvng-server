/**
 * models/uiTranslation.model.js
 *
 * The hardcoded UI-copy layer (nav labels, buttons, empty states — every
 * string in admin/src/i18n/locales/*.js and client/src/i18n/locales/*.js)
 * made database-editable. Previously the ONLY way to change one of these
 * strings was: edit the .js file in the repo → commit → redeploy. This
 * collection lets an admin edit a string live from
 * UiTranslationsManagement.jsx and have it take effect immediately,
 * without a code deploy — while the bundled .js files remain the
 * always-available offline/first-paint fallback (see i18n/index.js in both
 * apps: EFFECTIVE = static MERGED, overlaid with whatever this collection
 * returns for the current app+language).
 *
 * One document per (app, key, language) — `key` is the dot-path into the
 * nested locale object (e.g. "common.save", "productForm.pricingHint").
 * `app` distinguishes admin vs client since their key sets are independent
 * (built separately, most keys don't overlap).
 *
 * Seeded from the existing static locale files via
 * scripts/seedUiTranslations.js — that script is what first populates this
 * collection with the ~2,300 admin / ~750 client keys across all 9
 * languages; this model doesn't do anything on its own until that's run.
 */

import mongoose from "mongoose";

const uiTranslationSchema = new mongoose.Schema(
  {
    app: {
      type: String,
      enum: ["admin", "client"],
      required: true,
    },
    // Dot-path key into the nested locale object, e.g. "common.save".
    key: {
      type: String,
      required: true,
      trim: true,
    },
    language: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    value: {
      type: String,
      default: "",
    },
    // true once an admin has hand-edited this row via the CRUD page (vs.
    // still holding whatever seedUiTranslations.js last wrote). Mirrors
    // the `autoTranslated`-style manual-edit protection already used for
    // database content (see translation.model.js /
    // translationService.js) — the seed script's default (non --force-edited)
    // run skips any row with isEdited: true, so re-seeding after adding new
    // keys to en.js never clobbers something an admin has already tuned.
    isEdited: {
      type: Boolean,
      default: false,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
    },
  },
  { timestamps: true },
);

uiTranslationSchema.index({ app: 1, key: 1, language: 1 }, { unique: true });
// Powers the bulk "give me everything for this app+language" fetch that
// the live apps call on boot/language-change.
uiTranslationSchema.index({ app: 1, language: 1 });

const UiTranslationModel = mongoose.model("uiTranslation", uiTranslationSchema);

export default UiTranslationModel;
