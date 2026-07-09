/**
 * middleware/countryContext.js
 *
 * PHASE 3/4 — bridges the authenticated admin's country scope into the
 * AsyncLocalStorage request context so the countryScoped plugin's query hooks
 * can auto-filter.
 *
 * Must run AFTER auth + countryScope (which set req.user and req.countryScope).
 *
 * Enforcement flag:
 *   Controlled by env COUNTRY_ENFORCE:
 *     "off"     → hooks dormant (field present, no filtering) — backfill phase
 *     "log"     → context carries scope; hooks still dormant, but a header is
 *                 set so mismatches can be observed in testing
 *     "on"      → hooks actively filter (default target state)
 *   Default: "on". Set COUNTRY_ENFORCE=off during initial backfill, then flip.
 *
 * IMPORTANT: because this wraps `next()` inside runWithContext, every
 * downstream handler and DB call in the request shares the same context.
 */

import { runWithContext } from "../core/requestContext.js";

const MODE = () => (process.env.COUNTRY_ENFORCE || "on").toLowerCase();

export default function countryContext(req, res, next) {
  const mode = MODE();
  const enforce = mode === "on";

  // req.countryScope is set by the existing countryScope middleware:
  //   null    → GLOBAL admin (no filtering)
  //   "TG"    → COUNTRY-scoped admin
  // For non-admin / public requests, countryScope is null → no filtering,
  // which is correct (storefront reads are filtered explicitly by controllers
  // using req.countryCode, not by the admin-scope hooks).
  const ctx = {
    countryScope: req.countryScope ?? null,
    scope: req.user?.scope ?? null,
    enforce,
  };

  if (mode === "log") {
    res.setHeader("x-country-scope", ctx.countryScope || "GLOBAL");
  }

  runWithContext(ctx, () => next());
}
