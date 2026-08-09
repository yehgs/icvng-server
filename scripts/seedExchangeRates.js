/**
 * scripts/seedExchangeRates.js
 *
 * URGENT — currency conversion is silently broken because no exchange
 * rates have ever been entered into ExchangeRateModel: the client's
 * conversion logic (provider/GlobalProvider.jsx#convertPrice) is correct
 * — it multiplies the NGN-stored price by `exchangeRates[targetCurrency]`
 * — but that map only ever gets populated FROM real rate rows fetched via
 * GET /api/exchange-rates. With zero rows in the database, the map stays
 * `{ NGN: 1 }` only, so `exchangeRates['XOF']`/`['EUR']` are undefined and
 * convertPrice() falls through to returning the raw, unconverted NGN
 * figure — while the currency SYMBOL displayed next to it comes from a
 * completely separate, correctly-working source (the visited domain's
 * country config), which is exactly why the symbol changes but the
 * number doesn't.
 *
 * This seeds MANUAL baseline rates (NGN → XOF, NGN → EUR — the two
 * currencies the live non-Nigeria storefronts actually need) sourced from
 * public mid-market rates at the time this script was written. MANUAL
 * rates always take priority over API-fetched ones (see
 * exchange-rate.model.js's getRate/getBestRate — MANUAL sorts first), so
 * this unblocks conversion immediately.
 *
 * This is a starting point, not something to leave on autopilot: FX
 * rates move daily. Go to Admin → Exchange Rates afterward to review
 * these, refresh from the live API (fetchRatesFromAPI), or keep them on
 * MANUAL and update periodically — whichever this business prefers.
 *
 * Idempotent — upserts by (baseCurrency, targetCurrency, source: MANUAL).
 *
 * Run:  node scripts/seedExchangeRates.js
 */

import dotenv from "dotenv";
import connectDB from "../config/connectDB.js";
import UserModel from "../models/user.model.js";
import ExchangeRateModel from "../models/exchange-rate.model.js";

dotenv.config();

// NGN → target. Sourced from public mid-market rates (exchangerates.org.uk,
// investing.com, xe.com, wise.com — cross-checked, mid-August 2026).
const SEED_RATES = [
  { target: "XOF", rate: 0.41 },   // ~1 NGN = 0.41 CFA franc (BCEAO)
  { target: "EUR", rate: 0.00063 }, // ~1 NGN = 0.00063 EUR
];

async function resolveSeedUser() {
  const user = await UserModel.findOne({
    role: "ADMIN",
    subRole: { $in: ["IT", "DIRECTOR"] },
  }).sort({ createdAt: 1 });

  if (!user) {
    throw new Error(
      "No IT or DIRECTOR admin account found — create one first (updatedBy on a MANUAL ExchangeRate requires a valid User _id).",
    );
  }
  return user._id;
}

async function main() {
  await connectDB();
  const userId = await resolveSeedUser();

  console.log("→ Seeding baseline NGN exchange rates …");
  for (const { target, rate } of SEED_RATES) {
    const updated = await ExchangeRateModel.findOneAndUpdate(
      { baseCurrency: "NGN", targetCurrency: target, source: "MANUAL" },
      {
        $set: {
          baseCurrency: "NGN",
          targetCurrency: target,
          rate,
          source: "MANUAL",
          isActive: true,
          lastUpdated: new Date(),
          updatedBy: userId,
        },
      },
      { upsert: true, new: true, runValidators: true },
    );
    console.log(`  + NGN → ${target}: ${updated.rate}`);
  }

  console.log("✅ Done. Currency conversion will now work on every non-Nigeria storefront. Review/refresh these in Admin → Exchange Rates when convenient.");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
