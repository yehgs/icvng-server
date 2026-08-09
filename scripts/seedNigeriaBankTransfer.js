/**
 * scripts/seedNigeriaBankTransfer.js
 *
 * Restores Nigeria's Direct Bank Transfer receiving-account details into
 * the new country-scoped BankTransferSettingsModel (see
 * models/bankTransferSettings.model.js).
 *
 * Before country-scoped bank transfer settings existed, these details
 * were hardcoded directly into the client (env vars in CheckoutPage.jsx /
 * a `defaultBankDetails` object in BankTransferInstructionPage.jsx) and
 * the server unconditionally accepted BANK_TRANSFER for NGN only. Both
 * were replaced with the country-scoped, IT/DIRECTOR-managed settings
 * system — which means Nigeria's bank transfer option went from
 * "hardcoded, always on" to "not configured, so hidden" until someone
 * actually adds it through the new system. This script does that,
 * restoring the exact details that used to be hardcoded, so Nigeria's
 * checkout keeps offering Bank Transfer (in NGN) exactly as before,
 * while Stripe becomes the only option there for any other currency —
 * matching every other country's rule (no bank transfer until IT/DIRECTOR
 * add one for that country specifically).
 *
 * This is a starting point, not a guess: after running it, go to
 * Admin → Settings → Bank Transfer Settings and confirm/update the
 * account details are still current before relying on it in production.
 *
 * Idempotent — safe to re-run; upserts by countryCode.
 *
 * Run:  node scripts/seedNigeriaBankTransfer.js
 */

import dotenv from "dotenv";
import connectDB from "../config/connectDB.js";
import UserModel from "../models/user.model.js";
import BankTransferSettingsModel from "../models/bankTransferSettings.model.js";

dotenv.config();

async function resolveSeedUser() {
  const user = await UserModel.findOne({
    role: "ADMIN",
    subRole: { $in: ["IT", "DIRECTOR"] },
  }).sort({ createdAt: 1 });

  if (!user) {
    throw new Error(
      "No IT or DIRECTOR admin account found — create one first (updatedBy on BankTransferSettings requires a valid User _id).",
    );
  }
  return user._id;
}

async function main() {
  await connectDB();
  const userId = await resolveSeedUser();

  console.log("→ Restoring Nigeria's Direct Bank Transfer settings …");

  const updated = await BankTransferSettingsModel.findOneAndUpdate(
    { countryCode: "NG" },
    {
      $set: {
        countryCode: "NG",
        isActive: true,
        bankName: "ZENITH BANK",
        accountName: "I-COFFEE VENTURES",
        accountNumber: "1310523997",
        sortCode: "057150042",
        currencyCode: "NGN",
        instructions:
          "Please use your order number as the transfer reference so we can match your payment quickly.",
        updatedBy: userId,
      },
    },
    { upsert: true, new: true, runValidators: true },
  );

  console.log(`  + NG: ${updated.bankName} — ${updated.accountName} (${updated.accountNumber})`);
  console.log("✅ Done. Nigeria's checkout will offer Bank Transfer again; every other country still requires IT/DIRECTOR to add their own via Admin → Settings → Bank Transfer Settings.");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
