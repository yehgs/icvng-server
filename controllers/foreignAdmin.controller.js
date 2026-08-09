/**
 * controllers/foreignAdmin.controller.js
 *
 * CRUD for foreign/country-scoped admin accounts.
 *
 * A "foreign admin" is not a distinct subRole — it's any ADMIN account with
 * scope: "COUNTRY" (see models/user.model.js). Their real department/
 * permissions come from their normal `subRole`, same as every other admin
 * account; `foreignSubRoles` here is only a legacy display field for this
 * page. This used to write a `subRole: "FOREIGN_ADMIN"` sentinel that isn't
 * (and never was) a valid subRole in the schema — every create/update call
 * threw a validation error. Fixed as part of item #9.
 *
 * - DIRECTOR and IT can create / manage all foreign admins.
 * - MANAGER (HQ or country/"foreign" scoped) is NOT allowed to create,
 *   update, delete, promote, or assign sub-roles to foreign admins — user
 *   management (foreign or normal) is not exposed to MANAGER. See item #8.
 * - IT/DIRECTOR select the department(s) (foreignSubRoles) a foreign admin
 *   gets; the first selection becomes the account's real subRole.
 * - HQ-only subRoles (IT, DIRECTOR, ACCOUNTANT, WAREHOUSE, EDITOR — see
 *   HQ_ONLY_SUBROLES) are never assignable here. LOGISTICS IS assignable
 *   here now (country-scoped logistics system): a foreign LOGISTICS admin
 *   manages only their assignedCountry's shipping zones/methods.
 */

import UserModel from "../models/user.model.js";
import bcryptjs from "bcryptjs";
import sendEmail from "../config/sendEmail.js";
import { getCountryByCode, ALL_COUNTRY_CODES } from "../config/countries/index.js";
import { logActivity } from "../utils/activityLogger.js";
import { FOREIGN_EXPOSABLE_SUBROLES, HQ_ONLY_SUBROLES } from "../models/user.model.js";

// Who can create / manage foreign admins — DIRECTOR and IT only.
// MANAGER intentionally excluded (item #8): user management, whether over
// normal admins or "foreign" (country) admins, is not a MANAGER capability.
const ALLOWED_CREATORS = ["DIRECTOR", "IT"];
// Who can delete
const ALLOWED_DELETERS = ["DIRECTOR", "IT"];

// A "foreign admin" isn't a distinct subRole — it's any ADMIN account with
// scope: "COUNTRY" (see the schema comment on `scope` in models/user.model.js:
// "FOREIGN_ADMIN removed — it was never a real role, just a data-visibility
// flag"). This filter is what every list/find/delete below uses to identify
// one.
const FOREIGN_ADMIN_FILTER = { role: "ADMIN", scope: "COUNTRY" };

/**
 * Sanitise foreignSubRoles — remove any HQ-only (IT/DIRECTOR/ACCOUNTANT/
 * WAREHOUSE/EDITOR — see HQ_ONLY_SUBROLES) or invalid entries. None of
 * those can ever be "foreign" — there is only ever one Accountant, one
 * Warehouse, one Editor, and they're always HQ (item #9). LOGISTICS is
 * allowed through: the country-scoped logistics system means a foreign
 * Logistics admin only ever touches their own assignedCountry's zones and
 * shipping methods.
 */
function sanitiseForeignSubRoles(arr = []) {
  return (arr || []).filter((r) => FOREIGN_EXPOSABLE_SUBROLES.includes(r));
}

/**
 * POST /api/admin/foreign-admins
 * Create a new foreign admin account.
 */
