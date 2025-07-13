import sendEmail from '../config/sendEmail.js';
import UserModel from '../models/user.model.js';
import bcryptjs from 'bcryptjs';
import verifyEmailTemplate from '../utils/verifyEmailTemplate.js';
import generatedAccessToken from '../utils/generatedAccessToken.js';
import genertedRefreshToken from '../utils/generatedRefreshToken.js';
import uploadImageCloudinary from '../utils/uploadImageCloudinary.js';
import generatedOtp from '../utils/generatedOtp.js';
import forgotPasswordTemplate from '../utils/forgotPasswordTemplate.js';
import jwt from 'jsonwebtoken';

export async function registerUserController(request, response) {
  try {
    const { name, email, password } = request.body;

    if (!name || !email || !password) {
      return response.status(400).json({
        message: 'Provide email, name, and password',
        error: true,
        success: false,
      });
    }

    // Validate password length
    if (password.length < 6) {
      return response.status(400).json({
        message: 'Password must be at least 6 characters long',
        error: true,
        success: false,
      });
    }

    // Check if user already exists
    const existingUser = await UserModel.findOne({
      email: email.toLowerCase(),
    });

    if (existingUser) {
      return response.status(400).json({
        message:
          'Email already registered. Please use a different email or login.',
        error: true,
        success: false,
      });
    }

    const salt = await bcryptjs.genSalt(10);
    const hashPassword = await bcryptjs.hash(password, salt);

    const payload = {
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashPassword,
      role: 'USER', // Default role
      subRole: 'BTC', // Default subRole for new users
      verify_email: false, // Will be verified via email
      status: 'Active', // Default active status
    };

    const newUser = new UserModel(payload);
    const savedUser = await newUser.save();

    // Generate verification email URL
    const verifyEmailUrl = `${process.env.FRONTEND_URL}/verify-email?code=${savedUser._id}`;

    // Send verification email
    try {
      await sendEmail({
        sendTo: email,
        subject: 'Verify your email - I-Coffee.ng',
        html: verifyEmailTemplate({
          name: name,
          url: verifyEmailUrl,
        }),
      });
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
      // Continue with registration even if email fails
    }

    // Return user data without sensitive information
    const userResponse = {
      _id: savedUser._id,
      name: savedUser.name,
      email: savedUser.email,
      role: savedUser.role,
      subRole: savedUser.subRole,
      verify_email: savedUser.verify_email,
      status: savedUser.status,
      createdAt: savedUser.createdAt,
    };

    return response.status(201).json({
      message:
        'User registered successfully. Please check your email to verify your account.',
      error: false,
      success: true,
      data: userResponse,
    });
  } catch (error) {
    console.error('Registration error:', error);

    // Handle duplicate key error
    if (error.code === 11000) {
      return response.status(400).json({
        message: 'Email already registered. Please use a different email.',
        error: true,
        success: false,
      });
    }

    return response.status(500).json({
      message: 'Registration failed. Please try again.',
      error: true,
      success: false,
    });
  }
}

export async function verifyEmailController(request, response) {
  try {
    const { code } = request.body;

    if (!code) {
      return response.status(400).json({
        message: 'Verification code is required',
        error: true,
        success: false,
      });
    }

    const user = await UserModel.findOne({ _id: code });

    if (!user) {
      return response.status(400).json({
        message: 'Invalid verification code',
        error: true,
        success: false,
      });
    }

    if (user.verify_email) {
      return response.json({
        message: 'Email already verified',
        success: true,
        error: false,
      });
    }

    await UserModel.updateOne(
      { _id: code },
      {
        verify_email: true,
      }
    );

    return response.json({
      message: 'Email verified successfully',
      success: true,
      error: false,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || 'Email verification failed',
      error: true,
      success: false,
    });
  }
}

