// controllers/orderRequestAuth.controller.js
import UserModel from "../models/user.model.js";
import CustomerModel from "../models/customer.model.js";
import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";
import { transporter } from "../utils/nodemailer.js";
import crypto from "crypto";

// Generate JWT Token
const generateToken = (userId, role, subRole) => {
  return jwt.sign({ id: userId, role, subRole }, process.env.JWT_SECRET_KEY, {
    expiresIn: "7d",
  });
};

// Register BTB Customer
export const registerBTBCustomer = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      mobile,
      companyName,
      registrationNumber,
      address,
    } = req.body;

    // Validation
    if (!name || !email || !password || !mobile || !companyName) {
      return res.status(400).json({
        message: "Please provide all required fields",
        error: true,
        success: false,
      });
    }

    // Check if user already exists
    const existingUser = await UserModel.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        message: "Email already registered",
        error: true,
        success: false,
      });
    }

    // Hash password
    const salt = await bcryptjs.genSalt(10);
    const hashedPassword = await bcryptjs.hash(password, salt);

    // Create verification token
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Create user
    const user = new UserModel({
      name,
      email,
      password: hashedPassword,
      mobile,
      role: "USER",
      subRole: "BTB",
      userMode: "ONLINE",
      verify_email: false,
      forgot_password_otp: verificationToken,
      forgot_password_expiry: verificationExpiry,
    });

    await user.save();

    // Create customer profile
    const customer = new CustomerModel({
      name,
      email,
      mobile,
      customerType: "BTB",
      customerMode: "ONLINE",
      companyName,
      registrationNumber,
      address: address || {},
      isWebsiteCustomer: true,
      status: "ACTIVE",
    });

    await customer.save();

    // Send verification email
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;

    const mailOptions = {
      from: `"YEHGS Order System" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Verify Your Email - YEHGS BTB Order System",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #111011; color: #fffb06; padding: 20px; text-align: center; }
            .content { background: #f4f4f4; padding: 30px; }
            .button { display: inline-block; background: #fffb06; color: #111011; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; }
            .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Welcome to YEHGS BTB Order System</h1>
            </div>
            <div class="content">
              <h2>Hello ${name},</h2>
              <p>Thank you for registering with YEHGS. Please verify your email address to activate your account.</p>
              <p>Company: <strong>${companyName}</strong></p>
              <p style="text-align: center; margin: 30px 0;">
                <a href="${verificationUrl}" class="button">Verify Email</a>
              </p>
              <p>Or copy and paste this link in your browser:</p>
              <p style="word-break: break-all; color: #666;">${verificationUrl}</p>
              <p><strong>This link will expire in 24 hours.</strong></p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} YEHGS Co Ltd. All rights reserved.</p>
              <p>FMCG Coffee Partner Worldwide</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    await transporter.sendMail(mailOptions);

    res.status(201).json({
      message:
        "Registration successful! Please check your email to verify your account.",
      error: false,
      success: true,
      data: {
        userId: user._id,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({
      message: error.message || "Registration failed",
      error: true,
      success: false,
    });
  }
};

// Verify Email
export const verifyEmail = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        message: "Verification token is required",
        error: true,
        success: false,
      });
    }

    const user = await UserModel.findOne({
      forgot_password_otp: token,
      forgot_password_expiry: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        message: "Invalid or expired verification token",
        error: true,
        success: false,
      });
    }

    user.verify_email = true;
    user.forgot_password_otp = null;
    user.forgot_password_expiry = null;
    await user.save();

    res.status(200).json({
      message: "Email verified successfully! You can now login.",
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Email verification error:", error);
    res.status(500).json({
      message: error.message || "Email verification failed",
      error: true,
      success: false,
    });
  }
};

// Login
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Please provide email and password",
        error: true,
        success: false,
      });
    }

    const user = await UserModel.findOne({ email });
    console.log(user);

    if (!user) {
      return res.status(401).json({
        message: "Invalid email or password",
        error: true,
        success: false,
      });
    }

    if (!user.verify_email) {
      return res.status(401).json({
        message: "Please verify your email before logging in",
        error: true,
        success: false,
      });
    }

    if (user.status !== "Active") {
      return res.status(401).json({
        message: "Your account has been suspended. Please contact support.",
        error: true,
        success: false,
      });
    }

    const isPasswordValid = await bcryptjs.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({
        message: "Invalid email or password",
        error: true,
        success: false,
      });
    }

    // Update last login
    user.last_login_date = new Date();
    await user.save();

    // Generate token
    const token = generateToken(user._id, user.role, user.subRole);

    // Get customer profile if BTB user
    let customer = null;
    if (user.subRole === "BTB") {
      customer = await CustomerModel.findOne({ email: user.email });
    }

    res.status(200).json({
      message: "Login successful",
      error: false,
      success: true,
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          subRole: user.subRole,
          mobile: user.mobile,
          avatar: user.avatar,
        },
        customer,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      message: error.message || "Login failed",
      error: true,
      success: false,
    });
  }
};

// Forgot Password
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        message: "Email is required",
        error: true,
        success: false,
      });
    }

    const user = await UserModel.findOne({ email });

    if (!user) {
      return res.status(404).json({
        message: "No account found with this email",
        error: true,
        success: false,
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    user.forgot_password_otp = resetToken;
    user.forgot_password_expiry = resetExpiry;
    await user.save();

    // Send reset email
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    const mailOptions = {
      from: `"YEHGS Order System" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Password Reset Request - YEHGS",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #111011; color: #fffb06; padding: 20px; text-align: center; }
            .content { background: #f4f4f4; padding: 30px; }
            .button { display: inline-block; background: #fffb06; color: #111011; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; }
            .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Password Reset Request</h1>
            </div>
            <div class="content">
              <h2>Hello ${user.name},</h2>
              <p>You requested to reset your password. Click the button below to proceed:</p>
              <p style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}" class="button">Reset Password</a>
              </p>
              <p>Or copy and paste this link in your browser:</p>
              <p style="word-break: break-all; color: #666;">${resetUrl}</p>
              <p><strong>This link will expire in 1 hour.</strong></p>
              <p>If you didn't request this, please ignore this email.</p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} YEHGS Co Ltd. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({
      message: "Password reset link sent to your email",
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({
      message: error.message || "Failed to send reset email",
      error: true,
      success: false,
    });
  }
};

