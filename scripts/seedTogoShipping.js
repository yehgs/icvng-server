/**
 * scripts/seedTogoShipping.js
 *
 * Seeds Togo's (TG) shipping zones and a country-scoped weight-based rate
 * table ("table_shipping" method), covering all 5 Togo regions:
 *
 *   1. One shipping zone per Togo region (Maritime, Plateaux, Centrale,
 *      Kara, Savanes), each covering every prefecture in that region
 *      (coverage_type: "all" — see data/togo-regions-prefectures.js for
 *      the full prefecture list per region).
 *   2. One table_shipping method ("Togo Standard Delivery") with a
 *      weight-band rate table per zone (5 bands: 0-1kg, 1-3kg, 3-5kg,
 *      5-10kg, 10-20kg), each band carrying a baseCost plus a
 *      stockMarkupPercent ("store-up" — stock/inventory handling markup)
 *      baked into the final shippingCost. All costs in XOF (Togo's
 *      currency has 0 decimal places — see config/countries/index.js).
 *
 * Idempotent: re-running upserts the same 5 zones (matched by
 * name+countryCode) and rebuilds the method's rate table against
 * whatever those zones' current _ids are, instead of duplicating rows.
 *
 * Run:  node scripts/seedTogoShipping.js
 */

import dotenv from "dotenv";
import connectDB from "../config/connectDB.js";
import UserModel from "../models/user.model.js";
import ShippingZoneModel from "../models/shipping-zone.model.js";
import ShippingMethodModel from "../models/shipping-method.model.js";
import { togoRegionsPrefectures } from "../data/togo-regions-prefectures.js";

dotenv.config();

const COUNTRY = "TG";
// Flat "store-up" stock/inventory handling markup applied on top of every
// weight band's base carrier cost. Adjust here (or per-band, by editing
// ZONE_RATE_TABLE below) to change how much of the shipping cost is
// stock-markup vs. base carrier cost.
const STOCK_MARKUP_PERCENT = 8;

// ─────────────────────────────────────────────────────────────────────────
// 1. Zone definitions — one per Togo region, full prefecture coverage.
// ─────────────────────────────────────────────────────────────────────────
const TOGO_ZONES = togoRegionsPrefectures.map((division, i) => ({
  name: `Togo — ${division.state}`,
  // Stable, human-readable per-zone code (unique within TG — see the
  // {countryCode, code} compound unique index on ShippingZoneModel).
  code: `TG-${division.state.substring(0, 3).toUpperCase()}`,
  description: `${division.state} region — all ${division.no_of_lga} prefectures (${division.capital} and surrounding area).`,
  zone_type: division.state === "Maritime" ? "urban" : "mixed",
  priority: division.state === "Maritime" ? "high" : "medium",
  sortOrder: i,
  states: [
    {
      name: division.state,
      code: division.state.substring(0, 2).toUpperCase(),
      coverage_type: "all",
      available_lgas: [...division.lga],
      covered_lgas: [],
    },
  ],
}));