export async function createForeignAdmin(req, res) {
  try {
    const creator = req.user;

    if (!ALLOWED_CREATORS.includes(creator.subRole)) {
      return res.status(403).json({
        message: "Only DIRECTOR or IT can create foreign admin accounts",
        error: true,
        success: false,
      });
    }

    const {
      name,
      email,
      password,
      assignedCountry,
      preferredLanguage,
      foreignSubRoles = [],
    } = req.body;

    if (!name || !email || !password || !assignedCountry) {
      return res.status(400).json({
        message: "name, email, password, and assignedCountry are required",
        error: true,
        success: false,
      });
    }

    if (!ALL_COUNTRY_CODES.includes(assignedCountry)) {
      return res.status(400).json({
        message: `Invalid country code. Valid: ${ALL_COUNTRY_CODES.join(", ")}`,
        error: true,
        success: false,
      });
    }

    const existing = await UserModel.findOne({ email });
    if (existing) {
      return res.status(409).json({
        message: "Email already in use",
        error: true,
        success: false,
      });
    }

    const cleanedForeignSubRoles = sanitiseForeignSubRoles(foreignSubRoles);

    // A foreign admin must have at least one real (foreign-eligible)
    // department — otherwise they'd have no subRole at all and no
    // permissions anywhere in the app (permissions are resolved entirely
    // from subRole — see config/roles.js).
    if (cleanedForeignSubRoles.length === 0) {
      return res.status(400).json({
        message: `Select at least one valid department role. Allowed: ${FOREIGN_EXPOSABLE_SUBROLES.join(", ")}`,
        error: true,
        success: false,
      });
    }

    const salt = await bcryptjs.genSalt(10);
    const hashedPassword = await bcryptjs.hash(password, salt);

    const country = getCountryByCode(assignedCountry);

    const newAdmin = new UserModel({
      name,
      email,
      password: hashedPassword,
      role: "ADMIN",
      // The account's real subRole (and therefore its permissions) is the
      // primary/first selected department — "FOREIGN_ADMIN" is not a real
      // subRole (see models/user.model.js). Any additional selected
      // departments are kept in foreignSubRoles for display only.
      subRole: cleanedForeignSubRoles[0],
      scope: "COUNTRY",
      assignedCountry,
      foreignSubRoles: cleanedForeignSubRoles,
      preferredLanguage: preferredLanguage || country.language.default,
      verify_email: true,
      status: "Active",
    });

    await newAdmin.save();

    // Welcome email
    try {
      const subRoleLabel = cleanedForeignSubRoles.length
        ? `\n<p><strong>Additional access roles:</strong> ${cleanedForeignSubRoles.join(", ")}</p>`
        : "";

      await sendEmail({
        sendTo: email,
        subject: `Welcome to I-Coffee ${country.name} Admin`,
        html: `
          <h2>Welcome, ${name}!</h2>
          <p>Your admin account for <strong>I-Coffee ${country.name}</strong> has been created.</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Temporary Password:</strong> ${password}</p>
          <p><strong>Country:</strong> ${country.name} ${country.flagEmoji}</p>
          ${subRoleLabel}
          <p><strong>Login at:</strong> https://${country.adminDomain}</p>
          <p style="color:red">Please change your password after first login.</p>
        `,
      });
    } catch (emailErr) {
      console.warn("Welcome email failed:", emailErr.message);
    }

    await logActivity({
      adminId: creator._id,
      action: "CREATE_FOREIGN_ADMIN",
      details: `Created foreign admin ${email} for ${assignedCountry} with roles [${cleanedForeignSubRoles.join(", ")}]`,
    });

    return res.status(201).json({
      message: `Foreign admin created for ${country.name}`,
      success: true,
      error: false,
      data: {
        _id: newAdmin._id,
        name: newAdmin.name,
        email: newAdmin.email,
        subRole: newAdmin.subRole,
        assignedCountry: newAdmin.assignedCountry,
        foreignSubRoles: newAdmin.foreignSubRoles,
        preferredLanguage: newAdmin.preferredLanguage,
        status: newAdmin.status,
      },
    });
  } catch (err) {
    console.error("createForeignAdmin error:", err);
    return res.status(500).json({
      message: err.message || "Server error",
      error: true,
      success: false,
    });
  }
}

/**
 * GET /api/admin/foreign-admins
 * List all foreign admin accounts.
 */
export async function listForeignAdmins(req, res) {
  try {
    const creator = req.user;

    if (!ALLOWED_CREATORS.includes(creator.subRole)) {
      return res.status(403).json({
        message: "Access denied",
        error: true,
        success: false,
      });
    }

    const { countryCode, status } = req.query;
    const filter = { ...FOREIGN_ADMIN_FILTER };
    if (countryCode) filter.assignedCountry = countryCode.toUpperCase();
    if (status) filter.status = status;

    const admins = await UserModel.find(filter)
      .select("-password -refresh_token -forgot_password_otp")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      error: false,
      data: admins,
    });
  } catch (err) {
    console.error("listForeignAdmins error:", err);
    return res.status(500).json({
      message: err.message || "Server error",
      error: true,
      success: false,
    });
  }
}

/**
 * PATCH /api/admin/foreign-admins/:id
 * Update country assignment, language, status, or foreignSubRoles.
 * IT and DIRECTOR can update (MANAGER excluded, see item #8).
 */
