/**
 * controllers/capabilities.controller.js
 *
 * PHASE 2 — RBAC FOUNDATION
 *
 * GET /api/admin/me/capabilities
 *
 * The single object the admin SPA fetches at login to drive the sidebar,
 * route guards, and button-level gating. Replaces the scattered
 * allowedSubRoles arrays in App.jsx / AdminSidebar / RoleBasedButton with one
 * server-authoritative source of truth.
 *
 * Returns:
 *   {
 *     userId, name, email, subRole,
 *     scope, country,            // territory
 *     department,                // (nullable until Phase 2.x departments)
 *     languages: { default, supported },
 *     permissions: [...],        // effective, expanded permission keys
 *     isHQ, isGlobal
 *   }
 */

import { getEffectivePermissions } from "../middleware/requirePermission.js";
import { getCountryByCode, DEFAULT_COUNTRY } from "../config/countries/index.js";

export async function getMyCapabilities(req, res) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        message: "Authentication required",
        error: true,
        success: false,
      });
    }

    const permissions = [...getEffectivePermissions(user)].sort();
    const isGlobal = user.scope !== "COUNTRY";
    const countryCode = isGlobal ? null : user.assignedCountry;
    const country = countryCode ? getCountryByCode(countryCode) : null;

    // HQ = a GLOBAL-scoped admin (they operate from Nigeria HQ). Country admins
    // are not HQ regardless of role.
    const isHQ = isGlobal;

    const languages = country
      ? {
          default: country.language?.default || "en",
          supported: country.language?.supported || ["en"],
        }
      : {
          default: getCountryByCode(DEFAULT_COUNTRY).language?.default || "en",
          supported: ["en", "fr", "it"],
        };

    return res.json({
      error: false,
      success: true,
      data: {
        userId: user._id,
        name: user.name,
        email: user.email,
        subRole: user.subRole,
        scope: user.scope || "GLOBAL",
        country: countryCode,
        countryName: country?.name || null,
        department: user.department || null,
        preferredLanguage: user.preferredLanguage || languages.default,
        languages,
        permissions,
        isHQ,
        isGlobal,
      },
    });
  } catch (error) {
    console.error("getMyCapabilities error:", error);
    return res.status(500).json({
      message: "Failed to resolve capabilities",
      error: true,
      success: false,
    });
  }
}
