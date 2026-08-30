/**
 * scripts/syncWebsiteCustomers.js
 *
 * One-off backfill: mirror every existing storefront registration into the
 * Customer collection, so shoppers who signed up before the sync shipped
 * appear in Customer Management and in the ONLINE manual-order picker.
 *
 * New registrations are mirrored automatically at signup (see
 * registerUserController) — this is only for the existing backlog. It is
 * idempotent, so re-running is harmless.
 *
 * USAGE
 *   node scripts/syncWebsiteCustomers.js --dry-run
 *   node scripts/syncWebsiteCustomers.js
 *   node scripts/syncWebsiteCustomers.js --country=TG
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import connectDB from "../config/connectDB.js";
import { backfillWebsiteCustomers } from "../services/customerSync.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const getArg = (n) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split("=").slice(1).join("=") : null;
};
const DRY_RUN = args.includes("--dry-run");
const COUNTRY = getArg("country");

/**
 * Register every model before querying — a standalone script imports only
 * what it names, so any populate path would otherwise throw
 * MissingSchemaError. Same reason as recoverOrphanPaystackOrders.js.
 */
async function registerAllModels() {
  const dir = path.join(__dirname, "..", "models");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".model.js"))) {
    try {
      await import(pathToFileURL(path.join(dir, file)).href);
    } catch (err) {
      console.warn(`   ⚠ could not load model ${file}: ${err.message}`);
    }
  }
}

async function main() {
  await connectDB();
  await registerAllModels();

  console.log(
    `\n🔄 Mirroring storefront users into Customer` +
      `${COUNTRY ? ` (country ${COUNTRY})` : ""}${DRY_RUN ? "  [DRY RUN]" : ""}\n`,
  );

  const result = await backfillWebsiteCustomers({
    dryRun: DRY_RUN,
    countryCode: COUNTRY,
  });

  console.log(`   users scanned : ${result.total}`);
  console.log(`   ${DRY_RUN ? "would create" : "created"}   : ${result.created}`);
  console.log(`   ${DRY_RUN ? "would update" : "updated"}   : ${result.updated}`);
  if (result.skipped) console.log(`   skipped       : ${result.skipped}`);
  console.log("");

  process.exit(0);
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