export async function updateForeignAdmin(req, res) {
  try {
    const creator = req.user;

    if (!ALLOWED_CREATORS.includes(creator.subRole)) {
      return res.status(403).json({
        message: "Access denied",
        error: true,
        success: false,
      });
    }

    const { id } = req.params;
    const { assignedCountry, preferredLanguage, status, foreignSubRoles } = req.body;

    const admin = await UserModel.findOne({ _id: id, ...FOREIGN_ADMIN_FILTER });

    if (!admin) {
      return res.status(404).json({
        message: "Foreign admin not found",
        error: true,
        success: false,
      });
    }

    if (assignedCountry) {
      if (!ALL_COUNTRY_CODES.includes(assignedCountry)) {
        return res.status(400).json({
          message: "Invalid country code",
          error: true,
          success: false,
        });
      }
      admin.assignedCountry = assignedCountry;
    }
    if (preferredLanguage) admin.preferredLanguage = preferredLanguage;
    if (status) admin.status = status;

    // Update foreignSubRoles if provided (sanitise to remove HQ-only roles).
    // The account's real subRole (and therefore its permissions) tracks the
    // primary/first selection — see createForeignAdmin.
    if (foreignSubRoles !== undefined) {
      const cleaned = sanitiseForeignSubRoles(foreignSubRoles);
      if (cleaned.length === 0) {
        return res.status(400).json({
          message: `Select at least one valid department role. Allowed: ${FOREIGN_EXPOSABLE_SUBROLES.join(", ")}`,
          error: true,
          success: false,
        });
      }
      admin.foreignSubRoles = cleaned;
      admin.subRole = cleaned[0];
    }

    await admin.save();

    await logActivity({
      adminId: creator._id,
      action: "UPDATE_FOREIGN_ADMIN",
      details: `Updated foreign admin ${admin.email} — roles: [${admin.foreignSubRoles?.join(", ") || admin.subRole}]`,
    });

    return res.json({
      message: "Foreign admin updated",
      success: true,
      error: false,
      data: {
        _id: admin._id,
        name: admin.name,
        email: admin.email,
        subRole: admin.subRole,
        assignedCountry: admin.assignedCountry,
        foreignSubRoles: admin.foreignSubRoles,
        preferredLanguage: admin.preferredLanguage,
        status: admin.status,
      },
    });
  } catch (err) {
    console.error("updateForeignAdmin error:", err);
    return res.status(500).json({
      message: err.message || "Server error",
      error: true,
      success: false,
    });
  }
}

/**
 * PATCH /api/admin/foreign-admins/:id/subroles
 * Dedicated endpoint to set foreignSubRoles on an existing foreign admin.
 * LOGISTICS is always stripped out.
 */
export async function updateForeignAdminSubRoles(req, res) {
  try {
    const actor = req.user;

    if (!["DIRECTOR", "IT"].includes(actor.subRole)) {
      return res.status(403).json({
        message: "Only DIRECTOR or IT can assign sub-roles",
        error: true,
        success: false,
      });
    }

    const { id } = req.params;
    const { foreignSubRoles = [] } = req.body;

    const admin = await UserModel.findOne({ _id: id, ...FOREIGN_ADMIN_FILTER });
    if (!admin) {
      return res.status(404).json({
        message: "Foreign admin not found",
        error: true,
        success: false,
      });
    }

    const cleaned = sanitiseForeignSubRoles(foreignSubRoles);
    const rejected = foreignSubRoles.filter(r => !cleaned.includes(r));

    if (cleaned.length === 0) {
      return res.status(400).json({
        message: `Select at least one valid department role. Allowed: ${FOREIGN_EXPOSABLE_SUBROLES.join(", ")}`,
        error: true,
        success: false,
      });
    }

    admin.foreignSubRoles = cleaned;
    admin.subRole = cleaned[0];
    await admin.save();

    await logActivity({
      adminId: actor._id,
      action: "UPDATE_FOREIGN_ADMIN_SUBROLES",
      details: `Set foreignSubRoles for ${admin.email}: [${cleaned.join(", ") || "none"}]${rejected.length ? ` — rejected: [${rejected.join(", ")}]` : ""}`,
    });

    return res.json({
      success: true,
      error: false,
      message: "Sub-roles updated",
      data: { subRole: admin.subRole, foreignSubRoles: admin.foreignSubRoles },
      ...(rejected.length ? { warning: `Rejected invalid/prohibited roles: ${rejected.join(", ")}` } : {}),
    });
  } catch (err) {
    console.error("updateForeignAdminSubRoles error:", err);
    return res.status(500).json({
      message: err.message || "Server error",
      error: true,
      success: false,
    });
  }
}

