/**
 * scripts/translateUiLocales.js
 *
 * Translates the hardcoded UI-copy locale files (admin/src/i18n/locales/*.js
 * and client/src/i18n/locales/*.js — nav labels, buttons, form labels, empty
 * states, everything NOT stored in the database) using the same OpenAI
 * pipeline as the content translation system
 * (services/ai/openaiTranslationClient.js), instead of the DB-backed
 * Translation collection that scripts/bulkTranslateContent.js writes to.
 *
 * These are two genuinely different translation systems on purpose:
 *   - bulkTranslateContent.js  → database content (products, blog posts,
 *     categories, banners, etc.) → Translation collection → read at
 *     request time via getTranslation()/applyTranslation().
 *   - translateUiLocales.js (this file) → static UI chrome hardcoded in the
 *     admin/client React apps → a committed .js file per language, bundled
 *     at build time like any other source file.
 *
 * WHERE THIS RUNS: unlike every other script in this folder, this one reads
 * and writes files in the ADMIN and CLIENT repos, not just the database —
 * those are separate repos/folders from this server repo. By default it
 * looks for them as sibling folders (../../icvng-admin, ../../icvng-client
 * relative to this file, i.e. next to icvng-server/) — override with
 * --admin-dir=/path/to/icvng-admin and/or --client-dir=/path/to/icvng-client
 * if your folder layout differs.
 *
 * Incremental by default: for each language, any key that already has a
 * non-empty translated value in the existing locale file is left alone —
 * so re-running after hand-editing a specific string, or after adding a
 * handful of new keys to en.js, only translates what's actually
 * missing/still empty. Pass --force to fully regenerate every key from
 * scratch (overwrites hand edits — used mainly right after first adding a
 * new language, or after a big change to en.js you want machine-retranslated
 * wholesale).
 *
 * Usage:
 *   node scripts/translateUiLocales.js
 *     → both apps (admin + client), every language listed in NEW_LANGUAGES
 *       below that doesn't already have a locale file with content
 *
 *   node scripts/translateUiLocales.js --languages=es,pt,nl,ar,hi,zh
 *     → explicit language list (this is what adding a brand new language
 *       going forward looks like — see the header comment in
 *       config/countries/index.js's GLOBAL_EXTRA_LANGUAGES)
 *
 *   node scripts/translateUiLocales.js --app=admin --languages=es
 *     → just the admin panel, just Spanish
 *
 *   node scripts/translateUiLocales.js --force --languages=fr
 *     → fully regenerate French from scratch (overwrites any hand edits —
 *       use deliberately, not as a routine re-run)
 *
 *   node scripts/translateUiLocales.js --dry-run
 *     → report how many keys would be translated per app/language,
 *       without calling OpenAI or writing anything
 */

// IMPORTANT: must be the very first import. Unlike bulkTranslateContent.js
// (which imports connectDB.js, and that file happens to call
// dotenv.config() as a side effect), this script never touches MongoDB and
// so never picked up the .env file at all — OPENAI_API_KEY (and anything
// else in .env) was always undefined here, regardless of what was actually
// in the file. See the same fix/explanation at the top of index.js.
import "dotenv/config";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import fs from "fs/promises";
import { translateBatchAIDetailed } from "../services/ai/openaiTranslationClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Languages this script knows the native display name for (used only in
// the generated file's header comment — the actual translation works for
// any language code OpenAI understands, this is just cosmetic).
const LANGUAGE_NAMES = {
  fr: "French", it: "Italian", es: "Spanish", pt: "Portuguese",
  nl: "Dutch", ar: "Arabic", hi: "Hindi", zh: "Mandarin Chinese",
};

// Default set to backfill when --languages isn't passed — the 6 newly
// added site-wide languages (see GLOBAL_EXTRA_LANGUAGES in
// config/countries/index.js). fr/it aren't in this default list since they
// already have complete hand/AI-maintained locale files; pass
// --languages=fr,it explicitly if you actually want to touch those.
const NEW_LANGUAGES = ["es", "pt", "nl", "ar", "hi", "zh"];

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
const requestedLanguages = getList("languages") || NEW_LANGUAGES;
const FORCE = args.includes("--force");
const DRY_RUN = args.includes("--dry-run");

const ADMIN_DIR = getArg("admin-dir") || path.resolve(__dirname, "../../icvng-admin");
const CLIENT_DIR = getArg("client-dir") || path.resolve(__dirname, "../../icvng-client");

const APP_DIRS = { admin: ADMIN_DIR, client: CLIENT_DIR };

// ── Flatten / unflatten nested locale objects ────────────────────────────

/** { a: { b: "x", c: "y" } } → [["a.b", "x"], ["a.c", "y"]] (strings only —
 * locale files are pure string trees; anything else is left alone/ignored,
 * since there shouldn't be non-string leaves in a copy file). */
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

/** Set a dot-path on a (possibly nested) object, creating intermediate
 * objects as needed. Mutates and returns `target`. */
function setPath(target, path_, value) {
  const parts = path_.split(".");
  let node = target;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!node[parts[i]] || typeof node[parts[i]] !== "object") node[parts[i]] = {};
    node = node[parts[i]];
  }
  node[parts[parts.length - 1]] = value;
  return target;
}

function getPath(obj, path_) {
  return path_.split(".").reduce((n, k) => (n && typeof n === "object" ? n[k] : undefined), obj);
}

// ── File I/O ──────────────────────────────────────────────────────────────

