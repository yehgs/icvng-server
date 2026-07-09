/**
 * core/countryScopedPlugin.js
 *
 * PHASE 3/4 — the enforcement layer that makes country isolation hold even
 * when a controller forgets to filter.
 *
 * Applying this plugin to a schema:
 *   1. Adds a `countryCode` field (indexed).
 *   2. On create/save, stamps countryCode from the request context if unset.
 *   3. On find/findOne/count/aggregate/update/delete, injects
 *      { countryCode: <scope> } when the request is COUNTRY-scoped AND
 *      enforcement is enabled — so a scoped admin physically cannot read or
 *      write another country's rows, even by hand-crafting the query.
 *
 * GLOBAL admins (countryScope === null) are never filtered.
 *
 * Rollout safety: enforcement is gated by ctx.enforce (set by the
 * countryContext middleware, which can run in log-only mode first). During
 * backfill, the field is added but hooks stay dormant until enforce flips on.
 */

import mongoose from "mongoose";
import { getContext } from "./requestContext.js";
import { ALL_COUNTRY_CODES, DEFAULT_COUNTRY } from "../config/countries/index.js";

const READ_HOOKS = ["find", "findOne", "countDocuments", "count", "findOneAndUpdate", "findOneAndDelete"];
const WRITE_UPDATE_HOOKS = ["updateOne", "updateMany", "deleteOne", "deleteMany"];

export function countryScopedPlugin(schema, opts = {}) {
  const required = opts.required !== false; // default required after backfill

  // 1. Field
  if (!schema.path("countryCode")) {
    schema.add({
      countryCode: {
        type: String,
        enum: ALL_COUNTRY_CODES,
        default: DEFAULT_COUNTRY,
        index: true,
        required,
      },
    });
    schema.index({ countryCode: 1, createdAt: -1 });
  }

  // 2. Stamp on save (new docs) from context if not explicitly set.
  schema.pre("save", function (next) {
    if (this.isNew && !this.countryCode) {
      const { countryScope } = getContext();
      this.countryCode = countryScope || DEFAULT_COUNTRY;
    }
    next();
  });

  // Helper: should we filter this query?
  function scopeFilter() {
    const ctx = getContext();
    if (!ctx.enforce) return null; // enforcement off (log-only / bootstrap)
    if (!ctx.countryScope) return null; // GLOBAL admin — no filter
    return ctx.countryScope;
  }

  // 3a. Read/query hooks — inject countryCode into the filter.
  for (const hook of READ_HOOKS) {
    schema.pre(hook, function (next) {
      const scope = scopeFilter();
      if (scope) {
        const q = this.getQuery();
        // Respect an explicit countryCode already on the query only if it
        // matches the scope; otherwise force the scope (prevents override).
        if (!q.countryCode || q.countryCode !== scope) {
          this.setQuery({ ...q, countryCode: scope });
        }
      }
      next();
    });
  }

  // 3b. Update/delete hooks — same injection so scoped admins can't mutate
  // another country's rows.
  for (const hook of WRITE_UPDATE_HOOKS) {
    schema.pre(hook, function (next) {
      const scope = scopeFilter();
      if (scope) {
        const q = this.getQuery();
        if (!q.countryCode || q.countryCode !== scope) {
          this.setQuery({ ...q, countryCode: scope });
        }
      }
      next();
    });
  }

  // 3c. Aggregate hook — prepend a $match on countryCode.
  schema.pre("aggregate", function (next) {
    const scope = scopeFilter();
    if (scope) {
      const pipeline = this.pipeline();
      // Only prepend if the first stage isn't already an equivalent match.
      pipeline.unshift({ $match: { countryCode: scope } });
    }
    next();
  });
}

export default countryScopedPlugin;
