/**
 * config/roles.js
 *
 * PHASE 2 — RBAC FOUNDATION
 *
 * Named permission bundles. These are seeded into the Role collection but this
 * file remains the source of truth / fallback (same pattern as COUNTRY_CONFIG).
 *
 * CRITICAL DESIGN CONSTRAINT — backward compatibility:
 *   Every role key here is an existing subRole value. The permission set for
 *   each role is derived directly from what that subRole could already do
 *   (per the admin UI's allowedSubRoles and the backend's requireRole lists),
 *   so switching from requireRole → requirePermission changes NObody's access.
 *
 *   Capability (this file) and territory (user.scope / assignedCountry) stay
 *   orthogonal: the same DIRECTOR role is used at HQ (scope GLOBAL) and could
 *   in principle be used country-scoped; scope alone decides data visibility.
 */

import { WILDCARD } from "./permissions.js";

/**
 * ROLE_DEFINITIONS[subRole] = {
 *   name, description,
 *   permissions: [...],       // explicit keys, or [WILDCARD]
 *   isSystem: true,           // system roles cannot be deleted
 *   hqOnly: bool,             // role only makes sense at HQ (informational)
 * }
 */
export const ROLE_DEFINITIONS = {
  // ── Full-power HQ roles ────────────────────────────────────────────────────
  DIRECTOR: {
    name: "Director",
    description: "Executive — full access to every module across all countries.",
    permissions: [WILDCARD],
    isSystem: true,
    hqOnly: true,
  },
  IT: {
    name: "IT Administrator",
    description: "System administrator — full technical access across all modules.",
    permissions: [WILDCARD],
    isSystem: true,
    hqOnly: true,
  },

  // ── Management ─────────────────────────────────────────────────────────────
  MANAGER: {
    name: "Manager",
    description: "Operational manager — broad access excluding system settings and role management.",
    permissions: [
      "dashboard.view", "dashboard.viewGlobal",
      "products.view", "products.create", "products.edit", "products.delete",
      "catalog.view", "catalog.manage",
      "orders.view", "orders.create", "orders.edit", "orders.refund",
      "customers.view", "customers.manage",
      "invoices.view", "invoices.manage",
      "coupons.view", "coupons.manage",
      "content.view", "content.manage",
      "blog.view", "blog.manage",
      "crm.view", "crm.manage",
      "contact.view", "contact.manage",
      "productRequests.view", "productRequests.manage",
      "orderRequests.view", "orderRequests.manage",
      "suppliers.view",
      "purchaseOrders.view", "purchaseOrders.manage",
      "stock.view", "stock.manage",
      "warehouse.view", "warehouse.manage",
      "pricing.view", "pricing.manage", "pricing.export",
      "exchangeRates.view", "exchangeRates.manage",
      "logistics.view", "logistics.manage",
      "shipping.view", "shipping.manage",
      "scraper.use", "scraper.admin",
      // Intentionally NO "users.view"/"users.manage" — MANAGER (HQ or
      // country/"foreign" scoped) must not see or touch User Management.
      // That stays with IT, DIRECTOR (full) and HR (bounded). See item #8.
      "translations.view", "translations.manage",
      "finance.view",
      "reports.view", "reports.viewGlobal",
      "support.view", "support.manage",
      "notifications.view", "notifications.manage",
      "activityLogs.view",
    ],
    isSystem: true,
    hqOnly: false,
  },

  SALES_MANAGER: {
    name: "Sales Manager",
    description: "Leads the sales function — orders, customers, CRM, logistics visibility.",
    permissions: [
      "dashboard.view",
      "products.view", "catalog.view",
      "orders.view", "orders.create", "orders.edit", "orders.refund",
      "customers.view", "customers.manage",
      "invoices.view", "invoices.manage",
      "coupons.view", "coupons.manage",
      "crm.view", "crm.manage",
      "contact.view", "contact.manage",
      "productRequests.view", "productRequests.manage",
      "orderRequests.view", "orderRequests.manage",
      "logistics.view",
      "scraper.use",
      "reports.view",
      "support.view", "support.manage",
      "notifications.view",
    ],
    isSystem: true,
    hqOnly: false,
  },

  // ── Sales / customer-facing ────────────────────────────────────────────────
  SALES: {
    name: "Sales Agent",
    description: "Front-line sales — orders, customers, product requests, scraper.",
    permissions: [
      "dashboard.view",
      "products.view", "catalog.view",
      "orders.view", "orders.create", "orders.edit",
      "customers.view", "customers.manage",
      "invoices.view", "invoices.manage",
      "coupons.view", "coupons.manage",
      "crm.view", "crm.manage",
      "contact.view", "contact.manage",
      "productRequests.view", "productRequests.manage",
      "orderRequests.view", "orderRequests.manage",
      "scraper.use",
      "reports.view",
      "support.view",
      "notifications.view",
    ],
    isSystem: true,
    hqOnly: false,
  },

  // ── Finance ────────────────────────────────────────────────────────────────
  // Item #9: there is only ever ONE Accountant role, and it's always HQ —
  // no country/"foreign" Accountant accounts. Every Accountant is managed
  // from HQ, same as Warehouse. hqOnly: true means the user-creation UI
  // never offers a "Country Admin" toggle for this subRole, and the backend
  // forces scope to GLOBAL regardless of what's submitted (see
  // admin_user.controller.js resolveScopeForSubRole).
  ACCOUNTANT: {
    name: "Accountant",
    description: "Finance and pricing — invoices, finance entries, pricing, exchange rates.",
    permissions: [
      "dashboard.view",
      "products.view", "catalog.view",
      "orders.view",
      "customers.view",
      "invoices.view", "invoices.manage",
      "purchaseOrders.view",
      "pricing.view", "pricing.manage", "pricing.export",
      "exchangeRates.view", "exchangeRates.manage",
      "finance.view", "finance.manage",
      "reports.view",
      "notifications.view",
      "activityLogs.view",
    ],
    isSystem: true,
    hqOnly: true,
  },

  // ── Content / marketing ────────────────────────────────────────────────────
  // Item #9: same as Accountant/Warehouse — always HQ, no foreign Editor.
  EDITOR: {
    name: "Content Editor",
    description: "Content and catalog — products, catalog, blog, banners, sliders, translations.",
    permissions: [
      "dashboard.view",
      "products.view", "products.create", "products.edit", "products.delete",
      "catalog.view", "catalog.manage",
      "content.view", "content.manage",
      "blog.view", "blog.manage",
      "coupons.view", "coupons.manage",
      "crm.view",
      "pricing.view", // direct-pricing page allowed EDITOR
      "scraper.use",
      "translations.view", "translations.manage",
      "notifications.view",
    ],
    isSystem: true,
    hqOnly: true,
  },

  GRAPHICS: {
    name: "Graphics / Designer",
    description: "Visual content only — images on products, brands, categories, subcategories, customer profile photos, banners, sliders, and marketing imagery. No access to any other admin module (pricing, stock, orders, CRM, etc.) — see the image-only strip in product/brand/category/subCategory/customer controllers for the enforcement (GRAPHICS never gets full edit rights, only the image field).",
    permissions: [
      "dashboard.view", // their OWN custom dashboard — see admin/src/pages/graphics/GraphicsDashboard.jsx
      "products.view", "products.edit", // edit restricted server-side to the image field only
      "catalog.view", "catalog.manage", // brand/category/subCategory — same image-only restriction
      "customers.view", "customers.manage", // customer profile photo only
      "content.view", "content.manage", // banners/sliders/FOMO/home-content — all image-bearing
      "notifications.view",
    ],
    isSystem: true,
    hqOnly: false,
  },

  // ── HR ─────────────────────────────────────────────────────────────────────
  HR: {
    name: "Human Resources",
    description: "People operations — user management (bounded), stock/warehouse visibility.",
    permissions: [
      "dashboard.view",
      "users.view", "users.manage",
      "orders.view",        // admin-order backend is auth-only today; sidebar lists HR
      "customers.view",
      "stock.view",
      "warehouse.view",
      "reports.view",
      "notifications.view",
      "activityLogs.view",
    ],
    isSystem: true,
    hqOnly: false,
  },

  // ── Supply chain (country-scoped) ───────────────────────────────────────────
  // COUNTRY-SCOPE LOGISTICS: as of the country-scoped logistics rollout, a
  // LOGISTICS admin assigned to a country (scope: "COUNTRY", assignedCountry:
  // "TG") manages ONLY that country's shipping zones/methods — the
  // countryScopedPlugin on ShippingZone/ShippingMethod enforces this at the
  // query level, independent of every other country's LOGISTICS admin. A
  // LOGISTICS admin can also be created at HQ with scope GLOBAL (e.g. a
  // Nigeria-based/head office logistics lead) — GLOBAL scope is optional for
  // this role, not forced either way. Only IT and DIRECTOR (both permanently
  // GLOBAL — see HQ_ONLY_SUBROLES) can see/manage every country's zones and
  // methods at once.
  LOGISTICS: {
    name: "Logistics",
    description: "Shipping, tracking, logistics operations — scoped to one country unless created at HQ.",
    permissions: [
      "dashboard.view",
      "logistics.view", "logistics.manage",
      "shipping.view", "shipping.manage",
      "purchaseOrders.view",
      "orders.view",
      "reports.view",
      "notifications.view",
    ],
    isSystem: true,
    hqOnly: false,
  },

  WAREHOUSE: {
    name: "Warehouse",
    description: "HQ inventory — stock, warehouse, purchase-order fulfilment.",
    permissions: [
      "dashboard.view",
      "products.view", "catalog.view",
      "suppliers.view",
      "purchaseOrders.view", "purchaseOrders.manage",
      "stock.view", "stock.manage",
      "warehouse.view", "warehouse.manage",
      "reports.view",
      "notifications.view",
    ],
    isSystem: true,
    hqOnly: true,
  },
};

