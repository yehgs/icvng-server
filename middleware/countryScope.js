/**
 * middleware/countryScope.js
 *
 * Attaches req.countryScope to every authenticated admin request.
 *
 * Rule (simple):
 *   user.scope === "GLOBAL"  → req.countryScope = null   (no filter — sees everything)
 *   user.scope === "COUNTRY" → req.countryScope = user.assignedCountry
 *
 * Permissions (what routes you can visit) are controlled by subRole via adminAuth/roleAuth.
 * This middleware ONLY controls data filtering inside controllers.
 *
 * Must run AFTER auth middleware so req.user is populated.
 */

import { setContextScope } from "../core/requestContext.js";
import { HQ_ONLY_SUBROLES } from "../config/roles.js";

export function countryScope(req, res, next) {
  const user = req.user;

  if (!user || user.role !== "ADMIN") {
    req.countryScope = null;
    setContextScope({ countryScope: null, scope: user?.scope ?? null });
    return next();
  }

  // Item #9: HQ-only subRoles (IT, DIRECTOR, ACCOUNTANT, WAREHOUSE, EDITOR)
  // are NEVER country-scoped — every account is managed from HQ. LOGISTICS
  // is no longer in this list (country-scoped logistics system is live).
  // This is enforced at write-time (create/update user, login self-heal),
  // but is checked again here so an already-logged-in session with a stale
  // COUNTRY scope on the token doesn't get incorrectly data-filtered or
  // blocked from HQ-only modules (blockCountryScopedAdmins below) until
  // their next login.
  const isHqOnlyRole = HQ_ONLY_SUBROLES.includes(user.subRole);

  req.countryScope = (!isHqOnlyRole && user.scope === "COUNTRY" && user.assignedCountry)
    ? user.assignedCountry
    : null;

  // PHASE 3: publish the resolved scope into the AsyncLocalStorage context so
  // the countryScoped Mongoose plugin's query hooks can auto-filter.
  setContextScope({
    countryScope: req.countryScope,
    scope: isHqOnlyRole ? "GLOBAL" : user.scope,
  });

  next();
}

/**
 * buildCountryFilter(req)
 *
 * Returns a MongoDB $match filter object.
 *   null scope  → {}                     (no restriction — GLOBAL admins)
 *   "TG" scope  → { countryCode: "TG" }  (COUNTRY admins)
 *
 * Usage in any controller:
 *   const filter = { ...buildCountryFilter(req), order_status: "Delivered" };
 *   const orders = await OrderModel.find(filter);
 */
export function buildCountryFilter(req) {
  if (!req.countryScope) return {};
  return { countryCode: req.countryScope };
}

/**
 * scopedQuery(req, extra)
 *
 * Merge country filter with additional query conditions.
 *
 * Usage:
 *   const query = scopedQuery(req, { order_status: "Pending" });
 */
export function scopedQuery(req, extra = {}) {
  return { ...buildCountryFilter(req), ...extra };
}

/**
 * assertCountryAccess(path)
 *
 * Middleware guard: prevents a COUNTRY-scoped admin from writing to another
 * country's records when the target countryCode is in the request body/params.
 *
 * Usage:
 *   router.post("/orders", auth, countryScope, assertCountryAccess("body.countryCode"), handler);
 */
export function assertCountryAccess(countryCodePath = "body.countryCode") {
  return (req, res, next) => {
    if (!req.countryScope) return next(); // GLOBAL — no restriction

    const parts = countryCodePath.split(".");
    let target = req;
    for (const p of parts) target = target?.[p];

    if (!target) return next(); // No country in payload — allowed

    if (target !== req.countryScope) {
      return res.status(403).json({
        message: `Access denied: you can only manage ${req.countryScope} data`,
        error: true,
        success: false,
      });
    }

    next();
  };
}

/**
 * blockCountryScopedAdmins
 *
 * Hard-blocks COUNTRY-scoped admins from HQ-only modules: Pricing,
 * Inventory config, System Settings, etc. NOT used on the Logistics/
 * shipping routes any more — those are country-scoped now via
 * countryScopedPlugin on ShippingZone/ShippingMethod instead of a
 * hard block.
 *
 * Apply at route-group level for those modules.
 *
 * Usage:
 *   pricingRouter.use(auth, countryScope, blockCountryScopedAdmins);
 */
export function blockCountryScopedAdmins(req, res, next) {
  if (req.countryScope) {
    return res.status(403).json({
      message: "This module is centrally managed by HQ and is not available to country-level admins.",
      error: true,
      success: false,
    });
  }
  next();
}
