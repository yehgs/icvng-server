/**
 * scripts/seedSiteIndexMeta.js
 *
 * Seeds the "site-index" SitePage slug — the whole site's default
 * <title>/meta description/keywords/og:image, what index.html used to
 * hardcode statically (always Nigeria's English copy, on every domain) —
 * for all four live domains: i-coffee.ng, i-coffee.tg, i-coffee.bj,
 * i-coffee.it.
 *
 * See client/src/components/SiteMeta.jsx (fetches this per-country and
 * applies it to <head> on load) and
 * admin/src/pages/content/SitePagesManagement.jsx (where IT/DIRECTOR — or
 * any content.manage-holding foreign admin for their own country — can
 * edit this afterward, slug "Site Default (index.html)").
 *
 * Idempotent — upserts by (slug: "site-index", countryCode).
 *
 * Run:  node scripts/seedSiteIndexMeta.js
 */

import dotenv from "dotenv";
import connectDB from "../config/connectDB.js";
import SitePageModel from "../models/sitePage.model.js";

dotenv.config();

const OG_IMAGE =
  "http://res.cloudinary.com/dwwsz3kss/image/upload/v1752169680/icv-ng/cyzkcev27uypuzjgwna2.jpg";

const SITE_INDEX_SEO = {
  NG: {
    title: "Buy Coffee Products Online in Nigeria | I-Coffee",
    description:
      "Discover and shop the best coffee products in Nigeria. From beans to brewers, I-Coffee offers high-quality coffee essentials with fast delivery across Nigeria.",
    keywords:
      "coffee Nigeria, buy coffee, coffee beans, espresso, coffee accessories, Nigerian coffee store",
    ogImage: OG_IMAGE,
  },
  TG: {
    title: "Acheter du café en ligne au Togo | I-Coffee Togo",
    description:
      "Découvrez et achetez les meilleurs produits de café au Togo. Des grains aux machines à café, I-Coffee Togo livre rapidement à Lomé et dans tout le pays.",
    keywords:
      "café Togo, acheter café, grains de café, espresso, accessoires café, boutique café Lomé",
    ogImage: OG_IMAGE,
  },
  BJ: {
    title: "Acheter du café en ligne au Bénin | I-Coffee Bénin",
    description:
      "Découvrez et achetez les meilleurs produits de café au Bénin. Des grains aux machines à café, I-Coffee Bénin livre rapidement à Cotonou et dans tout le pays.",
    keywords:
      "café Bénin, acheter café, grains de café, espresso, accessoires café, boutique café Cotonou",
    ogImage: OG_IMAGE,
  },
  IT: {
    title: "Acquista Caffè Online in Italia | I-Coffee Italia",
    description:
      "Scopri e acquista i migliori prodotti di caffè in Italia. Dai chicchi alle macchine, I-Coffee Italia offre articoli di alta qualità con consegna rapida in tutto il paese.",
    keywords:
      "caffè Italia, comprare caffè, chicchi di caffè, espresso, accessori caffè, negozio caffè online",
    ogImage: OG_IMAGE,
  },
};

async function main() {
  await connectDB();
  console.log("→ Seeding site-index (index.html default) metadata for all 4 domains …");

  // GLOBAL — same convention as every other slug (see scripts/seedSitePages.js):
  // the HQ/Nigeria copy doubles as the fallback for any future country that
  // doesn't have its own site-index override yet.
  const globalUpdated = await SitePageModel.findOneAndUpdate(
    { slug: "site-index", countryCode: "GLOBAL" },
    {
      $set: { seo: SITE_INDEX_SEO.NG },
      $setOnInsert: {
        slug: "site-index",
        countryCode: "GLOBAL",
        content: {},
        isPublished: true,
      },
    },
    { upsert: true, new: true, runValidators: true },
  );
  console.log(`  + GLOBAL: "${globalUpdated.seo.title}"`);

  for (const [countryCode, seo] of Object.entries(SITE_INDEX_SEO)) {
    const updated = await SitePageModel.findOneAndUpdate(
      { slug: "site-index", countryCode },
      {
        $set: { seo },
        $setOnInsert: {
          slug: "site-index",
          countryCode,
          content: {},
          isPublished: true,
        },
      },
      { upsert: true, new: true, runValidators: true },
    );
    console.log(`  + ${countryCode}: "${updated.seo.title}"`);
  }

  console.log("✅ Done. Every domain now has its own default <head> tags instead of sharing Nigeria's.");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
