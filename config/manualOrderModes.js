/**
 * config/manualOrderModes.js
 *
 * THE single definition of what ONLINE and OFFLINE mean for manual orders.
 * Imported by the server controller, the validation helpers, and mirrored by
 * the admin at admin/src/config/manualOrderModes.js.
 *
 * ── CORRECTION TO THE 2026-08-28 CHANGE ──────────────────────────────────
 * The previous revision retired BTB entirely and forced every manual order
 * to BTC. That was wrong. BTB is not dead — it is the OFFLINE half of a
 * two-mode system:
 *
 *   ONLINE  → BTC customers, btcPrice, storefront stock rules
 *   OFFLINE → BTB customers, btbPrice, warehouse offline stock
 *
 * The BTC-only rejection has been removed from
 * createAdminOrderController accordingly.
 *
 * ── WHY MODE IS DERIVED, NOT SUBMITTED ───────────────────────────────────
 * For a SALES agent the mode is NOT a choice — it is a property of their
 * account (`user.userMode`, already on the User model as ONLINE/OFFLINE).
 * An online agent must not be able to raise a BTB warehouse sale, and an
 * offline agent must not be able to draw down storefront stock. Letting the
 * client pick the mode and merely validating it afterwards would mean the
 * UI lock is the only thing enforcing the rule, and a UI lock is not a
 * control. So the server DERIVES the mode from the account and ignores what
 * the client sent, except for IT/DIRECTOR/MANAGER who legitimately work
 * across both.
 */

export const ORDER_MODES = ["ONLINE", "OFFLINE"];

/** Mode → the customer/pricing type that mode transacts in. */
export const MODE_ORDER_TYPE = {
  ONLINE: "BTC",
  OFFLINE: "BTB",
};

/** subRoles that may work in BOTH modes and therefore choose. */
export const DUAL_MODE_SUBROLES = ["IT", "DIRECTOR", "MANAGER"];

/** Every subRole allowed to create a manual order at all. */
export const MANUAL_ORDER_SUBROLES = [...DUAL_MODE_SUBROLES, "SALES"];

/**
 * Resolve which mode this user is creating an order in.
 *
 * @param {{subRole: string, userMode?: string}} user
 * @param {string} [requestedMode]  what the client asked for
 * @returns {{mode: string|null, locked: boolean, error: string|null}}
 *
 * `locked: true` means the mode came from the account, not the request —
 * the admin UI uses this to disable the selector rather than let an agent
 * pick something the server will reject.
 */
export function resolveOrderMode(user, requestedMode) {
  if (!user || !MANUAL_ORDER_SUBROLES.includes(user.subRole)) {
    return { mode: null, locked: true, error: "Not permitted to create manual orders" };
  }

  // IT / DIRECTOR / MANAGER choose freely.
  if (DUAL_MODE_SUBROLES.includes(user.subRole)) {
    const wanted = (requestedMode || "").toUpperCase();
    if (wanted && !ORDER_MODES.includes(wanted)) {
      return { mode: null, locked: false, error: `Unknown order mode "${requestedMode}"` };
    }
    return { mode: wanted || "ONLINE", locked: false, error: null };
  }

  // SALES: the account decides. A SALES account with no userMode set is a
  // configuration error, not a default — defaulting it would silently give
  // an offline agent access to storefront stock (or the reverse), so we
  // refuse and say what to fix.
  const accountMode = (user.userMode || "").toUpperCase();
  if (!ORDER_MODES.includes(accountMode)) {
    return {
      mode: null,
      locked: true,
      error:
        "Your account has no sales mode set. Ask IT or a Director to set your Sales Mode to Online or Offline.",
    };
  }
  return { mode: accountMode, locked: true, error: null };
}

/** The order type implied by a mode. Never accept orderType from a client. */
export function orderTypeForMode(mode) {
  return MODE_ORDER_TYPE[mode] || null;
}

/**
 * Which User-model customers are eligible in this mode.
 * Storefront registrations are role USER / subRole BTC, so they are the
 * ONLINE pool. BTB users are the OFFLINE pool.
 */
export function userSubRoleForMode(mode) {
  return mode === "OFFLINE" ? "BTB" : "BTC";
}
