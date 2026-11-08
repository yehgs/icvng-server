// server/utils/campaignScope.js
//
// Who may touch WHICH country's campaigns. This is deliberately stricter than
// the generic countryScope middleware, because that middleware treats every
// HQ_ONLY role (EDITOR, ACCOUNTANT, WAREHOUSE) as GLOBAL — fine for modules
// where an HQ role works across markets, wrong for campaigns, where a Togo
// campaign must never be editable by a generic HQ role.
//
// Policy — identical in spirit to order visibility (PRD §9a.2):
//   IT, DIRECTOR              → every country (may pick one explicitly)
//   COUNTRY-scoped admin      → only their assignedCountry
//                               (e.g. a Togo MANAGER)
//   every other admin         → Nigeria (HQ) only; a null/global `scope` on
//                               an operational role NEVER grants other markets
//
// Capability (can this role do X?) is checked separately by requirePermission.

import { ALL_COUNTRY_CODES, DEFAULT_COUNTRY } from "../config/countries/index.js";

export const CAMPAIGN_GLOBAL_SUBROLES = ["IT", "DIRECTOR"];

/** @returns {{ isGlobal:boolean, countryCode:string|null }} countryCode is null only for global admins. */
export function resolveCampaignScope(user) {
  if (!user || user.role !== "ADMIN") return { isGlobal: false, countryCode: null, denied: true };
  if (CAMPAIGN_GLOBAL_SUBROLES.includes(user.subRole)) return { isGlobal: true, countryCode: null };
  if (user.scope === "COUNTRY" && user.assignedCountry && ALL_COUNTRY_CODES.includes(user.assignedCountry)) {
    return { isGlobal: false, countryCode: user.assignedCountry };
  }
  return { isGlobal: false, countryCode: DEFAULT_COUNTRY };
}

export const normalizeCountry = (c) => {
  const code = String(c || "").toUpperCase();
  return ALL_COUNTRY_CODES.includes(code) ? code : null;
};

/**
 * Mongo filter that confines a query to what this admin may see.
 * `requested` is an optional ?countryCode= — honoured ONLY for global admins.
 */
export function campaignCountryFilter(scope, requested) {
  if (scope.denied) return { countryCode: "__none__" };
  if (scope.isGlobal) {
    const c = normalizeCountry(requested);
    return c ? { countryCode: c } : {};
  }
  return { countryCode: scope.countryCode };
}

/**
 * Country a NEW record is created in.
 * Non-global admins: always their own; a different submitted value is rejected
 * (never silently overridden, so tampering is visible as a 403).
 * Global admins: must name a valid country explicitly.
 */
export function resolveCreateCountry(scope, requested) {
  if (scope.denied) return { error: { status: 403, message: "Admin access required" } };
  const req = requested ? normalizeCountry(requested) : null;
  if (requested && !req) return { error: { status: 400, message: "Unknown country" } };
  if (scope.isGlobal) {
    if (!req) return { error: { status: 400, message: "countryCode is required" } };
    return { countryCode: req };
  }
  if (req && req !== scope.countryCode) {
    return { error: { status: 403, message: `Access denied: you can only manage ${scope.countryCode} campaigns` } };
  }
  return { countryCode: scope.countryCode };
}
