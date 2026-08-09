import mongoose from "mongoose";
import mongoosePaginate from "mongoose-paginate-v2";
import { ALL_COUNTRY_CODES } from "../config/countries/index.js";
import { HQ_ONLY_SUBROLES } from "../config/roles.js";

// ── Admin sub-roles ────────────────────────────────────────────────────────────
// FOREIGN_ADMIN removed — it was never a real role, just a data-visibility flag.
export const ADMIN_SUBROLES = [
  "DIRECTOR", "SALES", "HR", "MANAGER", "SALES_MANAGER",
  "ACCOUNTANT", "GRAPHICS", "EDITOR", "LOGISTICS",
  "IT", "WAREHOUSE", "BTC", "BTB",
];

// Sub-roles that MUST always have GLOBAL scope (HQ-only). Re-exported from
// config/roles.js (the single source of truth — see HQ_ONLY_SUBROLES there)
// so this schema-level validator can never drift out of sync with the
// admin-creation UI and the request-scoping middleware again. This used to
// be its own hardcoded ["IT", "DIRECTOR", "LOGISTICS"] list here, which is
// exactly how an Accountant could previously end up saved with a COUNTRY
// scope — nothing at the DB layer stopped it. Do not redefine this locally.
export { HQ_ONLY_SUBROLES };

// Sub-roles that CAN be assigned to a country/"foreign" admin account —
// every ADMIN_SUBROLES entry that isn't HQ-only and isn't a customer
// subRole. Currently excludes IT, DIRECTOR, ACCOUNTANT, WAREHOUSE, EDITOR
// (see HQ_ONLY_SUBROLES) — there is only ever one Accountant/Warehouse/
// Editor, and they're always HQ. LOGISTICS IS now foreign-assignable: the
// country-scoped logistics system (ShippingZone/ShippingMethod
// countryScopedPlugin) is live, so a per-country Logistics admin manages
// only their own country's zones/methods. Used by foreignAdmin.controller.js
// to decide which subRoles show up as "foreign"-assignable.
// NOTE: this used to be imported from here but was never actually defined,
// which crashed every foreign-admin create/update call with a TypeError —
// see foreignAdmin.controller.js's sanitiseForeignSubRoles().
export const FOREIGN_EXPOSABLE_SUBROLES = ADMIN_SUBROLES.filter(
  (r) => !HQ_ONLY_SUBROLES.includes(r) && !["BTC", "BTB"].includes(r)
);

// Kept as an explicit named list for callers that need to reason about the
// Logistics subRole specifically (e.g. UI copy explaining a Logistics
// admin's zones/methods are scoped to their assignedCountry). LOGISTICS is
// no longer force-excluded from FOREIGN_EXPOSABLE_SUBROLES — it is fully
// foreign-assignable now that country-scoped logistics exists.
export const LOGISTICS_SUBROLES = ["LOGISTICS"];

