/**
 * core/routeAuditor.js
 *
 * PHASE 4 — walks the Express router tree at boot and reports any admin/HQ
 * route that lacks an authorization guard. Turns "someone forgot to protect a
 * route" from a silent security hole into a startup-time signal.
 *
 * A route is considered GUARDED if its middleware stack includes any of:
 *   - our auth middleware (function name "auth")
 *   - adminAuth
 *   - requirePermission's returned closure (name "requirePermissionMw" — we
 *     tag it) OR requireRole's closure
 *   - it's listed in PUBLIC_ALLOWLIST (intentionally public)
 *
 * Because Express doesn't expose middleware names reliably across versions, we
 * detect guards by matching known middleware function references passed in.
 *
 * Modes (env AUDIT_ROUTES):
 *   "warn" (default) → log unguarded routes, continue boot
 *   "strict"         → throw on any unguarded admin route (fail fast in CI/prod)
 *   "off"            → skip entirely
 */

// Route path prefixes that legitimately serve unauthenticated traffic.
// These are storefront/customer/public endpoints.
const PUBLIC_ALLOWLIST = [
  "/",
  "/api/file",              // uploads have their own handling
  "/api/country",           // storefront reads current country
  "/api/translations",      // client reads translations
  "/api/seo",               // SEO files
  "/api/auth/google",       // OAuth
  "/api/user",              // register/login/verify live here
  "/api/category",
  "/api/subcategory",
  "/api/product",
  "/api/tag",
  "/api/brand",
  "/api/compatible",
  "/api/rating",
  "/api/attribute",
  "/api/cart",
  "/api/address",
  "/api/order",             // includes webhook + customer order flows
  "/api/coffee-roast-area",
  "/api/slider",
  "/api/banner",
  "/api/product-request",
  "/api/wishlist",
  "/api/compare",
  "/api/admin/auth",        // login endpoint is public; stats is guarded inside
  "/api/colors",
  "/api/shipping",
  "/api/blog",
  "/api/fomo",
  "/api/send-email",
  "/api/order-requests",
  "/api/coupons",           // has public validate endpoints
  "/api/btb-auth",
  "/api/exchange-rates",    // /get is public; rest guarded inside
  "/api/guest-order",
  "/api/direct-pricing",    // guarded at router level (verified separately)
];

// Admin/HQ prefixes that MUST be guarded.
const MUST_GUARD_PREFIXES = [
  "/api/admin",
  "/api/suppliers",
  "/api/purchase-orders",
  "/api/stock",
  "/api/pricing",
  "/api/warehouse",
  "/api/invoices",
  "/api/activity-logs",
];

function isAllowlisted(path) {
  return PUBLIC_ALLOWLIST.some((p) => path === p || path.startsWith(p + "/"));
}

function mustGuard(path) {
  return MUST_GUARD_PREFIXES.some((p) => path === p || path.startsWith(p));
}

/**
 * Extract mounted paths + their middleware stacks from an Express app.
 * Returns [{ path, guards: string[] }].
 */
function collectRoutes(app, knownGuards) {
  const out = [];
  const stack = app._router?.stack || app.router?.stack || [];

  const guardNames = new Set(knownGuards);
  const isGuardFn = (fn) =>
    !!fn && (fn.__isGuard === true || guardNames.has(fn.name));

  function layerHasGuard(handleStack = []) {
    return handleStack.some((l) => isGuardFn(l.handle));
  }

  for (const layer of stack) {
    if (layer.name === "router" && layer.handle?.stack) {
      // Mounted sub-router. Derive its mount path from the regexp.
      const mount = layer.regexp?.source ? regexpToPath(layer.regexp) : "";
      const subStack = layer.handle.stack || [];
      // router.use(auth, ...) appears as middleware layers (no .route).
      const routerLevelGuarded = subStack.some(
        (l) => !l.route && isGuardFn(l.handle)
      );
      let hadRoute = false;
      for (const sub of subStack) {
        if (sub.route) {
          hadRoute = true;
          const full = mount + (sub.route.path === "/" ? "" : sub.route.path);
          const guarded = routerLevelGuarded || layerHasGuard(sub.route.stack);
          // Track whether the route is EXPLICITLY public (guardPublic marker).
          const explicitPublic = (sub.route.stack || []).some(
            (l) => l.handle?.__isPublicMarker === true
          );
          out.push({ mount, path: full, guarded, explicitPublic });
        }
      }
      if (!hadRoute) {
        out.push({ mount, path: mount, guarded: routerLevelGuarded, explicitPublic: false });
      }
    }
  }
  return out;
}

function regexpToPath(re) {
  // Convert Express mount regexp back to a readable prefix (best-effort).
  const src = re.source
    .replace("\\/?(?=\\/|$)", "")
    .replace(/^\^/, "")
    .replace(/\$$/, "")
    .replace(/\\\//g, "/");
  return src === "/" ? "" : src;
}

/**
 * Audit the app. `knownGuardNames` are the .name values of middleware that
 * count as guards (pass in the actual functions' names).
 */
export function auditRoutes(app, knownGuardNames = []) {
  const mode = (process.env.AUDIT_ROUTES || "warn").toLowerCase();
  if (mode === "off") return { skipped: true };

  const routes = collectRoutes(app, knownGuardNames);
  const unguarded = [];

  for (const r of routes) {
    const p = r.path || r.mount || "";
    if (!p) continue;
    // Skip routes that are guarded, explicitly public, or on the allowlist.
    if (r.guarded || r.explicitPublic) continue;
    if (mustGuard(p) && !isAllowlisted(p)) {
      unguarded.push(p);
    }
  }

  const unique = [...new Set(unguarded)];

  if (unique.length) {
    const msg =
      `[ROUTE-AUDIT] ${unique.length} admin/HQ mount(s) without a detected guard:\n` +
      unique.map((p) => `   • ${p}`).join("\n");
    if (mode === "strict") {
      throw new Error(msg + "\nSet AUDIT_ROUTES=warn to boot anyway.");
    }
    console.warn(msg);
  } else {
    console.log("[ROUTE-AUDIT] ✓ all admin/HQ mounts carry a guard");
  }

  return { unguarded: unique };
}
