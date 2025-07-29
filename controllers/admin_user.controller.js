//admin

import UserModel from '../models/user.model.js';
import bcryptjs from 'bcryptjs';
import sendEmail from '../config/sendEmail.js';
import newUserWelcomeTemplate from '../utils/newUserWelcomeTemplate.js';
import passwordResetTemplate from '../utils/passwordResetTemplate.js';
import passwordRecoveryTemplate from '../utils/passwordRecoveryTemplate.js';
import generatedOtp from '../utils/generatedOtp.js';

export async function getAllUsersController(request, response) {
  try {
    const {
      page = 1,
      limit = 10,
      role,
      subRole,
      status,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = request.query;

    const adminUser = request.user;

    // Build filter object
    const filter = {};
    if (role) filter.role = role;
    if (subRole) filter.subRole = subRole;
    if (status) filter.status = status;

    // Search functionality
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    // Permission-based filtering
    if (adminUser.subRole === 'HR') {
      // HR can only see USER role and ADMIN role (except DIRECTOR)
      filter.$or = [
        { role: 'USER' },
        { role: 'ADMIN', subRole: { $ne: 'DIRECTOR' } },
      ];
    }

    // Setup pagination options
    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { [sortBy]: sortOrder === 'desc' ? -1 : 1 },
      select: '-password -refresh_token -forgot_password_otp',
      lean: false, // Keep mongoose documents for better compatibility
    };

    // Use paginate method
    const result = await UserModel.paginate(filter, options);

    return response.json({
      message: 'Users retrieved successfully',
      error: false,
      success: true,
      data: {
        docs: result.docs,
        totalDocs: result.totalDocs,
        limit: result.limit,
        page: result.page,
        totalPages: result.totalPages,
        hasNextPage: result.hasNextPage,
        hasPrevPage: result.hasPrevPage,
        nextPage: result.nextPage,
        prevPage: result.prevPage,
      },
    });
  } catch (error) {
    console.error('Error in getAllUsersController:', error);
    return response.status(500).json({
      message: error.message || 'Failed to retrieve users',
      error: true,
      success: false,
    });
  }
}

// Create new user (Admin functionality)
export async function createUserController(request, response) {
  try {
    const { name, email, password, role, subRole, userMode, mobile, address } =
      request.body;
    const adminUser = request.user; // From auth middleware

    // Validation
    if (!name || !email || !password || !role) {
      return response.status(400).json({
        message: 'Provide name, email, password, and role',
        error: true,
        success: false,
      });
    }

    // Permission checks
    const canCreateUser = checkUserCreationPermissions(
      adminUser,
      role,
      subRole
    );
    if (!canCreateUser.allowed) {
      return response.status(403).json({
        message: canCreateUser.message,
        error: true,
        success: false,
      });
    }

    // Check if user already exists
    const existingUser = await UserModel.findOne({ email });
    if (existingUser) {
      return response.status(400).json({
        message: 'User with this email already exists',
        error: true,
        success: false,
      });
    }

    // Hash password
    const salt = await bcryptjs.genSalt(10);
    const hashPassword = await bcryptjs.hash(password, salt);

    // Create user payload
    const userPayload = {
      name,
      email,
      password: hashPassword,
      role,
      subRole: subRole || null,
      mobile: mobile || null,
      address: address || null,
      verify_email: true, // Admin created users are auto-verified
      status: 'Active',
    };

    // Add userMode if provided and valid
    if (userMode && role === 'ADMIN' && subRole === 'SALES') {
      userPayload.userMode = userMode;
    }

    const newUser = new UserModel(userPayload);
    const savedUser = await newUser.save();

    // Send welcome email
    try {
      await sendEmail({
        sendTo: email,
        subject: 'Welcome to I-COFFEE.NG Team',
        html: newUserWelcomeTemplate({
          name,
          email,
          password, // Send temporary password
          role,
          subRole,
          userMode,
          createdBy: adminUser.name,
        }),
      });
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
      // Continue even if email fails
    }

    // Remove password from response
    const userResponse = savedUser.toObject();
    delete userResponse.password;
    delete userResponse.refresh_token;

    return response.json({
      message: 'User created successfully',
      error: false,
      success: true,
      data: userResponse,
    });
  } catch (error) {
    console.error('Error in createUserController:', error);
    return response.status(500).json({
      message: error.message || 'Failed to create user',
      error: true,
      success: false,
    });
  }
}