// Enhanced login controller with better security and user feedback
export async function loginController(request, response) {
  try {
    const { email, password } = request.body;

    if (!email || !password) {
      return response.status(400).json({
        message: 'Please provide both email and password',
        error: true,
        success: false,
      });
    }

    // Find user by email (case-insensitive)
    const user = await UserModel.findOne({
      email: email.toLowerCase().trim(),
    }).select('+password');

    if (!user) {
      return response.status(401).json({
        message: 'Invalid email or password',
        error: true,
        success: false,
      });
    }

    // Check user status
    if (user.status !== 'Active') {
      return response.status(403).json({
        message: 'Account is inactive. Please contact support.',
        error: true,
        success: false,
      });
    }

    // Verify password
    const checkPassword = await bcryptjs.compare(password, user.password);

    if (!checkPassword) {
      return response.status(401).json({
        message: 'Invalid email or password',
        error: true,
        success: false,
      });
    }

    // Generate tokens
    const accessToken = await generatedAccessToken(user._id);
    const refreshToken = await genertedRefreshToken(user._id);

    // Update last login date
    await UserModel.findByIdAndUpdate(user._id, {
      last_login_date: new Date(),
      refresh_token: refreshToken, // Store refresh token
    });

    // Set secure cookies
    const cookiesOption = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    };

    response.cookie('accessToken', accessToken, cookiesOption);
    response.cookie('refreshToken', refreshToken, {
      ...cookiesOption,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days for refresh token
    });

    // Return success response
    return response.json({
      message: 'Login successful',
      error: false,
      success: true,
      data: {
        accesstoken: accessToken,
        refreshToken: refreshToken,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          subRole: user.subRole,
          verify_email: user.verify_email,
          avatar: user.avatar,
        },
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return response.status(500).json({
      message: 'Login failed. Please try again.',
      error: true,
      success: false,
    });
  }
}

// Enhanced logout controller
export async function logoutController(request, response) {
  try {
    const userId = request.userId; // from middleware

    // Clear refresh token from database
    await UserModel.findByIdAndUpdate(userId, {
      refresh_token: '',
    });

    // Cookie options for clearing
    const cookiesOption = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax',
    };

    // Clear cookies
    response.clearCookie('accessToken', cookiesOption);
    response.clearCookie('refreshToken', cookiesOption);

    return response.json({
      message: 'Logout successful',
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || 'Logout failed',
      error: true,
      success: false,
    });
  }
}

//upload user avatar
export async function uploadAvatar(request, response) {
  try {
    const userId = request.userId; // auth middleware
    const image = request.file; // multer middleware

    if (!image) {
      return response.status(400).json({
        message: 'Please provide an image file',
        error: true,
        success: false,
      });
    }

    const upload = await uploadImageCloudinary(image);

    const updateUser = await UserModel.findByIdAndUpdate(
      userId,
      {
        avatar: upload.url,
      },
      { new: true }
    );

    return response.json({
      message: 'Profile picture updated successfully',
      success: true,
      error: false,
      data: {
        _id: userId,
        avatar: upload.url,
      },
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || 'Failed to upload avatar',
      error: true,
      success: false,
    });
  }
}

//update user details
export async function updateUserDetails(request, response) {
  try {
    const userId = request.userId; //auth middleware
    const { name, email, mobile, password } = request.body;

    const updateData = {};

    // Validate and prepare update data
    if (name && name.trim()) {
      updateData.name = name.trim();
    }

    if (email && email.trim()) {
      const emailLower = email.toLowerCase().trim();

      // Check if email is already taken by another user
      const existingUser = await UserModel.findOne({
        email: emailLower,
        _id: { $ne: userId },
      });

      if (existingUser) {
        return response.status(400).json({
          message: 'Email already in use by another account',
          error: true,
          success: false,
        });
      }

      updateData.email = emailLower;
    }

    if (mobile && mobile.trim()) {
      updateData.mobile = mobile.trim();
    }

    if (password && password.trim()) {
      if (password.length < 6) {
        return response.status(400).json({
          message: 'Password must be at least 6 characters long',
          error: true,
          success: false,
        });
      }

      const salt = await bcryptjs.genSalt(10);
      updateData.password = await bcryptjs.hash(password, salt);
    }

    if (Object.keys(updateData).length === 0) {
      return response.status(400).json({
        message: 'No valid fields provided for update',
        error: true,
        success: false,
      });
    }

    const updatedUser = await UserModel.findByIdAndUpdate(userId, updateData, {
      new: true,
    }).select('-password -refresh_token');

    return response.json({
      message: 'Profile updated successfully',
      error: false,
      success: true,
      data: updatedUser,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || 'Failed to update profile',
      error: true,
      success: false,
    });
  }
}

//forgot password controller
export async function forgotPasswordController(request, response) {
  try {
    const { email } = request.body;

    if (!email || !email.trim()) {
      return response.status(400).json({
        message: 'Email is required',
        error: true,
        success: false,
      });
    }

    const user = await UserModel.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      return response.status(404).json({
        message: 'No account found with this email address',
        error: true,
        success: false,
      });
    }

    if (user.status !== 'Active') {
      return response.status(403).json({
        message: 'Account is inactive. Please contact support.',
        error: true,
        success: false,
      });
    }

    const otp = generatedOtp();
    const expireTime = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await UserModel.findByIdAndUpdate(user._id, {
      forgot_password_otp: otp,
      forgot_password_expiry: expireTime.toISOString(),
    });

    try {
      await sendEmail({
        sendTo: email,
        subject: 'Password Reset - I-Coffee.ng',
        html: forgotPasswordTemplate({
          name: user.name,
          otp: otp,
        }),
      });

      return response.json({
        message: 'Password reset OTP sent to your email',
        error: false,
        success: true,
      });
    } catch (emailError) {
      // Rollback OTP if email fails
      await UserModel.findByIdAndUpdate(user._id, {
        forgot_password_otp: '',
        forgot_password_expiry: '',
      });

      return response.status(500).json({
        message: 'Failed to send reset email. Please try again.',
        error: true,
        success: false,
      });
    }
  } catch (error) {
    return response.status(500).json({
      message: error.message || 'Failed to process password reset request',
      error: true,
      success: false,
    });
  }
}

