/**
 * scripts/resetProductDiscounts.js
 *
 * Sets discount = 0 on every product. Useful for wiping out any discount
 * values that were set before the Discount field was wired into the admin
 * CRUD/list/export views, so the whole catalog starts from a known state.
 *
 * Safe to re-run — it's just a bulk $set, not a one-time migration.
 *
 * Run:  node scripts/resetProductDiscounts.js
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import connectDB from "../config/connectDB.js";
import ProductModel from "../models/product.model.js";

dotenv.config();

async function resetDiscounts() {
  await connectDB();
  console.log("→ Resetting discount to 0 on all products …");

  const before = await ProductModel.countDocuments({
    discount: { $gt: 0 },
  });
  console.log(`  ~ ${before} product(s) currently have discount > 0`);

  const res = await ProductModel.updateMany(
    {}, // every product, regardless of current discount value
    { $set: { discount: 0 } },
  );
  const modified = res.modifiedCount ?? res.nModified ?? 0;

  console.log(`✓ Done. ${modified} product(s) updated to discount = 0.`);
  await mongoose.disconnect();
  process.exit(0);
}

resetDiscounts().catch((err) => {
  console.error("Reset discount script failed:", err);
  process.exit(1);
});
