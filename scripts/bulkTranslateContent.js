/**
 * scripts/bulkTranslateContent.js
 *
 * Backfills AI translations (OpenAI, via translateEntity() — the same
 * pipeline the admin panel's "Auto" button and auto-on-save both use) for
 * existing content that predates this pipeline being wired up/reliable, or
 * for a newly-added language that every existing record needs to catch up
 * on.
 *
 * FULLY DYNAMIC (this used to be hardcoded to just Product + BlogPost):
 *   - Entity types are discovered from TRANSLATABLE_FIELDS
 *     (utils/translationService.js) via ENTITY_REGISTRY below — product,
 *     category, subCategory, blog, blogCategory, blogTag, banner, slider,
 *     fomo, notification, coupon, country, homeContentBlock, tag,
 *     attribute, color. Anything added to TRANSLATABLE_FIELDS in the future
 *     needs a one-line addition to ENTITY_REGISTRY below (Model import) to
 *     be picked up here — everything else is automatic.
 *   - Target languages default to every language in ALL_SUPPORTED_LANGUAGES
 *     (config/countries/index.js — this already includes both the
 *     per-country languages like fr/it AND the site-wide GLOBAL_EXTRA_LANGUAGES
 *     like es/pt/nl/ar/hi/zh), or restrict with --languages.
 *
 * This means adding a brand new language to the site going forward is just:
 *   1. Add the code to GLOBAL_EXTRA_LANGUAGES in config/countries/index.js
 *      (and its native display name in i18n/index.js, client + admin).
 *   2. node scripts/bulkTranslateContent.js --languages=<newcode>
 *      to backfill every existing record into just that new language,
 *      without re-translating languages that already have a full pass.
 *
 * Respects the existing "don't clobber a human's manual edits" guard
 * inside translateEntity() automatically. Safe to re-run — partial or
 * previously-failed runs (e.g. from a bad API key) simply get retried for
 * whatever didn't succeed last time, since a field that's still missing/
 * still auto-translated gets attempted again.
 *
 * Usage:
 *   node scripts/bulkTranslateContent.js
 *     → every entity type, every supported language
 *
 *   node scripts/bulkTranslateContent.js --entities=product
 *     → just products, every supported language (this is what you want to
 *       fully backfill products including fr/it, not just the new
 *       languages — see the walkthrough in the PR/chat this shipped with)
 *
 *   node scripts/bulkTranslateContent.js --entities=blog,category,subCategory,banner,slider,blogCategory,blogTag,fomo,notification,coupon,country,homeContentBlock,tag,attribute,color --languages=es,pt,nl,ar,hi,zh
 *     → every non-product entity type, but ONLY the newly-added languages
 *       (skips fr/it, which already have a translation pass)
 *
 *   node scripts/bulkTranslateContent.js --entities=category,subCategory --languages=fr,it
 *     → catch up categories/subcategories specifically for fr/it (these
 *       were never covered by the old product/blog-only script)
 *
 *   node scripts/bulkTranslateContent.js --limit=20 --dry-run
 *     → preview without calling OpenAI or writing anything
 *
 *   --only=... is accepted as an alias for --entities=... (matches the
 *   flag name from the previous version of this script).
 *
 * RESUMABILITY: by default, a field that already has a translated value
 * for a language is left alone on a re-run (skipExisting) — so if a run
 * gets interrupted (dropped DB connection, Ctrl+C, a bad API key
 * discovered partway through), just run the exact same command again and
 * it picks up only what's still missing, instead of re-translating (and
 * re-billing OpenAI for) everything from scratch. Pass --force to disable
 * this and fully re-translate every field regardless of what's already
 * there (e.g. after a source-content edit you want reflected everywhere).
 */

import connectDB from "../config/connectDB.js";
import { ALL_SUPPORTED_LANGUAGES } from "../config/countries/index.js";
import { translateEntity, TRANSLATABLE_FIELDS } from "../utils/translationService.js";

import ProductModel from "../models/product.model.js";
import CategoryModel from "../models/category.model.js";
import SubCategoryModel from "../models/subCategory.model.js";
import BlogPostModel from "../models/blog-post.model.js";
import BlogCategoryModel from "../models/blog-category.model.js";
import BlogTagModel from "../models/blog-tag.model.js";
import BannerModel from "../models/banner.model.js";
import SliderModel from "../models/slider.model.js";
import FomoModel from "../models/fomo.model.js";
import NotificationModel from "../models/notification.model.js";
import CouponModel from "../models/coupon.model.js";
import CountryModel from "../models/country.model.js";
import HomeContentBlockModel from "../models/homeContentBlock.model.js";
import TagModel from "../models/tag.model.js";
import AttributeModel from "../models/attribute.model.js";
import { ColorModel } from "../models/color.model.js";

