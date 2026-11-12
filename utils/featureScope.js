// server/utils/featureScope.js
//
// WHOSE country's records may an admin touch — shared by seasonal campaigns,
// email marketing and the HR module. Deliberately stricter than the generic
// countryScope middleware (which treats unscoped roles as GLOBAL):
//
//   IT, DIRECTOR              → every country (may pick one explicitly)
//   COUNTRY-scoped admin      → only their assignedCountry (e.g. a Togo MANAGER,
//                               a Togo ACCOUNTANT, a Benin HR)
//   every other admin         → Nigeria (HQ) only. A null/global `scope` on an
//                               operational role NEVER grants other markets.
//
// Capability (can this role do X?) is checked separately by requirePermission.
import { ALL_COUNTRY_CODES, DEFAULT_COUNTRY } from "../config/countries/index.js";

export const FEATURE_GLOBAL_SUBROLES = ["IT", "DIRECTOR"];

/** @returns {{ isGlobal:boolean, countryCode:string|null, denied?:boolean }} countryCode is null only for global admins. */
export function resolveFeatureScope(user) {
  if (!user || user.role !== "ADMIN") return { isGlobal: false, countryCode: null, denied: true };
  if (FEATURE_GLOBAL_SUBROLES.includes(user.subRole)) return { isGlobal: true, countryCode: null };
  if (user.scope === "COUNTRY" && user.assignedCountry && ALL_COUNTRY_CODES.includes(user.assignedCountry)) {
    return { isGlobal: false, countryCode: user.assignedCountry };
  }
  return { isGlobal: false, countryCode: DEFAULT_COUNTRY };
}

export const normalizeCountry = (c) => {
  const code = String(c || "").toUpperCase();
  return ALL_COUNTRY_CODES.includes(code) ? code : null;
};

/** Mongo filter confining a query to what this admin may see. `requested` is honoured ONLY for global admins. */
export function featureCountryFilter(scope, requested) {
  if (scope.denied) return { countryCode: "__none__" };
  if (scope.isGlobal) {
    const c = normalizeCountry(requested);
    return c ? { countryCode: c } : {};
  }
  return { countryCode: scope.countryCode };
}

/**
 * Country a NEW record is created in. Non-global admins always get their own;
 * a different submitted value is rejected (never silently overridden, so
 * tampering is visible as a 403). Global admins must name a valid country.
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
    return { error: { status: 403, message: `Access denied: you can only manage ${scope.countryCode} data` } };
  }
  return { countryCode: scope.countryCode };
}

/** True when `countryCode` is inside the caller's territory. */
export function canAccessCountry(scope, countryCode) {
  if (scope.denied) return false;
  return scope.isGlobal || scope.countryCode === countryCode;
}
