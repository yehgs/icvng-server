/**
 * scripts/findOversizedContent.js
 *
 * Diagnoses the root cause behind the "Your input exceeds the context
 * window of this model" translation failures: pasting or drag-dropping an
 * image directly into the blog post rich-text editor had no handling, so
 * Tiptap/ProseMirror's default behavior embedded it as a base64
 * `data:image/...;base64,...` string right inside the saved HTML — a
 * single screenshot can easily balloon a post's `content` field from a
 * normal few-KB to several MB of text (base64 inflates binary size by
 * ~33%). That's what happened to the two posts that failed
 * ("Can You Reuse Coffee Grounds?" at 3,085,572 chars and "Can Pregnant
 * and Nursing Mothers Drink Coffee?" at 844,261 chars) — both wildly
 * outside any normal blog post's size and both containing embedded
 * `data:image` URIs.
 *
 * The editor itself is now fixed (admin/src/pages/blog/BlogPosts.jsx's
 * RichEditor intercepts paste/drop and uploads images to Cloudinary
 * instead of embedding them) — this script is for finding and reporting
 * any OTHER posts (or other entity types, as a broader safety net; it
 * scans every entity type in TRANSLATABLE_FIELDS, not just blog) that
 * already have the same problem baked in from before that fix, so they
 * can be manually repaired: open the post, delete the broken/giant image,
 * and re-insert it via the toolbar's "Insert Image" button (or drag it
 * back in) — it'll upload properly this time instead of embedding.
 *
 * This is read-only — it reports, it does not modify anything.
 *
 * Usage:
 *   node scripts/findOversizedContent.js
 *     → scan every entity type, default 100,000-char threshold
 *
 *   node scripts/findOversizedContent.js --entities=blog --threshold=50000
 *     → just blog posts, lower threshold
 *
 *   node scripts/findOversizedContent.js --json
 *     → machine-readable output instead of the human-readable report
 */

// Explicit — not relying on connectDB.js's dotenv.config() side effect
// (see the same fix/explanation in translateUiLocales.js and index.js;
// this script happens to import connectDB.js so it would work either way,
// but every entry point should load its own .env rather than depending on
// another module's import order).
import "dotenv/config";
import connectDB from "../config/connectDB.js";
import { TRANSLATABLE_FIELDS } from "../utils/translationService.js";

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

// Same registry as bulkTranslateContent.js — see that file's comment for
// why brand is intentionally absent.
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
};

const args = process.argv.slice(2);
const getArg = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : null;
};
const getList = (name) => {
  const raw = getArg(name);
  return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : null;
};

const requestedEntities = getList("entities");
const THRESHOLD = getArg("threshold") ? parseInt(getArg("threshold"), 10) : 100_000;
const JSON_OUTPUT = args.includes("--json");

function getPath(obj, path) {
  return path.split(".").reduce((n, k) => (n && typeof n === "object" ? n[k] : undefined), obj);
}

async function main() {
  await connectDB();

  const entityTypes = (requestedEntities || Object.keys(TRANSLATABLE_FIELDS)).filter(
    (e) => ENTITY_REGISTRY[e],
  );

  if (!JSON_OUTPUT) {
    console.log(`Scanning: ${entityTypes.join(", ")}`);
    console.log(`Threshold: ${THRESHOLD.toLocaleString()} characters\n`);
  }

  const findings = [];

  for (const entityType of entityTypes) {
    const Model = ENTITY_REGISTRY[entityType];
    const fields = TRANSLATABLE_FIELDS[entityType];
    const docs = await Model.find().lean();

    for (const doc of docs) {
      for (const field of fields) {
        const value = getPath(doc, field);
        if (typeof value !== "string" || value.length < THRESHOLD) continue;

        findings.push({
          entityType,
          entityId: doc._id.toString(),
          label: doc.name || doc.title || doc.notificationMessage || doc.message || doc._id.toString(),
          field,
          length: value.length,
          containsBase64Image: value.includes("data:image"),
        });
      }
    }
  }

  findings.sort((a, b) => b.length - a.length);

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(findings, null, 2));
  } else if (findings.length === 0) {
    console.log("✅ Nothing found above the threshold — no oversized fields detected.");
  } else {
    console.log(`⚠️  ${findings.length} oversized field(s) found:\n`);
    for (const f of findings) {
      console.log(`  ${f.entityType}:${f.entityId} → ${f.field}`);
      console.log(`    "${f.label}"`);
      console.log(
        `    ${f.length.toLocaleString()} characters` +
          (f.containsBase64Image
            ? " — contains an embedded base64 image (this is almost certainly the cause)"
            : " — large, but no embedded base64 image detected; worth a manual look"),
      );
      console.log();
    }
    console.log(
      "For each one: open it in the admin, find the broken/oversized image, delete it, and\n" +
        "re-insert it via the toolbar's \"Insert Image\" button (or drag it back in) — the editor\n" +
        "now uploads images to Cloudinary on paste/drop instead of embedding them as base64, so\n" +
        "this won't recur once re-saved.",
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Failed:", err);
  process.exit(1);
});
