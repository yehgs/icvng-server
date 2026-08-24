/**
 * scripts/seedUiTranslations.js
 *
 * Inputs the hardcoded UI-copy locale files
 * (admin/src/i18n/locales/*.js and client/src/i18n/locales/*.js — nav
 * labels, buttons, empty states, everything NOT stored in the database)
 * into the new `uiTranslation` collection (models/uiTranslation.model.js),
 * across all languages present in each app's locale folder — currently 9
 * per app (en, fr, it, es, pt, nl, ar, hi, zh — see i18n/index.js's
 * SUPPORTED_LANGUAGES in both apps).
 *
 * This is the DB counterpart to scripts/translateUiLocales.js: that script
 * generates/updates the *static files themselves* (via OpenAI, written to
 * disk). This script takes whatever those files currently contain and
 * copies them into the database, which is what
 * UiTranslationsManagement.jsx (admin CRUD) and the live apps' i18n
 * loaders (i18n/index.js in both apps — see applyDbOverrides()) actually
 * read from at runtime. Run this once to get started, and again any time
 * en.js (or another locale file) gains new keys.
 *
 * Manual-edit protection, same discipline as the content-translation
 * pipeline (translationService.js) and seedLanguages.js: a row an admin
 * has hand-edited via the CRUD page (`isEdited: true`) is left alone on a
 * normal re-run — only missing/never-edited rows are (re)written from the
 * static files. Pass --force-edited to override that and blow away hand
 * edits too (rare — mainly right after a big rewrite of a static locale
 * file that should now be considered the new source of truth).
 *
 * WHERE THIS RUNS: like translateUiLocales.js, this reads files from the
 * ADMIN and CLIENT repos, not just this server repo — sibling folders by
 * default (../../icvng-admin, ../../icvng-client relative to this file),
 * override with --admin-dir=/--client-dir=.
 *
 * Usage:
 *   node scripts/seedUiTranslations.js
 *     → both apps, every language file found in each app's locales/ folder
 *
 *   node scripts/seedUiTranslations.js --app=admin
 *     → just the admin panel
 *
 *   node scripts/seedUiTranslations.js --languages=es,pt,nl,ar,hi,zh
 *     → restrict to specific languages (en is always included regardless —
 *       it's the baseline every key list is built from)
 *
 *   node scripts/seedUiTranslations.js --force-edited
 *     → also overwrite rows an admin has hand-edited via the CRUD page
 *       (normally skipped — see "Manual-edit protection" above)
 *
 *   node scripts/seedUiTranslations.js --dry-run
 *     → report how many rows would be created/updated/skipped per
 *       app/language, without writing anything
 */

import "dotenv/config";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import fs from "fs/promises";
import connectDB from "../config/connectDB.js";
import UiTranslationModel from "../models/uiTranslation.model.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const getArg = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : null;
};
const getList = (name) => {
  const raw = getArg(name);
  return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : null;
};

const requestedApps = getList("app") || ["admin", "client"];
const requestedLanguages = getList("languages"); // null = every file found
const FORCE_EDITED = args.includes("--force-edited");
const DRY_RUN = args.includes("--dry-run");

const ADMIN_DIR = getArg("admin-dir") || path.resolve(__dirname, "../../icvng-admin");
const CLIENT_DIR = getArg("client-dir") || path.resolve(__dirname, "../../icvng-client");
const APP_DIRS = { admin: ADMIN_DIR, client: CLIENT_DIR };

// ── Flatten nested locale objects (same shape as translateUiLocales.js) ──

function flatten(obj, prefix = "") {
  const out = [];
  for (const [key, value] of Object.entries(obj || {})) {
    const path_ = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out.push(...flatten(value, path_));
    } else if (typeof value === "string") {
      out.push([path_, value]);
    }
  }
  return out;
}

async function loadLocaleModule(filePath) {
  try {
    await fs.access(filePath);
  } catch {
    return null; // file doesn't exist
  }
  const mod = await import(`${pathToFileURL(filePath).href}?t=${Date.now()}`);
  return mod.default || {};
}

async function listLocaleFiles(localesDir) {
  try {
    const entries = await fs.readdir(localesDir);
    return entries
      .filter((f) => f.endsWith(".js"))
      .map((f) => f.replace(/\.js$/, ""));
  } catch {
    return [];
  }
}

// ── Per-app worker ────────────────────────────────────────────────────────

async function seedApp(app) {
  const appDir = APP_DIRS[app];
  const localesDir = path.join(appDir, "src", "i18n", "locales");

  const filesFound = await listLocaleFiles(localesDir);
  if (filesFound.length === 0) {
    console.log(`  (no locale files found under ${localesDir} — skipping ${app})`);
    return { created: 0, updated: 0, skippedEdited: 0, skippedUnchanged: 0 };
  }

  const languages = (requestedLanguages
    ? Array.from(new Set(["en", ...requestedLanguages]))
    : filesFound
  ).filter((lang) => filesFound.includes(lang));

  let created = 0;
  let updated = 0;
  let skippedEdited = 0;
  let skippedUnchanged = 0;

  for (const lang of languages) {
    const filePath = path.join(localesDir, `${lang}.js`);
    const mod = await loadLocaleModule(filePath);
    if (!mod) {
      console.log(`  · ${app}/${lang}: file not found, skipping`);
      continue;
    }
    const flat = flatten(mod);
    console.log(`  → ${app}/${lang}: ${flat.length} keys`);

    for (const [key, value] of flat) {
      if (DRY_RUN) {
        created += 1; // dry-run: just count what WOULD be touched, don't distinguish create/update
        continue;
      }

      const existing = await UiTranslationModel.findOne({ app, key, language: lang });
      if (existing) {
        if (existing.isEdited && !FORCE_EDITED) {
          skippedEdited += 1;
          continue;
        }
        if (existing.value === value && !existing.isEdited) {
          skippedUnchanged += 1;
          continue;
        }
        existing.value = value;
        if (FORCE_EDITED) existing.isEdited = false; // re-seeding over a hand-edit resets it to "from file" status
        await existing.save();
        updated += 1;
      } else {
        await UiTranslationModel.create({ app, key, language: lang, value, isEdited: false });
        created += 1;
      }
    }
  }

  return { created, updated, skippedEdited, skippedUnchanged };
}

async function main() {
  if (!DRY_RUN) await connectDB();

  console.log(
    `→ Seeding UI translations${DRY_RUN ? " [DRY RUN]" : ""} — apps: ${requestedApps.join(", ")}` +
      (requestedLanguages ? `, languages: en,${requestedLanguages.join(",")}` : ", languages: all found") +
      (FORCE_EDITED ? " [--force-edited: overwriting hand edits too]" : ""),
  );

  const totals = { created: 0, updated: 0, skippedEdited: 0, skippedUnchanged: 0 };
  for (const app of requestedApps) {
    console.log(`\n${app}:`);
    const r = await seedApp(app);
    totals.created += r.created;
    totals.updated += r.updated;
    totals.skippedEdited += r.skippedEdited;
    totals.skippedUnchanged += r.skippedUnchanged;
  }

  console.log(
    `\n✅ Done. Created: ${totals.created}, updated: ${totals.updated}, ` +
      `skipped (hand-edited): ${totals.skippedEdited}, skipped (unchanged): ${totals.skippedUnchanged}.`,
  );
  if (DRY_RUN) console.log("(dry run — nothing was written)");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
