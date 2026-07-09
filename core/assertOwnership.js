/**
 * core/assertOwnership.js
 *
 * PHASE 4 — belt-and-suspenders IDOR protection for detail/mutation endpoints.
 *
 * The countryScoped plugin already forces a scoped admin's queries to their
 * country, so `findById` of a foreign document returns null. This helper turns
 * that null (or an explicit country mismatch) into a clean 403/404 with an
 * audit-friendly message, and covers controllers that fetch with `.lean()` or
 * bypass hooks.
 *
 * Usage inside a controller, after fetching:
 *   const doc = await Model.findById(id);
 *   if (!assertCountryOwnership(req, res, doc)) return; // response already sent
 *
 * Or as route middleware factory when the resource is loaded by id param:
 *   router.get("/:id", ...guard({permissions:"orders.view"}),
 *     loadAndAssert(OrderModel, "id"), handler)
 */

import { getCountryScope } from "./requestContext.js";

/**
 * Returns true if the request may access `doc`; otherwise sends 404 and
 * returns false. GLOBAL admins (no scope) always pass.
 */
export function assertCountryOwnership(req, res, doc, opts = {}) {
  const field = opts.field || "countryCode";
  const scope = req.countryScope ?? getCountryScope();

  if (!doc) {
    res.status(404).json({ message: "Not found", error: true, success: false });
    return false;
  }
  // GLOBAL admin — unrestricted.
  if (!scope) return true;

  const docCountry = doc[field];
  // Documents without a country (legacy/global) are visible to all until
  // backfilled; once backfilled + required, this branch won't be hit.
  if (docCountry == null) return true;

  if (docCountry !== scope) {
    // Behave as "not found" to avoid leaking existence across countries.
    res.status(404).json({ message: "Not found", error: true, success: false });
    return false;
  }
  return true;
}

/**
 * Route-middleware form: loads Model.findById(req.params[param]), asserts
 * ownership, and stashes the doc on req.loadedDoc for the handler.
 */
export function loadAndAssert(Model, param = "id", opts = {}) {
  return async (req, res, next) => {
    try {
      const doc = await Model.findById(req.params[param]);
      if (!assertCountryOwnership(req, res, doc, opts)) return;
      req.loadedDoc = doc;
      next();
    } catch (err) {
      res.status(400).json({
        message: "Invalid identifier",
        error: true,
        success: false,
      });
    }
  };
}