// Update user details (Admin functionality)
export async function updateUserController(request, response) {
  try {
    const { userId } = request.params;
    const { name, email, mobile, role, subRole, userMode, address, status } =
      request.body;
    const adminUser = request.user;

    // Find user to update
    const userToUpdate = await UserModel.findById(userId);
    if (!userToUpdate) {
      return response.status(404).json({
        message: 'User not found',
        error: true,
        success: false,
      });
    }

    // Permission checks
    const canUpdate = checkUserUpdatePermissions(adminUser, userToUpdate, {
      role,
      subRole,
    });
    if (!canUpdate.allowed) {
      return response.status(403).json({
        message: canUpdate.message,
        error: true,
        success: false,
      });
    }

    // Build update object
    const updateData = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (mobile) updateData.mobile = mobile;
    if (address !== undefined) updateData.address = address;
    if (status) updateData.status = status;
    if (role) updateData.role = role;
    if (subRole !== undefined) updateData.subRole = subRole;

    // Handle userMode
    if (userMode !== undefined) {
      // If the new role/subRole combination supports userMode, set it
      const newRole = role || userToUpdate.role;
      const newSubRole = subRole !== undefined ? subRole : userToUpdate.subRole;

      if (newRole === 'ADMIN' && newSubRole === 'SALES') {
        updateData.userMode = userMode;
      } else {
        // Clear userMode if not ADMIN/SALES
        updateData.userMode = null;
      }
    }

    const updatedUser = await UserModel.findByIdAndUpdate(userId, updateData, {
      new: true,
      select: '-password -refresh_token -forgot_password_otp',
    });

    return response.json({
      message: 'User updated successfully',
      error: false,
      success: true,
      data: updatedUser,
    });
  } catch (error) {
    console.error('Error in updateUserController:', error);
    return response.status(500).json({
      message: error.message || 'Failed to update user',
      error: true,
      success: false,
    });
  }
}

