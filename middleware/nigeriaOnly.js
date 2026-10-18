/**
 * middleware/nigeriaOnly.js
 *
 * Gate for modules that belong to the Nigerian business only (barista
 * training / coffee-machine rental requests).
 *
 * Must run AFTER auth + countryScope (needs req.countryScope):
 *   req.countryScope === null  → GLOBAL / HQ admin (IT, Director, HQ Manager…) → allowed
 *   req.countryScope === "NG"  → Nigeria-scoped admin                           → allowed
 *   anything else ("TG", "IT", "BJ"…) → a foreign country admin                 → 403
 */
const BOOKING_COUNTRY = "NG"; // keep in sync with models/booking-request.model.js

export function nigeriaOnly(req, res, next) {
  if (!req.countryScope || req.countryScope === BOOKING_COUNTRY) return next();
  return res.status(403).json({
    message: "This module is only available to the Nigeria team.",
    error: true,
    success: false,
  });
}