// entityType (matches TRANSLATABLE_FIELDS keys exactly) → Mongoose model.
// This is the ONLY place that needs a new line when a new translatable
// entity type is added to TRANSLATABLE_FIELDS in translationService.js.
const ENTITY_REGISTRY = {
  product: ProductModel,
  category: CategoryModel,
  subCategory: SubCategoryModel,
  blog: BlogPostModel,
  blogCategory: BlogCategoryModel,
  blogTag: BlogTagModel,
  banner: BannerModel,
  slider: SliderModel,
  fomo: FomoModel,
  notification: NotificationModel,
  coupon: CouponModel,
  country: CountryModel,
  homeContentBlock: HomeContentBlockModel,
  tag: TagModel,
  attribute: AttributeModel,
  color: ColorModel,
  // "brand" is intentionally absent — brand names are proper nouns and are
  // never translated (see TRANSLATABLE_FIELDS in translationService.js).
};

const DELAY_MS = 300; // small pause between entities to stay polite to the OpenAI rate limit

const args = process.argv.slice(2);
const getArg = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : null;
};
const getList = (name) => {
  const raw = getArg(name);
  return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : null;
};

const requestedEntities = getList("entities") || getList("only"); // --only kept as an alias
const requestedLanguages = getList("languages");
const LIMIT = getArg("limit") ? parseInt(getArg("limit"), 10) : null;
const DRY_RUN = args.includes("--dry-run");
const FORCE = args.includes("--force"); // disables skipExisting — fully re-translate everything

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Retry a flaky async op (e.g. a DB query hitting a transient network
 * blip) a few times with backoff before giving up. Used around the initial
 * Model.find() in runBatch() — that query itself wasn't wrapped in any
 * try/catch before, so a single transient connection hiccup fetching the
 * list of documents crashed the ENTIRE script (every entity type, not
 * just the one being fetched) instead of just that one batch. */