/**
 * DELETE /api/admin/foreign-admins/:id
 * Only DIRECTOR and IT can delete.
 */
export async function deleteForeignAdmin(req, res) {
  try {
    const creator = req.user;

    if (!ALLOWED_DELETERS.includes(creator.subRole)) {
      return res.status(403).json({
        message: "Only DIRECTOR or IT can delete foreign admin accounts",
        error: true,
        success: false,
      });
    }

    const { id } = req.params;
    const admin = await UserModel.findOneAndDelete({ _id: id, ...FOREIGN_ADMIN_FILTER });

    if (!admin) {
      return res.status(404).json({
        message: "Foreign admin not found",
        error: true,
        success: false,
      });
    }

    await logActivity({
      adminId: creator._id,
      action: "DELETE_FOREIGN_ADMIN",
      details: `Deleted foreign admin ${admin.email} (was ${admin.assignedCountry})`,
    });

    return res.json({
      message: "Foreign admin deleted",
      success: true,
      error: false,
    });
  } catch (err) {
    console.error("deleteForeignAdmin error:", err);
    return res.status(500).json({
      message: err.message || "Server error",
      error: true,
      success: false,
    });
  }
}

/**
 * PATCH /api/admin/users/:id/promote-to-foreign
 * IT or DIRECTOR can upgrade an existing HQ admin to a foreign/country-scoped
 * admin (sets scope: "COUNTRY", assigns a country, and keeps their subRole —
 * or the first selected foreignSubRoles entry if provided).
 */
export async function promoteToForeignAdmin(req, res) {
  try {
    const actor = req.user;

    if (!["DIRECTOR", "IT"].includes(actor.subRole)) {
      return res.status(403).json({
        message: "Only DIRECTOR or IT can promote users to foreign admin",
        error: true,
        success: false,
      });
    }

    const { id } = req.params;
    const { assignedCountry, preferredLanguage, foreignSubRoles = [] } = req.body;

    if (!assignedCountry) {
      return res.status(400).json({
        message: "assignedCountry is required",
        error: true,
        success: false,
      });
    }
    if (!ALL_COUNTRY_CODES.includes(assignedCountry)) {
      return res.status(400).json({
        message: `Invalid country code. Valid: ${ALL_COUNTRY_CODES.join(", ")}`,
        error: true,
        success: false,
      });
    }

    const user = await UserModel.findOne({ _id: id, role: "ADMIN" });
    if (!user) {
      return res.status(404).json({
        message: "Admin user not found",
        error: true,
        success: false,
      });
    }

    // Cannot promote an HQ-only subRole (IT, DIRECTOR, ACCOUNTANT,
    // WAREHOUSE, EDITOR — see HQ_ONLY_SUBROLES) to a foreign/country-scoped
    // admin — there is only ever one Accountant/Warehouse/Editor and
    // they're always HQ (item #9). LOGISTICS is no longer in this list, so
    // a Logistics admin CAN be converted/created as country-scoped.
    if (HQ_ONLY_SUBROLES.includes(user.subRole)) {
      return res.status(400).json({
        message: `Cannot convert ${user.subRole} to a foreign/country-scoped admin — this role is always HQ.`,
        error: true,
        success: false,
      });
    }

    const country = getCountryByCode(assignedCountry);
    const cleaned = sanitiseForeignSubRoles(foreignSubRoles);

    if (cleaned.length === 0) {
      return res.status(400).json({
        message: `Select at least one valid department role. Allowed: ${FOREIGN_EXPOSABLE_SUBROLES.join(", ")}`,
        error: true,
        success: false,
      });
    }

    user.subRole = cleaned[0];
    user.scope = "COUNTRY";
    user.assignedCountry = assignedCountry;
    user.preferredLanguage = preferredLanguage || country.language.default;
    user.foreignSubRoles = cleaned;

    await user.save();

    await logActivity({
      adminId: actor._id,
      action: "PROMOTE_TO_FOREIGN_ADMIN",
      details: `Promoted ${user.email} to a foreign admin (${user.subRole}) for ${assignedCountry}`,
    });

    return res.json({
      success: true,
      error: false,
      message: `User promoted to Foreign Admin for ${country.name}`,
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        subRole: user.subRole,
        assignedCountry: user.assignedCountry,
        foreignSubRoles: user.foreignSubRoles,
      },
    });
  } catch (err) {
    console.error("promoteToForeignAdmin error:", err);
    return res.status(500).json({
      message: err.message || "Server error",
      error: true,
      success: false,
    });
  }
}
