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
      "users.view", "users.manage",
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
    hqOnly: false,
  },

  // ── Content / marketing ────────────────────────────────────────────────────
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
    hqOnly: false,
  },

  GRAPHICS: {
    name: "Graphics / Designer",
    description: "Visual content — banners, sliders, and marketing imagery.",
    permissions: [
      "dashboard.view",
      "content.view", "content.manage",
      "blog.view",
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

  // ── Supply chain (HQ) ──────────────────────────────────────────────────────
  LOGISTICS: {
    name: "Logistics",
    description: "HQ logistics — shipping, tracking, logistics operations.",
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
    hqOnly: true,
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