// Reset Password
export const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        message: "Token and new password are required",
        error: true,
        success: false,
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters long",
        error: true,
        success: false,
      });
    }

    const user = await UserModel.findOne({
      forgot_password_otp: token,
      forgot_password_expiry: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        message: "Invalid or expired reset token",
        error: true,
        success: false,
      });
    }

    // Hash new password
    const salt = await bcryptjs.genSalt(10);
    const hashedPassword = await bcryptjs.hash(newPassword, salt);

    user.password = hashedPassword;
    user.forgot_password_otp = null;
    user.forgot_password_expiry = null;
    await user.save();

    res.status(200).json({
      message:
        "Password reset successful! You can now login with your new password.",
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({
      message: error.message || "Password reset failed",
      error: true,
      success: false,
    });
  }
};

// Resend Verification Email
export const resendVerificationEmail = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        message: "Email is required",
        error: true,
        success: false,
      });
    }

    const user = await UserModel.findOne({ email });

    if (!user) {
      return res.status(404).json({
        message: "No account found with this email",
        error: true,
        success: false,
      });
    }

    if (user.verify_email) {
      return res.status(400).json({
        message: "Email already verified",
        error: true,
        success: false,
      });
    }

    // Generate new verification token
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    user.forgot_password_otp = verificationToken;
    user.forgot_password_expiry = verificationExpiry;
    await user.save();

    // Send email
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;

    const mailOptions = {
      from: `"YEHGS Order System" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Verify Your Email - YEHGS",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #111011; color: #fffb06; padding: 20px; text-align: center; }
            .content { background: #f4f4f4; padding: 30px; }
            .button { display: inline-block; background: #fffb06; color: #111011; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Verify Your Email</h1>
            </div>
            <div class="content">
              <h2>Hello ${user.name},</h2>
              <p>Click the button below to verify your email address:</p>
              <p style="text-align: center; margin: 30px 0;">
                <a href="${verificationUrl}" class="button">Verify Email</a>
              </p>
              <p><strong>This link will expire in 24 hours.</strong></p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({
      message: "Verification email sent successfully",
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Resend verification error:", error);
    res.status(500).json({
      message: error.message || "Failed to send verification email",
      error: true,
      success: false,
    });
  }
};