//verify forgot password otp
export async function verifyForgotPasswordOtp(request, response) {
  try {
    const { email, otp } = request.body;

    if (!email || !otp) {
      return response.status(400).json({
        message: 'Email and OTP are required',
        error: true,
        success: false,
      });
    }

    const user = await UserModel.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      return response.status(404).json({
        message: 'No account found with this email',
        error: true,
        success: false,
      });
    }

    if (!user.forgot_password_otp || !user.forgot_password_expiry) {
      return response.status(400).json({
        message: 'No password reset request found. Please request a new OTP.',
        error: true,
        success: false,
      });
    }

    const currentTime = new Date();
    const expiryTime = new Date(user.forgot_password_expiry);

    if (currentTime > expiryTime) {
      // Clear expired OTP
      await UserModel.findByIdAndUpdate(user._id, {
        forgot_password_otp: '',
        forgot_password_expiry: '',
      });

      return response.status(400).json({
        message: 'OTP has expired. Please request a new one.',
        error: true,
        success: false,
      });
    }

    if (otp !== user.forgot_password_otp) {
      return response.status(400).json({
        message: 'Invalid OTP. Please check and try again.',
        error: true,
        success: false,
      });
    }

    // OTP is valid - clear it from database
    await UserModel.findByIdAndUpdate(user._id, {
      forgot_password_otp: '',
      forgot_password_expiry: '',
    });

    return response.json({
      message: 'OTP verified successfully. You can now reset your password.',
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || 'OTP verification failed',
      error: true,
      success: false,
    });
  }
}

//reset password
export async function resetpassword(request, response) {
  try {
    const { email, newPassword, confirmPassword } = request.body;

    if (!email || !newPassword || !confirmPassword) {
      return response.status(400).json({
        message: 'Email, new password, and confirm password are required',
        error: true,
        success: false,
      });
    }

    if (newPassword !== confirmPassword) {
      return response.status(400).json({
        message: 'New password and confirm password must match',
        error: true,
        success: false,
      });
    }

    if (newPassword.length < 6) {
      return response.status(400).json({
        message: 'Password must be at least 6 characters long',
        error: true,
        success: false,
      });
    }

    const user = await UserModel.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      return response.status(404).json({
        message: 'No account found with this email',
        error: true,
        success: false,
      });
    }

    const salt = await bcryptjs.genSalt(10);
    const hashPassword = await bcryptjs.hash(newPassword, salt);

    await UserModel.findByIdAndUpdate(user._id, {
      password: hashPassword,
      // Clear any remaining OTP data
      forgot_password_otp: '',
      forgot_password_expiry: '',
    });

    return response.json({
      message:
        'Password reset successfully. You can now login with your new password.',
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || 'Password reset failed',
      error: true,
      success: false,
    });
  }
}

//refresh token controller
export async function refreshToken(request, response) {
  try {
    const refreshToken =
      request.cookies.refreshToken ||
      request?.headers?.authorization?.split(' ')[1];

    if (!refreshToken) {
      return response.status(401).json({
        message: 'Refresh token not provided',
        error: true,
        success: false,
      });
    }

    const verifyToken = await jwt.verify(
      refreshToken,
      process.env.SECRET_KEY_REFRESH_TOKEN
    );

    if (!verifyToken) {
      return response.status(401).json({
        message: 'Invalid refresh token',
        error: true,
        success: false,
      });
    }

    const userId = verifyToken._id;

    // Verify user exists and refresh token matches
    const user = await UserModel.findById(userId);
    if (!user || user.refresh_token !== refreshToken) {
      return response.status(401).json({
        message: 'Invalid refresh token',
        error: true,
        success: false,
      });
    }

    const newAccessToken = await generatedAccessToken(userId);

    const cookiesOption = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    };

    response.cookie('accessToken', newAccessToken, cookiesOption);

    return response.json({
      message: 'Access token refreshed successfully',
      error: false,
      success: true,
      data: {
        accessToken: newAccessToken,
      },
    });
  } catch (error) {
    return response.status(401).json({
      message: 'Invalid or expired refresh token',
      error: true,
      success: false,
    });
  }
}

//get login user details
export async function userDetails(request, response) {
  try {
    const userId = request.userId;

    if (!userId) {
      return response.status(401).json({
        message: 'User not authenticated',
        error: true,
        success: false,
      });
    }

    const user = await UserModel.findById(userId)
      .select(
        '-password -refresh_token -forgot_password_otp -forgot_password_expiry'
      )
      .populate(
        'address_details',
        'address_line city state country pincode mobile status'
      );

    if (!user) {
      return response.status(404).json({
        message: 'User not found',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: 'User details retrieved successfully',
      data: user,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: 'Failed to retrieve user details',
      error: true,
      success: false,
    });
  }
}