/** subRoles that represent customers, not staff — no admin role bundle. */
export const CUSTOMER_SUBROLES = ["BTC", "BTB"];

/**
 * subRoles that can NEVER be country/"foreign" scoped — always scope
 * GLOBAL, assignedCountry null, every account managed from HQ.
 *
 * Currently: IT, DIRECTOR, ACCOUNTANT, WAREHOUSE, EDITOR.
 *
 * Note — LOGISTICS came OUT of this list once the country-scoped logistics
 * system (ShippingZone/ShippingMethod countryScopedPlugin) shipped. It can
 * now be assigned per-country like MANAGER/SALES/etc, or left GLOBAL for an
 * HQ-based logistics lead — see the ROLE_DEFINITIONS.LOGISTICS comment.
 */
export const HQ_ONLY_SUBROLES = Object.entries(ROLE_DEFINITIONS)
  .filter(([, def]) => def.hqOnly)
  .map(([subRole]) => subRole);

/**
 * resolveScopeForSubRole(subRole, requestedScope, requestedCountry)
 *
 * Single source of truth for "what scope should this user end up with",
 * used by both createUserController and updateUserController so the rule
 * can never drift between the two. HQ-only subRoles always resolve to
 * GLOBAL/null no matter what was requested (defense in depth — the admin
 * UI also hides the toggle for these subRoles, but the backend must not
 * trust the client).
 */
