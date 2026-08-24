/**
 * scripts/seedLanguages.js
 *
 * Seeds the `language` collection (models/language.model.js) with the 9
 * languages the platform already agrees on everywhere else — this is the
 * SAME set as:
 *   - ALL_SUPPORTED_LANGUAGES (config/countries/index.js: the 3 per-country
 *     languages en/fr/it, plus GLOBAL_EXTRA_LANGUAGES es/pt/nl/ar/hi/zh) —
 *     this is what the content-translation pipeline (Translation model,
 *     translationService.js, bulkTranslateContent.js) already accepts.
 *   - SUPPORTED_LANGUAGES / LANGUAGE_NAMES / RTL_LANGUAGES in
 *     admin/src/i18n/index.js and client/src/i18n/index.js — the UI-chrome
 *     locale files, independently maintained but already listing the same
 *     9 codes with the same native names.
 *
 * Before this script, that 9-language "lib" only existed as hardcoded
 * arrays baked into source (and in a few admin screens — see PRD §10 —
 * only 2 of the 9 were ever actually wired up: fr/it). This gives the lib
 * a database row per language so the new Language CRUD
 * (admin/src/pages/settings/LanguageManagement.jsx +
 * controllers/language.controller.js) has something to manage, and so the
 * client/admin language switchers can eventually read the active list from
 * the DB instead of a hardcoded array (GET /api/languages/active).
 *
 * Idempotent — safe to re-run; upserts by `code`, never overwrites a field
 * you've since edited via the admin CRUD unless you pass --force.
 *
 * Run:
 *   node scripts/seedLanguages.js            → insert-only (skips existing codes)
 *   node scripts/seedLanguages.js --force     → also overwrite existing rows
 *                                                back to these defaults
 */

import dotenv from "dotenv";
import connectDB from "../config/connectDB.js";
import LanguageModel from "../models/language.model.js";

dotenv.config();

// Matches admin/src/i18n/index.js + client/src/i18n/index.js exactly
// (SUPPORTED_LANGUAGES / LANGUAGE_NAMES / RTL_LANGUAGES) and
// config/countries/index.js's ALL_SUPPORTED_LANGUAGES (en/fr/it from
// COUNTRY_CONFIG + GLOBAL_EXTRA_LANGUAGES es/pt/nl/ar/hi/zh).
const LANGUAGES = [
  { code: "en", name: "English", nativeName: "English", flagEmoji: "🇬🇧", isRTL: false, sortOrder: 0 },
  { code: "fr", name: "French", nativeName: "Français", flagEmoji: "🇫🇷", isRTL: false, sortOrder: 1 },
  { code: "it", name: "Italian", nativeName: "Italiano", flagEmoji: "🇮🇹", isRTL: false, sortOrder: 2 },
  { code: "es", name: "Spanish", nativeName: "Español", flagEmoji: "🇪🇸", isRTL: false, sortOrder: 3 },
  { code: "pt", name: "Portuguese", nativeName: "Português", flagEmoji: "🇵🇹", isRTL: false, sortOrder: 4 },
  { code: "nl", name: "Dutch", nativeName: "Nederlands", flagEmoji: "🇳🇱", isRTL: false, sortOrder: 5 },
  { code: "ar", name: "Arabic", nativeName: "العربية", flagEmoji: "🇸🇦", isRTL: true, sortOrder: 6 },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", flagEmoji: "🇮🇳", isRTL: false, sortOrder: 7 },
  { code: "zh", name: "Chinese", nativeName: "中文", flagEmoji: "🇨🇳", isRTL: false, sortOrder: 8 },
];

async function main() {
  const force = process.argv.includes("--force");

  await connectDB();
  console.log(`→ Seeding language lib (${LANGUAGES.length} languages)${force ? " [--force: overwriting existing rows]" : ""} …`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const lang of LANGUAGES) {
    const existing = await LanguageModel.findOne({ code: lang.code });
    if (!existing) {
      await LanguageModel.create({ ...lang, isActive: true });
      created += 1;
      console.log(`  + created ${lang.code} (${lang.nativeName})`);
    } else if (force) {
      await LanguageModel.updateOne(
        { code: lang.code },
        { $set: { ...lang } }, // isActive intentionally left alone even with --force —
                                // don't silently re-activate a language an admin turned off.
      );
      updated += 1;
      console.log(`  ~ updated ${lang.code} (${lang.nativeName})`);
    } else {
      skipped += 1;
      console.log(`  · skipped ${lang.code} (already exists — pass --force to overwrite)`);
    }
  }

  console.log(`✅ Done. Created: ${created}, updated: ${updated}, skipped: ${skipped}.`);
  console.log(
    "\nNext step — backfill existing product/category/subCategory/blog/etc. " +
      "content into whichever of these are new for this deployment:\n" +
      "  node scripts/bulkTranslateContent.js --languages=es,pt,nl,ar,hi,zh\n" +
      "(add --entities=... to target specific content types, --dry-run to preview — see that script's header.)",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