async function loadLocaleModule(filePath) {
  try {
    await fs.access(filePath);
  } catch {
    return {}; // doesn't exist yet — treat as empty
  }
  // Cache-bust with a query string so repeated runs in the same process
  // (multiple languages/apps in one invocation) don't get a stale cached
  // module for a file this same script just wrote.
  const mod = await import(`${pathToFileURL(filePath).href}?t=${Date.now()}`);
  return mod.default || {};
}

function serializeLocale(app, lang, obj) {
  const header =
    `/**\n` +
    ` * ${app}/src/i18n/locales/${lang}.js — ${LANGUAGE_NAMES[lang] || lang}\n` +
    ` *\n` +
    ` * Generated/updated by scripts/translateUiLocales.js (icvng-server repo).\n` +
    ` * Machine-translated via OpenAI from en.js. Safe to hand-edit individual\n` +
    ` * strings afterward — a normal (non---force) re-run of the script leaves\n` +
    ` * any key that already has a non-empty value here untouched, so hand\n` +
    ` * edits survive incremental re-runs (only genuinely new/missing keys get\n` +
    ` * (re)translated). Pass --force to wipe and fully regenerate instead.\n` +
    ` */\n`;
  return header + `export default ${JSON.stringify(obj, null, 2)};\n`;
}

// ── Main per-(app, language) worker ──────────────────────────────────────

async function translateOne(app, lang, appDir) {
  const localesDir = path.join(appDir, "src", "i18n", "locales");
  const enPath = path.join(localesDir, "en.js");
  const targetPath = path.join(localesDir, `${lang}.js`);

  const enModule = await loadLocaleModule(enPath);
  const enFlat = flatten(enModule);

  if (enFlat.length === 0) {
    console.warn(`  ⚠️  ${app}: en.js not found or empty at ${enPath} — skipping.`);
    return { translated: 0, skipped: 0, failed: 0 };
  }

  const existing = FORCE ? {} : await loadLocaleModule(targetPath);

  const toTranslate = enFlat.filter(([key]) => {
    const existingValue = getPath(existing, key);
    return !existingValue || typeof existingValue !== "string" || existingValue.trim() === "";
  });

  console.log(
    `  ${app}/${lang}: ${enFlat.length} total key(s), ${toTranslate.length} to translate` +
      `${FORCE ? " (--force: regenerating everything)" : ""}`,
  );

  if (toTranslate.length === 0) {
    return { translated: 0, skipped: enFlat.length, failed: 0 };
  }

  if (DRY_RUN) {
    console.log(`  (dry run — not calling OpenAI or writing ${targetPath})`);
    return { translated: 0, skipped: enFlat.length - toTranslate.length, failed: 0 };
  }

  const texts = toTranslate.map(([, value]) => value);
  const { results, succeeded, failedCount, lastError } = await translateBatchAIDetailed(
    texts,
    "en",
    lang,
  );

  if (failedCount > 0) {
    console.error(
      `  ⚠️  ${app}/${lang}: ${failedCount} of ${texts.length} key(s) failed to translate. ` +
        `Last error: ${lastError}. See [openaiTranslationClient] log lines above for details. ` +
        `Failed keys are left out of this run's output (existing/English values untouched) — ` +
        `re-run the script (without --force) to retry just those.`,
    );
  }

  const merged = { ...existing };
  toTranslate.forEach(([key], idx) => {
    if (succeeded[idx]) setPath(merged, key, results[idx]);
  });

  await fs.writeFile(targetPath, serializeLocale(app, lang, merged), "utf8");
  console.log(`  ✅ ${app}/${lang}: wrote ${targetPath}`);

  return {
    translated: toTranslate.filter((_, i) => succeeded[i]).length,
    skipped: enFlat.length - toTranslate.length,
    failed: failedCount,
  };
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error(
      "OPENAI_API_KEY is not set — this script talks to OpenAI directly (same client as the " +
        "content translation pipeline). Set it in this repo's .env before running.",
    );
    process.exit(1);
  }

  console.log(`Apps:      ${requestedApps.join(", ")}`);
  console.log(`Languages: ${requestedLanguages.join(", ")}`);
  if (FORCE) console.log("(--force: wiping and fully regenerating every key)");
  if (DRY_RUN) console.log("(DRY RUN — nothing will be translated or written)");

  const totals = { translated: 0, skipped: 0, failed: 0 };

  for (const app of requestedApps) {
    const appDir = APP_DIRS[app];
    if (!appDir) {
      console.warn(`⚠️  Unknown app "${app}" (expected "admin" or "client") — skipping.`);
      continue;
    }
    try {
      await fs.access(path.join(appDir, "src", "i18n", "locales"));
    } catch {
      console.error(
        `❌ Can't find ${app}'s i18n/locales folder at ${appDir}/src/i18n/locales. ` +
          `Pass --${app}-dir=/correct/path/to/icvng-${app} if your folders aren't laid out as ` +
          `siblings of icvng-server (the default assumption).`,
      );
      continue;
    }

    console.log(`\n=== ${app} (${appDir}) ===`);
    for (const lang of requestedLanguages) {
      const r = await translateOne(app, lang, appDir);
      totals.translated += r.translated;
      totals.skipped += r.skipped;
      totals.failed += r.failed;
    }
  }

  console.log(
    `\n✅ Done. Totals: ${totals.translated} key(s) translated, ${totals.skipped} already had a ` +
      `value (left alone), ${totals.failed} failed.`,
  );
  console.log(
    "   Rebuild/redeploy admin and client for the new locale files to take effect.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Failed:", err);
  process.exit(1);
});