export function resolveScopeForSubRole(subRole, requestedScope, requestedCountry) {
  if (HQ_ONLY_SUBROLES.includes(subRole)) {
    return { scope: "GLOBAL", assignedCountry: null };
  }
  if (requestedScope === "COUNTRY" && requestedCountry) {
    return { scope: "COUNTRY", assignedCountry: requestedCountry };
  }
  return { scope: "GLOBAL", assignedCountry: null };
}

/**
 * Resolve the effective permission keys for a user given their subRole plus
 * any per-user overrides. Kept dependency-free so it can be reused in tests.
 *
 * @param {string} subRole
 * @param {string[]} [extraPermissions=[]]   granted on top of the role
 * @param {string[]} [deniedPermissions=[]]  removed even if the role grants
 * @returns {string[]}  raw list (may contain WILDCARD; expand before checks)
 */
export function permissionsForSubRole(subRole, extraPermissions = [], deniedPermissions = []) {
  const def = ROLE_DEFINITIONS[subRole];
  const base = def ? [...def.permissions] : [];
  const withExtra = Array.from(new Set([...base, ...extraPermissions]));
  if (!deniedPermissions.length) return withExtra;
  const denied = new Set(deniedPermissions);
  // Wildcard minus denials is handled at expansion time; here we just keep the
  // wildcard and let the checker subtract denials. If no wildcard, filter now.
  if (withExtra.includes("*")) return withExtra;
  return withExtra.filter((k) => !denied.has(k));
}
