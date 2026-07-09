/**
 * core/guard.js
 *
 * PHASE 4 — one declarative guard composition that replaces the ad-hoc
 * middleware stacks scattered across route files.
 *
 * Usage:
 *   import { guard } from "../core/guard.js";
 *
 *   router.get("/orders", ...guard({ permissions: "orders.view" }), handler);
 *   router.post("/stock", ...guard({ permissions: "stock.manage", hqOnly: true }), handler);
 *   router.get("/public", ...guard({ public: true }), handler);   // no-op marker
 *
 * The returned array expands to the correct ordered middleware:
 *   auth → adminAuth → countryScope → [blockCountryScopedAdmins if hqOnly]
 *        → requirePermission(permissions, mode)
 *
 * Guards are TAGGED (via a symbol on the returned array) so the boot-time
 * route auditor can recognise a route as intentionally guarded — including
 * intentionally-public routes.
 */

import auth from "../middleware/auth.js";
import adminAuth from "../middleware/adminAuth.js";
import { countryScope, blockCountryScopedAdmins } from "../middleware/countryScope.js";
import { requirePermission } from "../middleware/requirePermission.js";

export const GUARD_TAG = Symbol("icvng.guard");

/**
 * @param {object} opts
 * @param {string|string[]} [opts.permissions]  required permission(s)
 * @param {"any"|"all"} [opts.mode="any"]
 * @param {boolean} [opts.hqOnly=false]         block country-scoped admins
 * @param {boolean} [opts.public=false]         explicitly public (no guards)
 * @param {boolean} [opts.authOnly=false]       just require a logged-in user
 *                                              (no admin/permission) — e.g.
 *                                              customer-facing authed routes
 * @returns {Function[]}  ordered middleware array, tagged for the auditor
 */
export function guard(opts = {}) {
  const {
    permissions,
    mode = "any",
    hqOnly = false,
    public: isPublic = false,
    authOnly = false,
  } = opts;

  let chain = [];

  if (isPublic) {
    chain = [];
  } else if (authOnly) {
    chain = [auth];
  } else {
    chain = [auth, adminAuth, countryScope];
    if (hqOnly) chain.push(blockCountryScopedAdmins);
    if (permissions) {
      chain.push(requirePermission(permissions, { mode }));
    }
  }

  // Tag the array so the auditor can see this route was deliberately guarded.
  Object.defineProperty(chain, GUARD_TAG, {
    value: { permissions, mode, hqOnly, public: isPublic, authOnly },
    enumerable: false,
  });
  return chain;
}

/** Convenience presets. */
export const guardPublic = () => {
  const chain = guard({ public: true });
  // A no-op tagged middleware so the auditor sees this route was deliberately
  // marked public (rather than accidentally left unguarded).
  const marker = (req, res, next) => next();
  marker.__isGuard = true;
  marker.__isPublicMarker = true;
  chain.push(marker);
  return chain;
};
export const guardAuthed = () => guard({ authOnly: true });
