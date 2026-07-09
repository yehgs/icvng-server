/**
 * middleware/requirePermission.js
 *
 * PHASE 2 — RBAC FOUNDATION
 *
 * Permission-based authorization, designed to run alongside (and eventually
 * replace) the subRole-list requireRole guard.
 *
 * Resolution order for a user's effective permissions:
 *   1. Start from their role bundle (config/roles.js, keyed by subRole).
 *      A DB-backed Role can override this later; the config is the fallback.
 *   2. Add user.extraPermissions[] (per-user grants).
 *   3. Subtract user.deniedPermissions[] (per-user denials).
 *   WILDCARD "*" means "all permissions" (DIRECTOR / IT), minus any denials.
 *
 * Country-scope note: this middleware answers "CAN this role do X?". It does
 * NOT answer "on WHOSE data?" — that stays with countryScope + the HQ-only
 * blockCountryScopedAdmins guard. Capability and territory remain orthogonal.
 */

import {
  ALL_PERMISSION_KEYS,
  WILDCARD,
  isHqOnlyPermission,
} from "../config/permissions.js";
import { permissionsForSubRole } from "../config/roles.js";

/**
 * Compute a user's effective, expanded permission Set.
 * @param {object} user  Mongoose user doc (needs subRole, extraPermissions?, deniedPermissions?)
 * @returns {Set<string>}
 */
export function getEffectivePermissions(user) {
  if (!user || user.role !== "ADMIN") return new Set();

  const extra = user.extraPermissions || [];
  const denied = user.deniedPermissions || [];
  const raw = permissionsForSubRole(user.subRole, extra, denied);

  let keys;
  if (raw.includes(WILDCARD)) {
    keys = [...ALL_PERMISSION_KEYS];
  } else {
    keys = raw;
  }

  // Apply denials last so they win even against wildcard.
  if (denied.length) {
    const deny = new Set(denied);
    keys = keys.filter((k) => !deny.has(k));
  }

  return new Set(keys);
}

/** Does this user hold a given permission? */
export function userHasPermission(user, permissionKey) {
  return getEffectivePermissions(user).has(permissionKey);
}

/** Does this user hold ALL of the given permissions? */
export function userHasAllPermissions(user, keys = []) {
  const held = getEffectivePermissions(user);
  return keys.every((k) => held.has(k));
}

/** Does this user hold ANY of the given permissions? */
export function userHasAnyPermission(user, keys = []) {
  const held = getEffectivePermissions(user);
  return keys.some((k) => held.has(k));
}

/**
 * requirePermission(keyOrKeys, opts)
 *
 * @param {string|string[]} required   one key, or a list.
 * @param {object} [opts]
 * @param {"any"|"all"} [opts.mode="any"]  when a list is given.
 *
 * Must run AFTER auth (needs req.user). adminAuth is recommended before it so
 * non-admins get a clean 403 without touching the permission logic.
 */
export function requirePermission(required, opts = {}) {
  const keys = Array.isArray(required) ? required : [required];
  const mode = opts.mode === "all" ? "all" : "any";

  const mw = (req, res, next) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        message: "Authentication required",
        error: true,
        success: false,
      });
    }
    if (user.role !== "ADMIN") {
      return res.status(403).json({
        message: "Admin access required",
        error: true,
        success: false,
      });
    }

    const held = getEffectivePermissions(user);
    const ok =
      mode === "all"
        ? keys.every((k) => held.has(k))
        : keys.some((k) => held.has(k));

    if (ok) return next();

    return res.status(403).json({
      message: `Access denied. Required permission${keys.length > 1 ? `s (${mode})` : ""}: ${keys.join(", ")}`,
      error: true,
      success: false,
    });
  };
  mw.__isGuard = true;
  return mw;
}

/**
 * DUAL-RUN SHADOW MODE (migration safety net).
 *
 * Wraps an existing requireRole-guarded route: enforces the OLD role check as
 * the real gate, but logs whenever the NEW permission check would have decided
 * differently. Lets us prove the permission model matches current behaviour
 * before flipping the switch — no user is affected while shadowing.
 *
 * Usage (temporary, during Phase 2 rollout):
 *   router.get("/x", auth, adminAuth,
 *     shadowPermission(requireRole(["SALES"]), "orders.view"), handler);
 */
export function shadowPermission(realGuard, permissionKey) {
  return (req, res, next) => {
    // Intercept the real guard's decision without sending its response yet.
    let realDecision = "allow";
    const fakeRes = {
      status: () => ({ json: () => { realDecision = "deny"; } }),
    };
    realGuard(req, fakeRes, () => { realDecision = "allow"; });

    const permitDecision = userHasPermission(req.user, permissionKey)
      ? "allow"
      : "deny";

    if (realDecision !== permitDecision) {
      console.warn(
        `[RBAC-SHADOW] mismatch on ${req.method} ${req.originalUrl} ` +
          `— role=${req.user?.subRole} realGuard=${realDecision} ` +
          `permission(${permissionKey})=${permitDecision}`
      );
    }

    // Enforce the REAL (old) decision during shadow mode.
    if (realDecision === "allow") return next();
    return res.status(403).json({
      message: "Access denied",
      error: true,
      success: false,
    });
  };
}

export { isHqOnlyPermission };