async function seedZones(userId) {
  console.log("→ Seeding Togo shipping zones …");
  const zoneByRegion = new Map(); // region name -> zone doc

  // Uses findOneAndUpdate (not .save()) so this script is a plain
  // idempotent upsert — that intentionally bypasses the model's
  // pre("save") state/LGA validation hook, which is fine here because
  // every state/LGA below comes straight from
  // data/togo-regions-prefectures.js (already-trusted, already-valid
  // data), not from user input.
  for (const z of TOGO_ZONES) {
    const doc = await ShippingZoneModel.findOneAndUpdate(
      { name: z.name, countryCode: COUNTRY },
      {
        $set: {
          description: z.description,
          zone_type: z.zone_type,
          priority: z.priority,
          sortOrder: z.sortOrder,
          states: z.states,
          isActive: true,
          countryCode: COUNTRY,
          updatedBy: userId,
        },
        $setOnInsert: { createdBy: userId, code: z.code },
      },
      { upsert: true, new: true, runValidators: true },
    );
    zoneByRegion.set(z.states[0].name, doc);
    console.log(`  + upserted zone "${doc.name}" (${doc.code}, ${doc._id})`);
  }

  return zoneByRegion;
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Rate table — weight bands per region, base cost before stock markup.
//    Costs increase with distance from Lomé (Maritime), matching the
//    typical Togo logistics reality: the north (Savanes/Kara) costs more
//    to reach than the coastal Maritime region.
// ─────────────────────────────────────────────────────────────────────────
const WEIGHT_BANDS = [
  { minWeight: 0, maxWeight: 1 },
  { minWeight: 1, maxWeight: 3 },
  { minWeight: 3, maxWeight: 5 },
  { minWeight: 5, maxWeight: 10 },
  { minWeight: 10, maxWeight: 20 },
];

// Base carrier cost (XOF) per region, one entry per weight band above.
const ZONE_BASE_COSTS = {
  Maritime: [1500, 2500, 3500, 5000, 8000],
  Plateaux: [1800, 3000, 4200, 6000, 9500],
  Centrale: [2200, 3600, 5000, 7200, 11500],
  Kara: [2800, 4600, 6400, 9200, 14500],
  Savanes: [3200, 5200, 7200, 10400, 16500],
};

function applyStockMarkup(baseCost) {
  // XOF has 0 decimal places (see config/countries/index.js) — round to
  // the nearest whole franc.
  return Math.round(baseCost * (1 + STOCK_MARKUP_PERCENT / 100));
}

async function seedTableShippingMethod(userId, zoneByRegion) {
  console.log("→ Seeding Togo table-shipping rate table …");

  const zoneRates = Object.entries(ZONE_BASE_COSTS).map(([region, costs]) => {
    const zone = zoneByRegion.get(region);
    if (!zone) throw new Error(`No seeded zone found for region "${region}" — run seedZones first`);

    const weightRanges = WEIGHT_BANDS.map((band, i) => {
      const baseCost = costs[i];
      return {
        minWeight: band.minWeight,
        maxWeight: band.maxWeight,
        baseCost,
        stockMarkupPercent: STOCK_MARKUP_PERCENT,
        shippingCost: applyStockMarkup(baseCost),
      };
    });

    return { zone: zone._id, weightRanges };
  });

  const doc = await ShippingMethodModel.findOneAndUpdate(
    { name: "Togo Standard Delivery", countryCode: COUNTRY },
    {
      $set: {
        description:
          "Weight-based delivery rates covering all 5 Togo regions, including stock/handling markup.",
        type: "table_shipping",
        isActive: true,
        countryCode: COUNTRY,
        tableShipping: {
          assignment: "all_products",
          categories: [],
          products: [],
          zoneRates,
        },
        estimatedDelivery: { minDays: 1, maxDays: 5 },
        updatedBy: userId,
      },
      $setOnInsert: {
        createdBy: userId,
        code: `TS-${COUNTRY}`,
      },
    },
    { upsert: true, new: true, runValidators: true },
  );

  console.log(`  + upserted method "${doc.name}" (${doc.code}, ${doc._id}) with ${zoneRates.length} zone rate(s)`);
}

// ─────────────────────────────────────────────────────────────────────────
async function resolveSeedUser() {
  // Prefer an IT or DIRECTOR account (GLOBAL scope, can create for any
  // country) so this script works regardless of whether a Togo Logistics
  // admin has been created yet.
  const user = await UserModel.findOne({
    role: "ADMIN",
    subRole: { $in: ["IT", "DIRECTOR"] },
  }).sort({ createdAt: 1 });

  if (!user) {
    throw new Error(
      "No IT or DIRECTOR admin account found — create one first (createdBy/updatedBy on shipping zones/methods requires a valid User _id).",
    );
  }
  return user._id;
}

async function main() {
  await connectDB();
  const userId = await resolveSeedUser();
  const zoneByRegion = await seedZones(userId);
  await seedTableShippingMethod(userId, zoneByRegion);
  console.log("✅ Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
