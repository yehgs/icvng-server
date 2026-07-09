/**
 * core/requestContext.js
 *
 * PHASE 3/4 — per-request context via AsyncLocalStorage.
 *
 * Lets Mongoose query hooks (in the countryScoped plugin) know the current
 * admin's country scope WITHOUT threading it through every function call. The
 * countryContext middleware seeds this at the start of each request.
 *
 * Contract:
 *   { countryScope: string|null,   // null = GLOBAL (no filter), "TG" = scoped
 *     scope: "GLOBAL"|"COUNTRY"|null,
 *     enforce: boolean }           // whether query hooks should auto-filter
 */

import { AsyncLocalStorage } from "node:async_hooks";

const als = new AsyncLocalStorage();

/** Run `fn` with the given context bound for the duration of the request. */
export function runWithContext(ctx, fn) {
  return als.run(ctx, fn);
}

/** Get the current request context, or a safe default outside a request. */
export function getContext() {
  return als.getStore() || { countryScope: null, scope: null, enforce: false };
}

/** Convenience: the current country scope ("TG") or null for GLOBAL. */
export function getCountryScope() {
  return getContext().countryScope ?? null;
}

/** Whether automatic query-hook filtering is active for this request. */
export function isEnforcing() {
  return !!getContext().enforce;
}

/**
 * Mutate the active request context's scope in place. Called by the
 * countryScope middleware once it resolves the admin's scope, AFTER
 * countryContext has established the store. Safe no-op outside a request.
 */
export function setContextScope({ countryScope = null, scope = null } = {}) {
  const store = als.getStore();
  if (store) {
    store.countryScope = countryScope ?? null;
    store.scope = scope ?? null;
  }
}

export default als;
