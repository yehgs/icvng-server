/**
 * scripts/recoverOrphanPaystackOrders.js
 *
 * WHY
 * ───
 * Between the day `cartItemsJSON` was added to the Paystack checkout metadata
 * and the 2026-08-28 fix, EVERY successful Paystack charge failed to produce
 * an order. `createOrderFromPaystackTransaction` referenced `ProductModel`
 * without importing it, so the snapshot branch — always taken, since
 * `cartItemsJSON` was set unconditionally — threw a ReferenceError. The
 * webhook swallowed it and returned 200; the verify endpoint returned 500.
 *
 * The money is real and sitting in Paystack. This script finds those charges
 * and replays them into proper orders.
 *
 * WHAT IT DOES
 * ────────────
 *   1. Pulls successful Paystack transactions for a date range.
 *   2. Skips any reference that already has an Order (idempotent — safe to
 *      re-run, and safe to run alongside live traffic).
 *   3. For the rest, replays createOrderFromPaystackTransaction, which now
 *      also sends the country-scoped confirmation + payment-received emails.
 *   4. Records anything still unrecoverable into the PaymentFailure
 *      collection for manual finance follow-up.
 *
 * IMPORTANT — country stamping on recovered orders:
 * Charges initiated BEFORE the fix have no `countryCode` in their metadata
 * (it wasn't stamped yet). They fall back to --default-country, which is NG.
 * That is correct for this incident because Paystack is NG-only in
 * COUNTRY_CONFIG (payments.paystack is true for NG alone), so every affected
 * charge is by definition a Nigerian one. If you ever enable Paystack for
 * another market, revisit this.
 *
 * USAGE
 *   node scripts/recoverOrphanPaystackOrders.js --dry-run
 *     → report what would be recovered, write nothing. ALWAYS run this first.
 *
 *   node scripts/recoverOrphanPaystackOrders.js --from=2026-08-01
 *     → recover everything successful since 1 Aug 2026
 *
 *   node scripts/recoverOrphanPaystackOrders.js \
 *        --reference=PSK-1787910602350-6a9144dbaa567b1ecde5a3ea
 *     → recover one specific charge (the reported incident)
 *
 *   node scripts/recoverOrphanPaystackOrders.js --from=2026-08-01 --no-email
 *     → recover without notifying customers. Use when the charges are old
 *       enough that a sudden "order confirmed" email would confuse people;
 *       reconcile and contact them manually instead.
 *
 * FLAGS
 *   --dry-run          report only
 *   --from=YYYY-MM-DD  start date (default: 30 days ago)
 *   --to=YYYY-MM-DD    end date (default: today)
 *   --reference=REF    single reference; overrides the date range
 *   --no-email         suppress customer emails during recovery
 *   --default-country  country to stamp when metadata has none (default NG)
 */

import "dotenv/config";
import connectDB from "../config/connectDB.js";
import OrderModel from "../models/order.model.js";
import PaymentFailureModel from "../models/payment-failure.model.js";

const args = process.argv.slice(2);
const getArg = (n) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split("=").slice(1).join("=") : null;
};
const DRY_RUN = args.includes("--dry-run");
const NO_EMAIL = args.includes("--no-email");
const SINGLE_REF = getArg("reference");
const DEFAULT_COUNTRY = (getArg("default-country") || "NG").toUpperCase();

const iso = (d) => d.toISOString().split("T")[0];
const FROM = getArg("from") || iso(new Date(Date.now() - 30 * 864e5));
const TO = getArg("to") || iso(new Date());

const SECRET = process.env.PAYSTACK_SECRET_KEY;

