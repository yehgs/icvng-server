/**
 * config/permissions.js
 *
 * PHASE 2 — RBAC FOUNDATION
 *
 * The canonical, single source of truth for every granular permission in the
 * platform. Permissions are the atom of authorization; Roles (see
 * config/roles.js) are named bundles of these.
 *
 * Naming convention:  "<module>.<action>"
 *   action verbs: view · create · edit · delete · manage (= full CRUD+)
 *                 plus domain verbs where meaningful (refund, approve, export)
 *
 * Adding a permission here + granting it to roles in config/roles.js is all
 * that's needed to introduce a new capability. Nothing is hardcoded downstream.
 */

// ── Module keys ──────────────────────────────────────────────────────────────
export const MODULES = {
  DASHBOARD: "dashboard",
  PRODUCTS: "products",
  CATALOG: "catalog", // categories, subcategories, tags, attributes, brands, colors, roast areas
  ORDERS: "orders",
  CUSTOMERS: "customers",
  INVOICES: "invoices",
  COUPONS: "coupons",
  CONTENT: "content", // banners, sliders, fomo
  BLOG: "blog",
  CRM: "crm",
  PRODUCT_REQUESTS: "productRequests",
  ORDER_REQUESTS: "orderRequests", // B2B
  // ── HQ-only modules ──
  SUPPLIERS: "suppliers",
  PURCHASE_ORDERS: "purchaseOrders",
  STOCK: "stock",
  WAREHOUSE: "warehouse",
  PRICING: "pricing",
  EXCHANGE_RATES: "exchangeRates",
  LOGISTICS: "logistics",
  SHIPPING: "shipping",
  SCRAPER: "scraper",
  // ── System / admin ──
  USERS: "users",
  ROLES: "roles",
  COUNTRIES: "countries",
  TRANSLATIONS: "translations",
  FINANCE: "finance",
  REPORTS: "reports",
  SUPPORT: "support",
  NOTIFICATIONS: "notifications",
  ACTIVITY_LOGS: "activityLogs",
  PASSWORD_VAULT: "passwordVault",
  SETTINGS: "settings",
};

/**
 * Full permission catalogue.
 * Each entry: { key, module, description, hqOnly }
 * `hqOnly: true` means the permission is meaningless for country-scoped admins
 * and its routes should also carry blockCountryScopedAdmins.
 */
