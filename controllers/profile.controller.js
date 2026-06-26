//server
// controllers/profile.controller.js
import UserModel from "../models/user.model.js";
import bcryptjs from "bcryptjs";
import sendEmail from "../config/sendEmail.js";
import uploadImageCloudinary from "../utils/uploadImageCloudinary.js";

// ── GET /profile/me ──────────────────────────────────────────────────────────
export async function getProfileController(req, res) {
  try {
    const user = await UserModel.findById(req.user._id)
      .select(
        "-password -refresh_token -forgot_password_otp -forgot_password_expiry",
      )
      .lean();
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    return res.json({ success: true, data: user });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── PUT /profile/update ──────────────────────────────────────────────────────
export async function updateProfileController(req, res) {
  try {
    const { name, mobile, bio, department } = req.body;
    const updateData = {};
    if (name?.trim()) updateData.name = name.trim();
    if (mobile) updateData.mobile = mobile;
    if (bio !== undefined) updateData.bio = bio;
    if (department !== undefined) updateData.department = department;

    const user = await UserModel.findByIdAndUpdate(req.user._id, updateData, {
      new: true,
    }).select("-password -refresh_token -forgot_password_otp");

    // Sync to localStorage on client side via response
    return res.json({ success: true, message: "Profile updated", data: user });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── POST /profile/avatar ─────────────────────────────────────────────────────
export async function updateAvatarController(req, res) {
  try {
    const file = req.file;
    if (!file)
      return res
        .status(400)
        .json({ success: false, message: "No image provided" });

    const upload = await uploadImageCloudinary(file);
    const user = await UserModel.findByIdAndUpdate(
      req.user._id,
      { avatar: upload.secure_url },
      { new: true },
    ).select("-password -refresh_token");

    return res.json({ success: true, message: "Avatar updated", data: user });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── PUT /profile/change-password — self-service password change ───────────────
export async function changeOwnPasswordController(req, res) {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res
        .status(400)
        .json({ success: false, message: "All password fields are required" });
    }
    if (newPassword !== confirmPassword) {
      return res
        .status(400)
        .json({ success: false, message: "New passwords do not match" });
    }
    if (newPassword.length < 8) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Password must be at least 8 characters",
        });
    }

    const user = await UserModel.findById(req.user._id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    const isMatch = await bcryptjs.compare(currentPassword, user.password);
    if (!isMatch) {
      return res
        .status(400)
        .json({ success: false, message: "Current password is incorrect" });
    }

    const salt = await bcryptjs.genSalt(10);
    const hashed = await bcryptjs.hash(newPassword, salt);

    await UserModel.findByIdAndUpdate(req.user._id, {
      password: hashed,
      refresh_token: "", // force re-login on other sessions
    });

    // Notify the user
    await sendEmail({
      sendTo: user.email,
      subject: "Password Changed — I-COFFEE.NG Admin",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <div style="background:#1e3a5f;padding:16px 24px;border-radius:8px 8px 0 0;">
            <h2 style="color:#fff;margin:0;">Password Changed</h2>
          </div>
          <div style="background:#f9f9f9;padding:24px;border:1px solid #e0e0e0;border-radius:0 0 8px 8px;">
            <p style="color:#444;">Hi <strong>${user.name}</strong>,</p>
            <p style="color:#444;">Your admin account password was successfully changed.</p>
            <p style="color:#888;font-size:13px;">If you did not make this change, please contact IT immediately.</p>
          </div>
        </div>
      `,
    }).catch(() => {});

    return res.json({
      success: true,
      message: "Password changed successfully. Please log in again.",
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── POST /profile/forgot-password-request ─────────────────────────────────────
// Called from the public login page — no auth required
// Notifies IT and MANAGER to assist with reset
export async function forgotPasswordRequestController(req, res) {
  try {
    const { email, subRole } = req.body;
    if (!email)
      return res
        .status(400)
        .json({ success: false, message: "Email is required" });

    // Find the user
    const user = await UserModel.findOne({ email, role: "ADMIN" }).lean();
    if (!user) {
      // Respond with success to avoid user enumeration
      return res.json({
        success: true,
        message: "If that email exists, IT and Manager have been notified.",
      });
    }

    // Find all IT and MANAGER admins who are active
    const recipients = await UserModel.find({
      role: "ADMIN",
      subRole: { $in: ["IT", "MANAGER"] },
      status: "Active",
    })
      .select("name email subRole")
      .lean();

    if (recipients.length === 0) {
      return res
        .status(503)
        .json({
          success: false,
          message:
            "No IT or Manager available. Please contact your administrator directly.",
        });
    }

    const requestTime = new Date().toLocaleString("en-NG", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Lagos",
    });

    // Email each recipient
    const emailPromises = recipients.map((r) =>
      sendEmail({
        sendTo: r.email,
        subject: `⚠️ Password Reset Request — ${user.name} (${user.subRole || subRole})`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
            <div style="background:#b91c1c;padding:16px 24px;border-radius:8px 8px 0 0;">
              <h2 style="color:#fff;margin:0;">⚠️ Admin Password Reset Request</h2>
            </div>
            <div style="background:#fff7f7;padding:24px;border:1px solid #fecaca;border-radius:0 0 8px 8px;">
              <p style="color:#444;">Hi <strong>${r.name}</strong>,</p>
              <p style="color:#444;">An admin user has requested a password reset on the I-COFFEE.NG Admin Panel.</p>
              <table style="width:100%;border-collapse:collapse;margin:16px 0;">
                <tr><td style="padding:8px;background:#f5f5f5;font-weight:bold;border:1px solid #ddd;width:35%;">Name</td><td style="padding:8px;border:1px solid #ddd;">${user.name}</td></tr>
                <tr><td style="padding:8px;background:#f5f5f5;font-weight:bold;border:1px solid #ddd;">Email</td><td style="padding:8px;border:1px solid #ddd;">${user.email}</td></tr>
                <tr><td style="padding:8px;background:#f5f5f5;font-weight:bold;border:1px solid #ddd;">Department</td><td style="padding:8px;border:1px solid #ddd;">${user.subRole || subRole || "Unknown"}</td></tr>
                <tr><td style="padding:8px;background:#f5f5f5;font-weight:bold;border:1px solid #ddd;">Requested At</td><td style="padding:8px;border:1px solid #ddd;">${requestTime}</td></tr>
              </table>
              <p style="color:#444;">Please log into the admin panel to reset this user's password, or contact them directly to verify their identity before proceeding.</p>
              <a href="${process.env.ADMIN_URL || "https://admin.i-coffee.ng"}/admin/users" 
                 style="display:inline-block;margin-top:12px;padding:12px 24px;background:#1e3a5f;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">
                Open User Management
              </a>
              <p style="color:#999;font-size:12px;margin-top:24px;">
                This is an automated notification. Do not share passwords via email — use the admin panel reset function.
              </p>
            </div>
          </div>
        `,
      }).catch((err) =>
        console.error(`Failed to email ${r.email}:`, err.message),
      ),
    );

    await Promise.allSettled(emailPromises);

    return res.json({
      success: true,
      message:
        "IT and Manager have been notified. They will contact you shortly.",
      notifiedCount: recipients.length,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}
