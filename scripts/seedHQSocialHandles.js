/**
 * scripts/seedHQSocialHandles.js
 *
 * Seeds Nigeria (HQ)'s social media handles into the country-scoped
 * HomeContentBlock "footer" singleton (see models/homeContentBlock.model.js).
 *
 * This system was already fully built — country-scoped social handles,
 * IT/DIRECTOR able to edit/add any country's, a country-scoped admin able
 * to add their own with automatic fallback to Nigeria's if unset (see
 * getPublicHomeContentBlocks in controllers/homeContentBlock.controller.js)
 * — but nobody had ever actually saved a real NG "footer" document. The
 * client-side useSocialLinks.js hook had the real handles hardcoded as a
 * DEFAULTS fallback (used only if the API call fails/returns nothing),
 * which masked the fact that no country — including Nigeria itself — had
 * real saved data to fall back to. This script fixes that at the data
 * layer, so Nigeria's own social links are genuinely stored (editable via
 * Admin → Site Content → Footer) rather than silently relying on a
 * client-side hardcoded value that only existed because the real data was
 * never entered.
 *
 * Only touches the social* fields — doesn't overwrite contactAddress/
 * contactPhone/contactEmail/contactWhatsapp if HQ has already set those
 * via the admin CMS.
 *
 * Idempotent — upserts the one NG "footer" singleton.
 *
 * Run:  node scripts/seedHQSocialHandles.js
 */

import dotenv from "dotenv";
import connectDB from "../config/connectDB.js";
import HomeContentBlockModel from "../models/homeContentBlock.model.js";

dotenv.config();

const HQ_SOCIAL_HANDLES = {
  socialFacebook: "https://www.facebook.com/Italiancoffeeonline/?ref=pages_you_manage",
  socialTwitter: "https://twitter.com/italiancoffee_v",
  socialInstagram: "https://www.instagram.com/italiancofeeventure/",
};

async function main() {
  await connectDB();
  console.log("→ Seeding Nigeria (HQ) social handles into the footer content block …");

  const updated = await HomeContentBlockModel.findOneAndUpdate(
    { type: "footer", countryCode: "NG" },
    {
      $set: HQ_SOCIAL_HANDLES,
      $setOnInsert: {
        type: "footer",
        countryCode: "NG",
        isActive: true,
        order: 0,
      },
    },
    { upsert: true, new: true, runValidators: true },
  );

  console.log("  + NG footer block:", {
    facebook: updated.socialFacebook,
    twitter: updated.socialTwitter,
    instagram: updated.socialInstagram,
  });
  console.log("✅ Done. Every other country still falls back to these until IT/DIRECTOR (any country) or that country's own admin adds their own via Admin → Site Content → Footer.");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
