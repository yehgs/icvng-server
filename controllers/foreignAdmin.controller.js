/**
 * controllers/foreignAdmin.controller.js
 *
 * CRUD for FOREIGN_ADMIN accounts.
 *
 * - DIRECTOR and IT can create / manage all foreign admins.
 * - MANAGER can also create / update foreign admins (but not delete).
 * - IT and MANAGER can assign additional `foreignSubRoles` to give a
 *   foreign admin access to more sections.
 * - LOGISTICS is never allowed in foreignSubRoles.
 */

import UserModel from "../models/user.model.js";
import bcryptjs from "bcryptjs";
import sendEmail from "../config/sendEmail.js";
import { getCountryByCode, ALL_COUNTRY_CODES } from "../config/countries/index.js";
import { logActivity } from "../utils/activityLogger.js";
import { FOREIGN_EXPOSABLE_SUBROLES, LOGISTICS_SUBROLES } from "../models/user.model.js";

// Who can create / manage foreign admins
const ALLOWED_CREATORS = ["DIRECTOR", "IT", "MANAGER"];
// Who can delete
const ALLOWED_DELETERS = ["DIRECTOR", "IT"];

/**
 * Sanitise foreignSubRoles — remove any LOGISTICS or invalid entries.
 */
function sanitiseForeignSubRoles(arr = []) {
  return (arr || []).filter(
    (r) => FOREIGN_EXPOSABLE_SUBROLES.includes(r) && !LOGISTICS_SUBROLES.includes(r)
  );
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
        message: "Only DIRECTOR, IT, or MANAGER can create foreign admin accounts",
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

    const salt = await bcryptjs.genSalt(10);
    const hashedPassword = await bcryptjs.hash(password, salt);

    const country = getCountryByCode(assignedCountry);

    const newAdmin = new UserModel({
      name,
      email,
      password: hashedPassword,
      role: "ADMIN",
      subRole: "FOREIGN_ADMIN",
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
      details: `Created foreign admin ${email} for ${assignedCountry} with roles [FOREIGN_ADMIN${cleanedForeignSubRoles.length ? ", " + cleanedForeignSubRoles.join(", ") : ""}]`,
    });

    return res.status(201).json({
      message: `Foreign admin created for ${country.name}`,
      success: true,
      error: false,
      data: {
        _id: newAdmin._id,
        name: newAdmin.name,
        email: newAdmin.email,
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
    const filter = { role: "ADMIN", subRole: "FOREIGN_ADMIN" };
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
 * IT/MANAGER can update; DIRECTOR can update everything.
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

    const admin = await UserModel.findOne({ _id: id, subRole: "FOREIGN_ADMIN" });

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

    // Update foreignSubRoles if provided (sanitise to remove LOGISTICS)
    if (foreignSubRoles !== undefined) {
      admin.foreignSubRoles = sanitiseForeignSubRoles(foreignSubRoles);
    }

    await admin.save();

    await logActivity({
      adminId: creator._id,
      action: "UPDATE_FOREIGN_ADMIN",
      details: `Updated foreign admin ${admin.email} — roles: [FOREIGN_ADMIN${admin.foreignSubRoles?.length ? ", " + admin.foreignSubRoles.join(", ") : ""}]`,
    });

    return res.json({
      message: "Foreign admin updated",
      success: true,
      error: false,
      data: {
        _id: admin._id,
        name: admin.name,
        email: admin.email,
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

    if (!["DIRECTOR", "IT", "MANAGER"].includes(actor.subRole)) {
      return res.status(403).json({
        message: "Only DIRECTOR, IT, or MANAGER can assign sub-roles",
        error: true,
        success: false,
      });
    }

    const { id } = req.params;
    const { foreignSubRoles = [] } = req.body;

    const admin = await UserModel.findOne({ _id: id, subRole: "FOREIGN_ADMIN" });
    if (!admin) {
      return res.status(404).json({
        message: "Foreign admin not found",
        error: true,
        success: false,
      });
    }

    const cleaned = sanitiseForeignSubRoles(foreignSubRoles);
    const rejected = foreignSubRoles.filter(r => !cleaned.includes(r));

    admin.foreignSubRoles = cleaned;
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
      data: { foreignSubRoles: admin.foreignSubRoles },
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
    const admin = await UserModel.findOneAndDelete({ _id: id, subRole: "FOREIGN_ADMIN" });

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
 * IT or MANAGER can upgrade an existing admin to FOREIGN_ADMIN
 * (changes their subRole to FOREIGN_ADMIN and assigns a country).
 */
export async function promoteToForeignAdmin(req, res) {
  try {
    const actor = req.user;

    if (!["DIRECTOR", "IT", "MANAGER"].includes(actor.subRole)) {
      return res.status(403).json({
        message: "Only DIRECTOR, IT, or MANAGER can promote users to foreign admin",
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

    // Cannot promote DIRECTOR or IT to FOREIGN_ADMIN
    if (["DIRECTOR", "IT"].includes(user.subRole)) {
      return res.status(400).json({
        message: "Cannot convert DIRECTOR or IT to FOREIGN_ADMIN",
        error: true,
        success: false,
      });
    }

    const country = getCountryByCode(assignedCountry);
    const cleaned = sanitiseForeignSubRoles(foreignSubRoles);

    user.subRole = "FOREIGN_ADMIN";
    user.assignedCountry = assignedCountry;
    user.preferredLanguage = preferredLanguage || country.language.default;
    user.foreignSubRoles = cleaned;

    await user.save();

    await logActivity({
      adminId: actor._id,
      action: "PROMOTE_TO_FOREIGN_ADMIN",
      details: `Promoted ${user.email} to FOREIGN_ADMIN for ${assignedCountry}`,
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