const userSchema = new mongoose.Schema(
  {
    name:     { type: String, required: [true, "Provide name"] },
    email:    { type: String, required: [true, "Provide email"], unique: true },
    password: { type: String, required: [true, "Provide password"] },
    avatar:   { type: String, default: "" },
    mobile:   { type: Number, default: null },
    // Customer (role: "USER") home-country recognition — stamped once at
    // signup from req.countryCode (the storefront domain the person
    // registered on, resolved by the global countryDetect middleware).
    // NOT the same thing as scope/assignedCountry below, which is the
    // ADMIN data-visibility system — this is just "which storefront does
    // this customer belong to" (used for currency display, country-scoped
    // marketing/emails, and defaulting their checkout country). Nullable
    // for ADMIN accounts, which use scope/assignedCountry instead.
    countryCode: {
      type: String,
      enum: [...ALL_COUNTRY_CODES, null],
      default: null,
    },
    refresh_token:       { type: String, default: "" },
    verify_email:        { type: Boolean, default: false },
    last_login_date:     { type: Date, default: "" },
    status: {
      type: String,
      enum: ["Active", "Inactive", "Suspended"],
      default: "Active",
    },
    address_details: [{ type: mongoose.Schema.ObjectId, ref: "address" }],
    shopping_cart:   [{ type: mongoose.Schema.ObjectId, ref: "cartProduct" }],
    orderHistory:    [{ type: mongoose.Schema.ObjectId, ref: "order" }],
    forgot_password_otp:    { type: String, default: null },
    forgot_password_expiry: { type: Date, default: "" },

    role: {
      type: String,
      enum: ["ADMIN", "USER"],
      default: "USER",
    },

    subRole: {
      type: String,
      enum: [...ADMIN_SUBROLES, null],
      default: null,
      validate: {
        validator: function (value) {
          if (!value) return true;
          const adminRoles = ADMIN_SUBROLES.filter(r => !["BTC", "BTB"].includes(r));
          const userRoles  = ["BTC", "BTB"];
          if (this.role === "ADMIN") return adminRoles.includes(value);
          if (this.role === "USER")  return userRoles.includes(value);
          return false;
        },
        message: "Invalid subRole for the given role",
      },
    },

    // ── Country scope ──────────────────────────────────────────────────────────
    // scope:           "GLOBAL" → sees all countries' data
    //                  "COUNTRY" → sees only assignedCountry data
    //
    // assignedCountry: null when scope = "GLOBAL"
    //                  country code when scope = "COUNTRY"
    //
    // Permissions are STILL determined entirely by subRole.
    // scope/assignedCountry only controls DATA VISIBILITY.
    //
    // Rules enforced:
    //   - HQ-only subRoles (config/roles.js#HQ_ONLY_SUBROLES — currently
    //     IT, DIRECTOR, ACCOUNTANT, WAREHOUSE, EDITOR) → must be
    //     GLOBAL (enforced by validator below)
    //   - scope = "COUNTRY" requires assignedCountry to be set
    //   - scope = "GLOBAL"  requires assignedCountry to be null
    scope: {
      type: String,
      enum: ["GLOBAL", "COUNTRY"],
      default: "GLOBAL",
      validate: {
        validator: function (value) {
          // HQ-only subRoles must always be GLOBAL
          if (HQ_ONLY_SUBROLES.includes(this.subRole) && value !== "GLOBAL") {
            return false;
          }
          return true;
        },
        message: "This subRole must always have GLOBAL scope (see config/roles.js#HQ_ONLY_SUBROLES)",
      },
    },

    assignedCountry: {
      type: String,
      enum: [...ALL_COUNTRY_CODES, null],
      default: null,
      validate: {
        validator: function (value) {
          if (this.scope === "COUNTRY" && !value) return false; // must have country
          if (this.scope === "GLOBAL"  &&  value) return false; // must be null
          return true;
        },
        message: "assignedCountry must be set when scope is COUNTRY, and null when GLOBAL",
      },
    },

    // Legacy "Foreign Admin Management" display field — the account's real
    // department/access is always `subRole` above (consistent with every
    // other admin account and how permissions.js resolves permissions).
    // This is kept only so the Foreign Admin Management page can show
    // which extra department(s) were selected at creation time; it is NOT
    // consulted anywhere for access control.
    foreignSubRoles: {
      type: [String],
      default: [],
    },

    preferredLanguage: {
      type: String,
      enum: ["en", "fr", "it", null],
      default: null,
    },

    // ── PHASE 2 RBAC: optional per-user permission overrides ──────────────────
    // Effective permissions = role(subRole) bundle + extraPermissions − deniedPermissions.
    // Empty by default → behaviour is 100% driven by the subRole's role bundle,
    // preserving backward compatibility. No user migration required.
    extraPermissions: {
      type: [String],
      default: [],
    },
    deniedPermissions: {
      type: [String],
      default: [],
    },

    // Optional department tag (SALES, LOGISTICS, FINANCE, CONTENT, IT, HR...).
    // Informational for now; drives future department-scoped views.
    department: {
      type: String,
      default: null,
    },

    userMode: {
      type: String,
      enum: ["ONLINE", "OFFLINE", null],
      default: null,
      validate: {
        validator: function (value) {
          if (!value) return true;
          const isAdminSales   = this.role === "ADMIN" && this.subRole === "SALES";
          const isUserCustomer = this.role === "USER"  && ["BTC", "BTB"].includes(this.subRole);
          return isAdminSales || isUserCustomer;
        },
        message: "userMode is only allowed for ADMIN/SALES or USER with BTC or BTB subRole",
      },
    },

    scrapeQuota: {
      monthlyLimit:   { type: Number, default: 0 },
      usedThisMonth:  { type: Number, default: 0 },
      quotaResetDate: { type: Date, default: null },
      setBy:          { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      setByName:      { type: String, default: "" },
      updatedAt:      { type: Date, default: null },
    },
  },
  { timestamps: true }
);

userSchema.plugin(mongoosePaginate);

userSchema.index({ role: 1, subRole: 1 });
userSchema.index({ status: 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ scope: 1, assignedCountry: 1 });

const UserModel = mongoose.model("User", userSchema);
export default UserModel;