async function withRetry(fn, { retries = 3, baseDelayMs = 2000, label = "operation" } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const delay = baseDelayMs * 2 ** attempt;
        console.warn(
          `  ⚠️  ${label} failed (attempt ${attempt + 1}/${retries + 1}): ${err.message} — retrying in ${delay / 1000}s...`,
        );
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

function resolveEntityTypes() {
  const available = Object.keys(TRANSLATABLE_FIELDS).filter((k) => ENTITY_REGISTRY[k]);

  // Warn about anything in TRANSLATABLE_FIELDS that has no registry entry
  // yet — silently skipping would make it look like nothing needed doing.
  const missingModel = Object.keys(TRANSLATABLE_FIELDS).filter((k) => !ENTITY_REGISTRY[k]);
  if (missingModel.length) {
    console.warn(
      `⚠️  These entityTypes are in TRANSLATABLE_FIELDS but have no Model wired up in ` +
        `ENTITY_REGISTRY (scripts/bulkTranslateContent.js) — skipping: ${missingModel.join(", ")}`,
    );
  }

  if (!requestedEntities) return available;

  const unknown = requestedEntities.filter((e) => !available.includes(e));
  if (unknown.length) {
    console.warn(
      `⚠️  Unknown/unregistered --entities value(s), ignoring: ${unknown.join(", ")}. ` +
        `Available: ${available.join(", ")}`,
    );
  }
  return requestedEntities.filter((e) => available.includes(e));
}

function resolveLanguages() {
  if (requestedLanguages && requestedLanguages.length) return requestedLanguages;
  return ALL_SUPPORTED_LANGUAGES.filter((l) => l !== "en");
}

async function runBatch(entityType, Model, targetLangs) {
  const fields = TRANSLATABLE_FIELDS[entityType];

  // Wrapped in withRetry: this used to be a bare `await Model.find()...`
  // with no error handling at all, so a transient DB connection blip here
  // took down the entire script (every entity type in the run), not just
  // this one batch.
  const docs = await withRetry(
    async () => {
      let query = Model.find().sort({ createdAt: 1 });
      if (LIMIT) query = query.limit(LIMIT);
      return query;
    },
    { label: `${entityType}: fetching document list` },
  );

  console.log(
    `\n→ ${entityType} (${fields.join(", ")}): ${docs.length} record(s) × ` +
      `[${targetLangs.join(", ")}]${LIMIT ? ` (limited to ${LIMIT})` : ""}` +
      `${FORCE ? " (--force: re-translating everything)" : " (resumable — skips already-translated fields)"}`,
  );

  let ok = 0;
  let alreadyDone = 0; // every language for this doc was already fully translated — not a failure
  let partial = 0;
  let skipped = 0;
  let failed = 0;

  for (const [i, doc] of docs.entries()) {
    const idLabel = doc.name || doc.title || doc.notificationMessage || doc.message || doc.code || doc._id.toString();
    process.stdout.write(`  [${i + 1}/${docs.length}] ${idLabel} … `);

    if (DRY_RUN) {
      console.log("(dry run, skipped)");
      continue;
    }

    try {
      const outcome = await withRetry(
        () =>
          translateEntity({
            entityType,
            entityId: doc._id,
            document: doc.toObject(),
            targetLangs,
            skipExisting: !FORCE,
          }),
        { label: `${entityType}:${doc._id}`, retries: 2 },
      );

      if (!outcome) {
        console.log("no-op (no translatable fields)");
        skipped++;
      } else if (outcome.ok) {
        console.log("ok");
        ok++;
      } else {
        const statuses = Object.values(outcome.results || {}).map((r) => r.status);
        const allAlreadyDone = statuses.length > 0 && statuses.every((s) => s === "skipped");
        if (allAlreadyDone) {
          console.log("already translated (nothing to do)");
          alreadyDone++;
        } else {
          const langs = Object.entries(outcome.results || {})
            .map(([lang, r]) => `${lang}:${r.status}`)
            .join(", ");
          console.log(`partial/failed (${langs || outcome.error})`);
          partial++;
        }
      }
    } catch (err) {
      console.log(`ERROR — ${err.message}`);
      failed++;
    }

    await sleep(DELAY_MS);
  }

  console.log(
    `  ${entityType} summary: ${ok} ok, ${alreadyDone} already done, ${partial} partial/failed, ${skipped} no-op, ${failed} errored`,
  );
  return { ok, alreadyDone, partial, skipped, failed };
}

async function main() {
  await connectDB();

  const entityTypes = resolveEntityTypes();
  const targetLangs = resolveLanguages();

  if (entityTypes.length === 0) {
    console.error("No valid entity types to run. Check --entities= / --only=.");
    process.exit(1);
  }

  console.log(`Entity types: ${entityTypes.join(", ")}`);
  console.log(`Languages:    ${targetLangs.join(", ")}`);
  if (DRY_RUN) console.log("(DRY RUN — nothing will be translated or written)");
  if (FORCE) console.log("(--force: skipExisting disabled — every field re-translated regardless of what's already there)");

  const totals = { ok: 0, alreadyDone: 0, partial: 0, skipped: 0, failed: 0 };

  for (const entityType of entityTypes) {
    const Model = ENTITY_REGISTRY[entityType];
    try {
      const r = await runBatch(entityType, Model, targetLangs);
      totals.ok += r.ok;
      totals.alreadyDone += r.alreadyDone;
      totals.partial += r.partial;
      totals.skipped += r.skipped;
      totals.failed += r.failed;
    } catch (err) {
      // A single entity type failing even after withRetry's internal
      // retries (e.g. sustained network outage) no longer takes down
      // every other entity type in the same run — this used to be one big
      // uncaught rejection that killed the whole script.
      console.error(`\n❌ ${entityType} batch failed entirely: ${err.message} — continuing with remaining entity types.`);
    }
  }

  console.log(
    `\n✅ Done. Totals: ${totals.ok} ok, ${totals.alreadyDone} already translated (nothing to do), ` +
      `${totals.partial} partial/failed, ${totals.skipped} no-op, ${totals.failed} errored.`,
  );
  console.log(
    "   Review results in Admin → the relevant page → item → Translations tab. Anything you edit there is",
  );
  console.log(
    "   marked 'Manual' and this script will never overwrite it on a re-run.",
  );
  if (totals.partial > 0 || totals.failed > 0) {
    console.log(
      "   Some items had failures — just run this exact same command again: already-translated fields are",
    );
    console.log("   skipped automatically, so a re-run only retries what's still missing.");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Failed:", err);
  process.exit(1);
});
