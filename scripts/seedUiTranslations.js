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
 * normal re-run, and a row whose value already matches the file is a
 * no-op — only missing or genuinely-changed rows are written. That's why
 * re-running the script on data it already imported reports mostly
 * "skipped (unchanged)" — that's expected, not a failure, it means the DB
 * already matches the files. Pass --force to bypass BOTH of those checks
 * and unconditionally reimport every key from the files (overwrites hand
 * edits too — use deliberately, e.g. right after a locale file was
 * rewritten wholesale and should now be treated as the new source of
 * truth for everything, not just what's missing).
 *
 * WHERE THIS RUNS: like translateUiLocales.js, this reads files from the
 * ADMIN and CLIENT repos, not just this server repo — sibling folders by
 * default (../../icvng-admin, ../../icvng-client relative to this file),
 * override with --admin-dir=/--client-dir=.
 *
 * Usage:
 *   node scripts/seedUiTranslations.js
 *     → both apps, every language file found in each app's locales/ folder.
 *       Incremental — only creates missing rows and updates genuinely
 *       changed ones; already-imported unchanged rows are skipped on
 *       purpose (see "Manual-edit protection" above).
 *
 *   node scripts/seedUiTranslations.js --app=admin
 *     → just the admin panel
 *
 *   node scripts/seedUiTranslations.js --languages=es,pt,nl,ar,hi,zh
 *     → restrict to specific languages (en is always included regardless —
 *       it's the baseline every key list is built from)
 *
 *   node scripts/seedUiTranslations.js --force
 *     → full unconditional reimport: every key/language gets its value
 *       overwritten from the file, nothing is skipped — including rows
 *       an admin hand-edited via the CRUD page (isEdited is reset to
 *       false, since the file is being treated as authoritative again).
 *       This is what "reimport everything, don't skip what's already
 *       there" means.
 *
 *   node scripts/seedUiTranslations.js --dry-run
 *     → report how many rows would be created/updated/skipped per
 *       app/language, without writing anything (respects --force too, so
 *       you can preview exactly what a --force run would touch)
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
const FORCE = args.includes("--force");
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
      const existing = await UiTranslationModel.findOne({ app, key, language: lang });

      if (existing) {
        if (!FORCE) {
          if (existing.isEdited) {
            skippedEdited += 1;
            continue;
          }
          if (existing.value === value) {
            skippedUnchanged += 1;
            continue;
          }
        }
        // --force reaches here even when isEdited or value-matches would
        // otherwise have skipped it — that's the "don't skip already
        // imported data" behavior.
        if (DRY_RUN) {
          updated += 1;
          continue;
        }
        existing.value = value;
        if (FORCE) existing.isEdited = false; // file is authoritative again
        await existing.save();
        updated += 1;
      } else {
        if (DRY_RUN) {
          created += 1;
          continue;
        }
        await UiTranslationModel.create({ app, key, language: lang, value, isEdited: false });
        created += 1;
      }
    }
  }

  return { created, updated, skippedEdited, skippedUnchanged };
}

async function main() {
  // Dry-run now reads the DB too (to report accurate created/updated/
  // skipped counts, not just a lump estimate) — only writes are skipped,
  // so the connection is needed either way.
  await connectDB();

  console.log(
    `→ Seeding UI translations${DRY_RUN ? " [DRY RUN]" : ""} — apps: ${requestedApps.join(", ")}` +
      (requestedLanguages ? `, languages: en,${requestedLanguages.join(",")}` : ", languages: all found") +
      (FORCE ? " [--force: reimporting everything, including hand edits]" : ""),
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
