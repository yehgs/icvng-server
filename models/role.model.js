/**
 * models/role.model.js
 *
 * PHASE 2 — RBAC FOUNDATION
 *
 * DB-backed roles. Seeded from config/roles.js (ROLE_DEFINITIONS) but editable
 * by users with roles.manage. config/roles.js remains the fallback so the
 * platform works before/without seeding — identical pattern to COUNTRY_CONFIG.
 *
 * `key` matches the user's subRole value, so a user's role is resolved by
 * subRole. This preserves full backward compatibility with the existing user
 * schema (no user migration needed in Phase 2).
 */

import mongoose from "mongoose";
import { ALL_PERMISSION_KEYS, WILDCARD } from "../config/permissions.js";

const roleSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },

    // Permission keys, or ["*"] for all.
    permissions: {
      type: [String],
      default: [],
      validate: {
        validator(arr) {
          const valid = new Set([...ALL_PERMISSION_KEYS, WILDCARD]);
          return arr.every((k) => valid.has(k));
        },
        message: "permissions contains an unknown permission key",
      },
    },

    // System roles are seeded and cannot be deleted (only their permissions
    // edited, and only if not locked).
    isSystem: { type: Boolean, default: false },

    // Informational: role only makes operational sense at HQ.
    hqOnly: { type: Boolean, default: false },

    // A locked system role's permissions cannot be edited (DIRECTOR/IT).
    locked: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const RoleModel = mongoose.model("Role", roleSchema);

export default RoleModel;
