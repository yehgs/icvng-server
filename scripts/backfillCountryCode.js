/**
 * scripts/backfillCountryCode.js
 *
 * PHASE 3 — one-time backfill. Stamps every existing row in the newly
 * country-scoped collections with NG (all current data is Nigeria's, since the
 * business only operated in Nigeria before this expansion).
 *
 * Idempotent: only touches documents where countryCode is missing/null.
 * Run BEFORE flipping COUNTRY_ENFORCE=on, and BEFORE making the field required.
 *
 * Run:  node scripts/backfillCountryCode.js
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import connectDB from "../config/connectDB.js";
import { DEFAULT_COUNTRY } from "../config/countries/index.js";

// Import every country-scoped model so its collection is registered.
import "../models/product.model.js";
import "../models/order.model.js";
import "../models/customer.model.js";
import "../models/banner.model.js";
import "../models/slider.model.js";
import "../models/coupon.model.js";
import "../models/fomo.model.js";
import "../models/blog-post.model.js";
import "../models/blog-category.model.js";
import "../models/blog-tag.model.js";
import "../models/notification.model.js";
import "../models/finance-entry.model.js";
import "../models/support-ticket.model.js";
import "../models/rating.model.js";

dotenv.config();

const MODEL_NAMES = [
  "Product",
  "order",
  "Customer",
  "banner",
  "slider",
  "Coupon",
  "FomoSettings",
  "BlogPost",
  "BlogCategory",
  "BlogTag",
  "Notification",
  "SupportTicket",
  "Rating",
];

async function backfill() {
  await connectDB();
  console.log(`→ Backfilling countryCode=${DEFAULT_COUNTRY} on existing rows …`);

  let grand = 0;
  for (const name of MODEL_NAMES) {
    let Model;
    try {
      Model = mongoose.model(name);
    } catch {
      console.warn(`  ! model ${name} not registered, skipping`);
      continue;
    }
    const res = await Model.updateMany(
      { $or: [{ countryCode: { $exists: false } }, { countryCode: null }] },
      { $set: { countryCode: DEFAULT_COUNTRY } }
    );
    const n = res.modifiedCount ?? res.nModified ?? 0;
    grand += n;
    console.log(`  ~ ${name}: ${n} rows stamped`);
  }

  // Finance entries model exports a differently-named model; handle separately.
  try {
    const collections = await mongoose.connection.db.listCollections().toArray();
    const financeColl = collections.find((c) => /finance/i.test(c.name));
    if (financeColl) {
      const res = await mongoose.connection.db
        .collection(financeColl.name)
        .updateMany(
          { $or: [{ countryCode: { $exists: false } }, { countryCode: null }] },
          { $set: { countryCode: DEFAULT_COUNTRY } }
        );
      console.log(`  ~ ${financeColl.name}: ${res.modifiedCount} rows stamped`);
      grand += res.modifiedCount || 0;
    }
  } catch (e) {
    console.warn("  ! finance backfill skipped:", e.message);
  }

  console.log(`✓ Backfill complete. Total rows stamped: ${grand}`);
  await mongoose.disconnect();
  process.exit(0);
}

backfill().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
