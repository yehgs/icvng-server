/**
 * services/customerSync.service.js
 *
 * Keeps storefront registrations visible in the Customer module.
 *
 * ── THE PROBLEM THIS SOLVES ──────────────────────────────────────────────
 * There are two customer records in this system and they were never joined:
 *
 *   User     — everyone who registers on a storefront. role USER,
 *              subRole BTC, userMode ONLINE.
 *   Customer — the admin-managed book: BTC/BTB × ONLINE/OFFLINE.
 *
 * A website shopper existed only as a User. They never appeared in Customer
 * Management, and an ONLINE sales agent raising a manual order for them had
 * nothing to select — even though they are exactly the customer that agent
 * is supposed to serve.
 *
 * Customer already carries `isWebsiteCustomer`, but with no link back to the
 * User document there was no way to populate it or keep it current. This
 * service adds that link (`userId`) and the sync both ways round:
 *
 *   - backfill: one-off, for users who registered before this shipped
 *   - upsert:   called on registration, so new signups appear immediately
 *
 * ── WHY MIRROR RATHER THAN QUERY ACROSS BOTH ─────────────────────────────
 * The alternative was to leave User alone and have every customer-facing
 * admin screen union two collections. That means every list, search, filter,
 * count and pagination path has to merge two sources with different shapes —
 * and each one is a place to get scoping wrong. Mirroring keeps a single
 * queryable surface with one country field and one scoping plugin.
 *
 * The mirror is deliberately THIN: identity and contact only. The User
 * document stays the source of truth for auth, password and cart. Nothing
 * here writes back to User.
 */

import CustomerModel from "../models/customer.model.js";
import UserModel from "../models/user.model.js";

/**
 * Create or refresh the Customer mirror for one storefront user.
 * Idempotent — safe to call on every login if you ever want to.
 *
 * @returns {Promise<object|null>} the Customer doc, or null if not applicable
 */
export async function syncUserToCustomer(user) {
  if (!user) return null;

  // Only real storefront shoppers are mirrored. Staff accounts are not
  // customers, and mirroring them would put colleagues in the customer
  // picker.
  if (user.role !== "USER") return null;

  const customerType = ["BTC", "BTB"].includes(user.subRole) ? user.subRole : "BTC";
  // A storefront registration is ONLINE by definition. userMode is honoured
  // when set so an admin can reclassify someone without this undoing it.
  const customerMode = user.userMode === "OFFLINE" ? "OFFLINE" : "ONLINE";

  try {
    return await CustomerModel.findOneAndUpdate(
      { userId: user._id },
      {
        $setOnInsert: {
          userId: user._id,
          customerType,
          customerMode,
          isWebsiteCustomer: true,
          // createdBy is required for OFFLINE customers only; a website
          // registration has no creating admin, which is correct.
          createdBy: null,
        },
        $set: {
          name: user.name,
          email: user.email,
          phone: user.mobile || user.phone || undefined,
          countryCode: user.countryCode || user.assignedCountry || "NG",
          status: user.status === "Active" ? "ACTIVE" : "INACTIVE",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (err) {
    // Never fail a registration because the mirror failed — the user still
    // has a working account, and backfill will pick them up.
    console.error(`[customerSync] could not mirror user ${user._id}: ${err.message}`);
    return null;
  }
}

/**
 * Backfill every existing storefront user into Customer.
 * Used by scripts/syncWebsiteCustomers.js.
 *
 * @param {{dryRun?: boolean, countryCode?: string}} opts
 */
export async function backfillWebsiteCustomers({ dryRun = false, countryCode } = {}) {
  const query = { role: "USER" };
  if (countryCode) query.countryCode = countryCode.toUpperCase();

  const users = await UserModel.find(query).select(
    "name email mobile phone role subRole userMode countryCode assignedCountry status",
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const user of users) {
    const existing = await CustomerModel.findOne({ userId: user._id }).lean();
    if (dryRun) {
      existing ? (updated += 1) : (created += 1);
      continue;
    }
    const result = await syncUserToCustomer(user);
    if (!result) skipped += 1;
    else if (existing) updated += 1;
    else created += 1;
  }

  return { total: users.length, created, updated, skipped };
}
