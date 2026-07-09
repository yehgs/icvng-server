/**
 * scripts/seedRoles.js
 *
 * PHASE 2 — RBAC FOUNDATION
 *
 * Seeds/updates the Role collection from config/roles.js. Idempotent:
 *   - inserts missing system roles
 *   - updates permissions/name/description of system roles that aren't locked
 *   - never deletes custom roles
 *   - locks DIRECTOR and IT (full-access roles must stay full-access)
 *
 * Run:  node scripts/seedRoles.js
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import connectDB from "../config/connectDB.js";
import RoleModel from "../models/role.model.js";
import { ROLE_DEFINITIONS } from "../config/roles.js";

dotenv.config();

const LOCKED_ROLES = new Set(["DIRECTOR", "IT"]);

async function seedRoles() {
  await connectDB();
  console.log("→ Seeding roles from config/roles.js …");

  let created = 0;
  let updated = 0;

  for (const [key, def] of Object.entries(ROLE_DEFINITIONS)) {
    const locked = LOCKED_ROLES.has(key);
    const existing = await RoleModel.findOne({ key });

    if (!existing) {
      await RoleModel.create({
        key,
        name: def.name,
        description: def.description,
        permissions: def.permissions,
        isSystem: true,
        hqOnly: !!def.hqOnly,
        locked,
      });
      created++;
      console.log(`  + created ${key}`);
    } else if (!existing.locked) {
      existing.name = def.name;
      existing.description = def.description;
      existing.permissions = def.permissions;
      existing.isSystem = true;
      existing.hqOnly = !!def.hqOnly;
      existing.locked = locked;
      await existing.save();
      updated++;
      console.log(`  ~ updated ${key}`);
    } else {
      console.log(`  = skipped ${key} (locked)`);
    }
  }

  console.log(`✓ Roles seeded. created=${created} updated=${updated}`);
  await mongoose.disconnect();
  process.exit(0);
}

seedRoles().catch((err) => {
  console.error("Role seeding failed:", err);
  process.exit(1);
});