export const PERMISSIONS = [
  // Dashboard
  { key: "dashboard.view", module: MODULES.DASHBOARD, description: "View dashboard", hqOnly: false },
  { key: "dashboard.viewGlobal", module: MODULES.DASHBOARD, description: "View consolidated multi-country dashboard", hqOnly: true },

  // Products
  { key: "products.view", module: MODULES.PRODUCTS, description: "View products", hqOnly: false },
  { key: "products.create", module: MODULES.PRODUCTS, description: "Create products", hqOnly: false },
  { key: "products.edit", module: MODULES.PRODUCTS, description: "Edit products", hqOnly: false },
  { key: "products.delete", module: MODULES.PRODUCTS, description: "Delete products", hqOnly: false },

  // Catalog (categories/brands/tags/attributes/colors/roast areas)
  { key: "catalog.view", module: MODULES.CATALOG, description: "View catalog taxonomy", hqOnly: false },
  { key: "catalog.manage", module: MODULES.CATALOG, description: "Manage catalog taxonomy", hqOnly: false },

  // Orders
  { key: "orders.view", module: MODULES.ORDERS, description: "View orders", hqOnly: false },
  { key: "orders.create", module: MODULES.ORDERS, description: "Create offline orders", hqOnly: false },
  { key: "orders.edit", module: MODULES.ORDERS, description: "Edit orders / update status", hqOnly: false },
  { key: "orders.delete", module: MODULES.ORDERS, description: "Delete orders", hqOnly: false },
  { key: "orders.refund", module: MODULES.ORDERS, description: "Refund orders", hqOnly: false },

  // Customers
  { key: "customers.view", module: MODULES.CUSTOMERS, description: "View customers", hqOnly: false },
  { key: "customers.manage", module: MODULES.CUSTOMERS, description: "Create/edit customers", hqOnly: false },

  // Invoices
  { key: "invoices.view", module: MODULES.INVOICES, description: "View invoices", hqOnly: false },
  { key: "invoices.manage", module: MODULES.INVOICES, description: "Generate/upload/email invoices", hqOnly: false },

  // Coupons
  { key: "coupons.view", module: MODULES.COUPONS, description: "View coupons", hqOnly: false },
  { key: "coupons.manage", module: MODULES.COUPONS, description: "Create/edit/delete coupons", hqOnly: false },

  // Content (banners/sliders/fomo)
  { key: "content.view", module: MODULES.CONTENT, description: "View marketing content", hqOnly: false },
  { key: "content.manage", module: MODULES.CONTENT, description: "Manage banners/sliders/FOMO", hqOnly: false },

  // Blog
  { key: "blog.view", module: MODULES.BLOG, description: "View blog", hqOnly: false },
  { key: "blog.manage", module: MODULES.BLOG, description: "Manage blog posts/categories/tags", hqOnly: false },

  // CRM
  { key: "crm.view", module: MODULES.CRM, description: "View CRM leads", hqOnly: false },
  { key: "crm.manage", module: MODULES.CRM, description: "Manage CRM leads", hqOnly: false },

  // Product requests
  { key: "productRequests.view", module: MODULES.PRODUCT_REQUESTS, description: "View product requests", hqOnly: false },
  { key: "productRequests.manage", module: MODULES.PRODUCT_REQUESTS, description: "Manage product requests", hqOnly: false },

  // Order requests (B2B)
  { key: "orderRequests.view", module: MODULES.ORDER_REQUESTS, description: "View B2B order requests", hqOnly: false },
  { key: "orderRequests.manage", module: MODULES.ORDER_REQUESTS, description: "Manage B2B order requests", hqOnly: false },

  // ── HQ-only modules ──
  { key: "suppliers.view", module: MODULES.SUPPLIERS, description: "View suppliers", hqOnly: true },
  { key: "suppliers.manage", module: MODULES.SUPPLIERS, description: "Manage suppliers", hqOnly: true },

  { key: "purchaseOrders.view", module: MODULES.PURCHASE_ORDERS, description: "View purchase orders", hqOnly: true },
  { key: "purchaseOrders.manage", module: MODULES.PURCHASE_ORDERS, description: "Manage purchase orders", hqOnly: true },

  { key: "stock.view", module: MODULES.STOCK, description: "View stock", hqOnly: true },
  { key: "stock.manage", module: MODULES.STOCK, description: "Manage stock batches / distribution", hqOnly: true },
  { key: "stock.approve", module: MODULES.STOCK, description: "Approve stock distribution", hqOnly: true },

  { key: "warehouse.view", module: MODULES.WAREHOUSE, description: "View warehouses", hqOnly: true },
  { key: "warehouse.manage", module: MODULES.WAREHOUSE, description: "Manage warehouses", hqOnly: true },

  { key: "pricing.view", module: MODULES.PRICING, description: "View pricing", hqOnly: true },
  { key: "pricing.manage", module: MODULES.PRICING, description: "Manage pricing / calculations", hqOnly: true },
  { key: "pricing.export", module: MODULES.PRICING, description: "Export pricing data", hqOnly: true },

  { key: "exchangeRates.view", module: MODULES.EXCHANGE_RATES, description: "View exchange rates (admin)", hqOnly: true },
  { key: "exchangeRates.manage", module: MODULES.EXCHANGE_RATES, description: "Manage exchange rates", hqOnly: true },

  { key: "logistics.view", module: MODULES.LOGISTICS, description: "View logistics", hqOnly: true },
  { key: "logistics.manage", module: MODULES.LOGISTICS, description: "Manage logistics / tracking", hqOnly: true },

  { key: "shipping.view", module: MODULES.SHIPPING, description: "View shipping config", hqOnly: false },
  { key: "shipping.manage", module: MODULES.SHIPPING, description: "Manage shipping zones/methods", hqOnly: false },

  { key: "scraper.use", module: MODULES.SCRAPER, description: "Use the product scraper", hqOnly: false },
  { key: "scraper.admin", module: MODULES.SCRAPER, description: "Administer scraper quotas", hqOnly: false },

  // ── System / admin ──
  { key: "users.view", module: MODULES.USERS, description: "View users", hqOnly: false },
  { key: "users.manage", module: MODULES.USERS, description: "Create/edit/deactivate users", hqOnly: false },
  { key: "users.manageGlobal", module: MODULES.USERS, description: "Manage users across all countries", hqOnly: true },

  { key: "roles.view", module: MODULES.ROLES, description: "View roles & permissions", hqOnly: true },
  { key: "roles.manage", module: MODULES.ROLES, description: "Manage roles & permissions", hqOnly: true },

  { key: "countries.view", module: MODULES.COUNTRIES, description: "View countries", hqOnly: true },
  { key: "countries.manage", module: MODULES.COUNTRIES, description: "Create/edit/enable countries", hqOnly: true },

  { key: "translations.view", module: MODULES.TRANSLATIONS, description: "View translations", hqOnly: false },
  { key: "translations.manage", module: MODULES.TRANSLATIONS, description: "Manage translations", hqOnly: false },

  { key: "finance.view", module: MODULES.FINANCE, description: "View finance", hqOnly: false },
  { key: "finance.manage", module: MODULES.FINANCE, description: "Manage finance entries", hqOnly: false },

  { key: "reports.view", module: MODULES.REPORTS, description: "View reports", hqOnly: false },
  { key: "reports.viewGlobal", module: MODULES.REPORTS, description: "View consolidated reports", hqOnly: true },

  { key: "support.view", module: MODULES.SUPPORT, description: "View support tickets", hqOnly: false },
  { key: "support.manage", module: MODULES.SUPPORT, description: "Manage support tickets", hqOnly: false },

  { key: "notifications.view", module: MODULES.NOTIFICATIONS, description: "View notifications", hqOnly: false },
  { key: "notifications.manage", module: MODULES.NOTIFICATIONS, description: "Send/manage notifications", hqOnly: false },

  { key: "activityLogs.view", module: MODULES.ACTIVITY_LOGS, description: "View activity logs", hqOnly: false },

  { key: "passwordVault.view", module: MODULES.PASSWORD_VAULT, description: "View password vault", hqOnly: true },
  { key: "passwordVault.manage", module: MODULES.PASSWORD_VAULT, description: "Manage password vault", hqOnly: true },

  { key: "settings.view", module: MODULES.SETTINGS, description: "View settings", hqOnly: true },
  { key: "settings.manage", module: MODULES.SETTINGS, description: "Manage settings", hqOnly: true },
];

export const ALL_PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

const HQ_ONLY_SET = new Set(PERMISSIONS.filter((p) => p.hqOnly).map((p) => p.key));

/** Is this permission meaningless for country-scoped admins? */
export function isHqOnlyPermission(key) {
  return HQ_ONLY_SET.has(key);
}

/** Validate an arbitrary permission list against the catalogue. */
export function validatePermissionKeys(keys = []) {
  const valid = new Set(ALL_PERMISSION_KEYS);
  const unknown = keys.filter((k) => k !== "*" && !valid.has(k));
  return { ok: unknown.length === 0, unknown };
}

/** The wildcard "*" grants every permission (used by SUPER_ADMIN). */
export const WILDCARD = "*";

/** Expand a stored permission list ("*" → all keys). */
export function expandPermissions(keys = []) {
  if (keys.includes(WILDCARD)) return [...ALL_PERMISSION_KEYS];
  return keys;
}