// Reset user password (Admin functionality)
export async function resetUserPasswordController(request, response) {
  try {
    const { userId } = request.params;
    const { newPassword } = request.body;
    const adminUser = request.user;

    // Permission check - only IT, DIRECTOR, and HR can reset passwords
    if (!['IT', 'DIRECTOR', 'HR'].includes(adminUser.subRole)) {
      return response.status(403).json({
        message: 'You do not have permission to reset passwords',
        error: true,
        success: false,
      });
    }

    if (!newPassword) {
      return response.status(400).json({
        message: 'Please provide new password',
        error: true,
        success: false,
      });
    }

    const userToUpdate = await UserModel.findById(userId);
    if (!userToUpdate) {
      return response.status(404).json({
        message: 'User not found',
        error: true,
        success: false,
      });
    }

    // Hash new password
    const salt = await bcryptjs.genSalt(10);
    const hashPassword = await bcryptjs.hash(newPassword, salt);

    await UserModel.findByIdAndUpdate(userId, {
      password: hashPassword,
      refresh_token: '', // Clear refresh token to force re-login
    });

    // Send password reset notification email
    try {
      await sendEmail({
        sendTo: userToUpdate.email,
        subject: 'Password Reset - I-COFFEE.NG',
        html: passwordResetTemplate({
          name: userToUpdate.name,
          newPassword,
          resetBy: adminUser.name,
        }),
      });
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
      // Continue even if email fails
    }

    return response.json({
      message: 'Password reset successfully',
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Error in resetUserPasswordController:', error);
    return response.status(500).json({
      message: error.message || 'Failed to reset password',
      error: true,
      success: false,
    });
  }
}

// Delete/Deactivate user
export async function deleteUserController(request, response) {
  try {
    const { userId } = request.params;
    const adminUser = request.user;

    // Only IT and DIRECTOR can delete users
    if (!['IT', 'DIRECTOR'].includes(adminUser.subRole)) {
      return response.status(403).json({
        message: 'You do not have permission to delete users',
        error: true,
        success: false,
      });
    }

    const userToDelete = await UserModel.findById(userId);
    if (!userToDelete) {
      return response.status(404).json({
        message: 'User not found',
        error: true,
        success: false,
      });
    }

    // Cannot delete DIRECTOR unless you are IT
    if (userToDelete.subRole === 'DIRECTOR' && adminUser.subRole !== 'IT') {
      return response.status(403).json({
        message: 'Only IT can delete DIRECTOR users',
        error: true,
        success: false,
      });
    }

    // Soft delete by changing status
    await UserModel.findByIdAndUpdate(userId, {
      status: 'Suspended',
      refresh_token: '',
    });

    return response.json({
      message: 'User deactivated successfully',
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Error in deleteUserController:', error);
    return response.status(500).json({
      message: error.message || 'Failed to delete user',
      error: true,
      success: false,
    });
  }
}

// Generate password recovery link
export async function generatePasswordRecoveryController(request, response) {
  try {
    const { userId } = request.params;
    const adminUser = request.user;

    // Permission check
    if (!['IT', 'DIRECTOR', 'HR'].includes(adminUser.subRole)) {
      return response.status(403).json({
        message: 'You do not have permission to generate recovery links',
        error: true,
        success: false,
      });
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      return response.status(404).json({
        message: 'User not found',
        error: true,
        success: false,
      });
    }

    const otp = generatedOtp();
    const expireTime = new Date().getTime() + 24 * 60 * 60 * 1000; // 24 hours

    await UserModel.findByIdAndUpdate(userId, {
      forgot_password_otp: otp,
      forgot_password_expiry: new Date(expireTime).toISOString(),
    });

    // Send recovery email
    try {
      await sendEmail({
        sendTo: user.email,
        subject: 'Password Recovery - I-COFFEE.NG',
        html: passwordRecoveryTemplate({
          name: user.name,
          otp,
          recoveryUrl: `${process.env.FRONTEND_URL}/reset-password?code=${otp}&email=${user.email}`,
          generatedBy: adminUser.name,
        }),
      });
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
      return response.status(500).json({
        message: 'Failed to send recovery email',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: 'Password recovery link sent successfully',
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Error in generatePasswordRecoveryController:', error);
    return response.status(500).json({
      message: error.message || 'Failed to generate recovery link',
      error: true,
      success: false,
    });
  }
}

// Helper functions
function checkUserCreationPermissions(adminUser, targetRole, targetSubRole) {
  const { subRole } = adminUser;

  // IT and DIRECTOR can create anyone
  if (['IT', 'DIRECTOR'].includes(subRole)) {
    return { allowed: true };
  }

  // HR cannot create DIRECTOR
  if (subRole === 'HR') {
    if (targetRole === 'ADMIN' && targetSubRole === 'DIRECTOR') {
      return {
        allowed: false,
        message: 'HR cannot create DIRECTOR users',
      };
    }
    return { allowed: true };
  }

  // Other ADMIN can only create USER role
  if (targetRole !== 'USER') {
    return {
      allowed: false,
      message: 'You can only create USER role accounts',
    };
  }

  return { allowed: true };
}

function checkUserUpdatePermissions(adminUser, userToUpdate, updates) {
  const { subRole } = adminUser;

  // IT can update anyone
  if (subRole === 'IT') {
    return { allowed: true };
  }

  // DIRECTOR can update anyone except other DIRECTORS (unless IT)
  if (subRole === 'DIRECTOR') {
    if (
      userToUpdate.subRole === 'DIRECTOR' &&
      userToUpdate._id.toString() !== adminUser._id.toString()
    ) {
      return {
        allowed: false,
        message: 'Only IT can update other DIRECTOR users',
      };
    }
    return { allowed: true };
  }

  // HR cannot update DIRECTOR
  if (subRole === 'HR') {
    if (userToUpdate.subRole === 'DIRECTOR') {
      return {
        allowed: false,
        message: 'HR cannot update DIRECTOR users',
      };
    }
    // HR cannot promote someone to DIRECTOR
    if (updates.subRole === 'DIRECTOR') {
      return {
        allowed: false,
        message: 'HR cannot promote users to DIRECTOR role',
      };
    }
    return { allowed: true };
  }

  // Other ADMIN can only update USER role
  if (userToUpdate.role !== 'USER') {
    return {
      allowed: false,
      message: 'You can only update USER role accounts',
    };
  }

  return { allowed: true };
}
