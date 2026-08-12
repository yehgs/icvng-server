/**
 * scripts/bulkTranslateContent.js
 *
 * Issue #2: previously the ONLY way to get a product or blog post
 * translated was to open it in the admin panel and click "Auto" (or wait
 * for the auto-translate-on-save hook, which — see translation.controller.js
 * and the various entity controllers — was silently failing before this
 * fix round). Existing content saved before those fixes landed never
 * picked up translations retroactively; nothing ever went back and
 * translated it.
 *
 * This script walks every Product and BlogPost in the database and runs
 * them through the same translateEntity() pipeline the admin panel's
 * "Auto" button uses — so you get a complete FR/IT pass over existing
 * content in one run, with every result then sitting in the normal
 * Translations tab for review/editing (exactly like the manual flow),
 * because it's the exact same OpenAI pipeline under the hood.
 *
 * Respects the existing "don't clobber a human's manual edits" guard
 * inside translateEntity() automatically — a field an editor already
 * hand-translated (autoTranslated: false) is left alone; only
 * missing/still-auto fields get (re)translated. Safe to re-run.
 *
 * Rate-limit friendly: entities are processed sequentially (not
 * Promise.all'd), with a small delay between each, since
 * openaiTranslationClient.js already batches/retries per-entity — running
 * many entities concurrently would just multiply 429s.
 *
 * Usage:
 *   node scripts/bulkTranslateContent.js                 # products + blog posts
 *   node scripts/bulkTranslateContent.js --only=products  # just products
 *   node scripts/bulkTranslateContent.js --only=blog      # just blog posts
 *   node scripts/bulkTranslateContent.js --limit=50       # cap for a test run
 *   node scripts/bulkTranslateContent.js --dry-run        # list what would run, translate nothing
 */

import connectDB from "../config/connectDB.js";
import ProductModel from "../models/product.model.js";
import BlogPostModel from "../models/blog-post.model.js";
import { translateEntity } from "../utils/translationService.js";

const DELAY_MS = 300; // small pause between entities to stay polite to the OpenAI rate limit

const args = process.argv.slice(2);
const getArg = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : null;
};
const ONLY = getArg("only"); // "products" | "blog" | null (both)
const LIMIT = getArg("limit") ? parseInt(getArg("limit"), 10) : null;
const DRY_RUN = args.includes("--dry-run");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runBatch(label, entityType, docs) {
  console.log(`\n→ ${label}: ${docs.length} record(s)${LIMIT ? ` (limited to ${LIMIT})` : ""}`);

  let ok = 0;
  let partial = 0;
  let failed = 0;
  let skipped = 0;

  for (const [i, doc] of docs.entries()) {
    const idLabel = doc.name || doc.title || doc._id.toString();
    process.stdout.write(`  [${i + 1}/${docs.length}] ${idLabel} … `);

    if (DRY_RUN) {
      console.log("(dry run, skipped)");
      continue;
    }

    try {
      const outcome = await translateEntity({
        entityType,
        entityId: doc._id,
        document: doc.toObject(),
      });

      if (!outcome) {
        console.log("no-op (no translatable fields)");
        skipped++;
      } else if (outcome.ok) {
        console.log("ok");
        ok++;
      } else {
        const langs = Object.entries(outcome.results || {})
          .map(([lang, r]) => `${lang}:${r.status}`)
          .join(", ");
        console.log(`partial/failed (${langs || outcome.error})`);
        partial++;
      }
    } catch (err) {
      console.log(`ERROR — ${err.message}`);
      failed++;
    }

    await sleep(DELAY_MS);
  }

  console.log(`  ${label} summary: ${ok} ok, ${partial} partial/failed, ${skipped} no-op, ${failed} errored`);
  return { ok, partial, skipped, failed };
}

async function main() {
  await connectDB();

  const totals = { ok: 0, partial: 0, skipped: 0, failed: 0 };

  if (!ONLY || ONLY === "products") {
    let query = ProductModel.find().sort({ createdAt: 1 });
    if (LIMIT) query = query.limit(LIMIT);
    const products = await query;
    const r = await runBatch("Products", "product", products);
    totals.ok += r.ok; totals.partial += r.partial; totals.skipped += r.skipped; totals.failed += r.failed;
  }

  if (!ONLY || ONLY === "blog") {
    let query = BlogPostModel.find().sort({ createdAt: 1 });
    if (LIMIT) query = query.limit(LIMIT);
    const posts = await query;
    const r = await runBatch("Blog posts", "blog", posts);
    totals.ok += r.ok; totals.partial += r.partial; totals.skipped += r.skipped; totals.failed += r.failed;
  }

  console.log(
    `\n✅ Done. Totals: ${totals.ok} ok, ${totals.partial} partial/failed, ${totals.skipped} no-op, ${totals.failed} errored.`
  );
  console.log(
    "   Review results in Admin → the relevant page → item → Translations tab. Anything you edit there is",
  );
  console.log(
    "   marked 'Manual' and this script will never overwrite it on a re-run.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Failed:", err);
  process.exit(1);
});