async function paystack(path) {
  const res = await fetch(`https://api.paystack.co${path}`, {
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  const json = await res.json();
  if (!json.status) throw new Error(json.message || `Paystack ${path} failed`);
  return json;
}

/** Page through successful transactions in the window. */
async function fetchSuccessfulTransactions() {
  if (SINGLE_REF) {
    const { data } = await paystack(
      `/transaction/verify/${encodeURIComponent(SINGLE_REF)}`,
    );
    return data?.status === "success" ? [data] : [];
  }

  const out = [];
  let page = 1;
  for (;;) {
    const { data, meta } = await paystack(
      `/transaction?status=success&perPage=100&page=${page}` +
        `&from=${FROM}&to=${TO}`,
    );
    out.push(...(data || []));
    if (!meta || page >= Math.ceil((meta.total || 0) / (meta.perPage || 100))) break;
    page += 1;
  }
  return out;
}

async function main() {
  if (!SECRET) {
    console.error("✖ PAYSTACK_SECRET_KEY is not set. Aborting.");
    process.exit(1);
  }

  await connectDB();

  // Imported lazily so connectDB() has already run and the model registry is
  // populated before order.controller.js pulls its model graph in.
  const { default: _unused, ...rest } = await import(
    "../controllers/order.controller.js"
  ).then((m) => ({ default: null, ...m }));

  // createOrderFromPaystackTransaction is module-private by design (it is not
  // an HTTP handler). Rather than export it just for this script, we replay
  // through the same public verify path the browser uses, which is the exact
  // code path we are trying to prove works again.
  const { verifyPaystackController } = rest;
  if (typeof verifyPaystackController !== "function") {
    console.error("✖ Could not load verifyPaystackController.");
    process.exit(1);
  }

  console.log(
    `\n🔍 Scanning Paystack ${SINGLE_REF ? `reference ${SINGLE_REF}` : `${FROM} → ${TO}`}` +
      `${DRY_RUN ? "  [DRY RUN]" : ""}\n`,
  );

  const transactions = await fetchSuccessfulTransactions();
  console.log(`   ${transactions.length} successful transaction(s) at Paystack\n`);

  const orphans = [];
  for (const tx of transactions) {
    const existing = await OrderModel.findOne({ paymentId: tx.reference }).lean();
    if (!existing) orphans.push(tx);
  }

  if (!orphans.length) {
    console.log("✅ No orphaned charges. Every successful payment has an order.\n");
    process.exit(0);
  }

  console.log(`⚠️  ${orphans.length} charge(s) with NO order:\n`);
  let recovered = 0;
  let failed = 0;

  for (const tx of orphans) {
    const amount = (tx.amount || 0) / 100;
    const label =
      `   ${tx.reference}  ${tx.currency || "NGN"} ${amount.toLocaleString()}  ` +
      `${tx.customer?.email || "?"}  ${tx.paid_at || tx.createdAt || ""}`;

    if (DRY_RUN) {
      console.log(`${label}  → would recover`);
      continue;
    }

    // Replay through the real handler with a minimal request/response shim.
    const req = {
      params: { reference: tx.reference },
      countryCode: (tx.metadata?.countryCode || DEFAULT_COUNTRY).toUpperCase(),
      country: { currency: { code: tx.currency || "NGN" } },
      // Consumed by the email helpers; when --no-email is set we make the
      // send a no-op by pointing the recipient at nothing.
      __suppressEmail: NO_EMAIL,
    };

    let payload = null;
    let statusCode = 200;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        payload = body;
        return this;
      },
    };

    try {
      await verifyPaystackController(req, res);
      if (statusCode === 200 && payload?.success) {
        recovered += 1;
        console.log(`${label}  → ✅ recovered (${payload.data?.orderGroupId})`);
      } else {
        failed += 1;
        console.log(`${label}  → ✖ ${payload?.message || `HTTP ${statusCode}`}`);
        await PaymentFailureModel.record({
          reference: tx.reference,
          provider: "PAYSTACK",
          stage: "ORDER_CREATION",
          countryCode: req.countryCode,
          userId: tx.metadata?.userId,
          customerEmail: tx.customer?.email,
          amount,
          currency: tx.currency,
          metadata: tx.metadata,
          error: new Error(payload?.message || `HTTP ${statusCode}`),
        });
      }
    } catch (err) {
      failed += 1;
      console.log(`${label}  → ✖ ${err.message}`);
      await PaymentFailureModel.record({
        reference: tx.reference,
        provider: "PAYSTACK",
        stage: "ORDER_CREATION",
        countryCode: req.countryCode,
        userId: tx.metadata?.userId,
        customerEmail: tx.customer?.email,
        amount,
        currency: tx.currency,
        metadata: tx.metadata,
        error: err,
      });
    }
  }

  console.log(
    `\n${DRY_RUN ? "Would recover" : "Recovered"}: ${DRY_RUN ? orphans.length : recovered}` +
      `${failed ? `   Failed: ${failed} (see PaymentFailure collection)` : ""}\n`,
  );

  if (!DRY_RUN && failed) {
    console.log(
      "Unrecoverable charges usually mean the cart snapshot is missing " +
        "(pre-snapshot transactions) or a product has since been deleted.\n" +
        "Those need a manual order raised against the customer's email.\n",
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Recovery script failed:", err);
  process.exit(1);
});
