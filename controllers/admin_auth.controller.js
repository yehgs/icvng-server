import UserModel from '../models/user.model.js';
import bcryptjs from 'bcryptjs';
import generatedAccessToken from '../utils/generatedAccessToken.js';
import genertedRefreshToken from '../utils/generatedRefreshToken.js';

// Admin login controller
export async function adminLoginController(request, response) {
  try {
    const { email, password, subRole } = request.body;

    if (!email || !password || !subRole) {
      return response.status(400).json({
        message: 'Please provide email, password, and subrole',
        error: true,
        success: false,
      });
    }

    // Find user by email
    const user = await UserModel.findOne({ email });

    if (!user) {
      return response.status(400).json({
        message: 'Invalid credentials',
        error: true,
        success: false,
      });
    }

    // Check if user is admin
    if (user.role !== 'ADMIN') {
      return response.status(403).json({
        message: 'Admin access only',
        error: true,
        success: false,
      });
    }

    // Check if subrole matches
    if (user.subRole !== subRole) {
      return response.status(400).json({
        message: 'Invalid subrole selection',
        error: true,
        success: false,
      });
    }

    // Check if user is active
    if (user.status !== 'Active') {
      return response.status(400).json({
        message: 'Account is inactive. Contact administrator',
        error: true,
        success: false,
      });
    }

    // Verify password
    const checkPassword = await bcryptjs.compare(password, user.password);

    if (!checkPassword) {
      return response.status(400).json({
        message: 'Invalid credentials',
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
      refresh_token: refreshToken,
    });

    // Set cookies
    const cookiesOption = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    };

    response.cookie('accessToken', accessToken, cookiesOption);
    response.cookie('refreshToken', refreshToken, {
      ...cookiesOption,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // Prepare user data for response
    const userData = {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      subRole: user.subRole,
      avatar: user.avatar,
      last_login_date: new Date(),
    };

    return response.json({
      message: 'Admin login successful',
      error: false,
      success: true,
      data: {
        user: userData,
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
}

// Get admin dashboard stats
export async function getAdminStatsController(request, response) {
  try {
    const adminUser = request.user;

    // Get user counts by role and status
    const totalUsers = await UserModel.countDocuments();
    const totalAdmins = await UserModel.countDocuments({ role: 'ADMIN' });
    const totalCustomers = await UserModel.countDocuments({ role: 'USER' });
    const activeUsers = await UserModel.countDocuments({ status: 'Active' });
    const inactiveUsers = await UserModel.countDocuments({
      status: 'Inactive',
    });
    const suspendedUsers = await UserModel.countDocuments({
      status: 'Suspended',
    });

    // Get users by subrole (for admins)
    const usersBySubRole = await UserModel.aggregate([
      { $match: { role: 'ADMIN' } },
      { $group: { _id: '$subRole', count: { $sum: 1 } } },
    ]);

    // Get recent user registrations (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentRegistrations = await UserModel.countDocuments({
      createdAt: { $gte: thirtyDaysAgo },
    });

    // Get recent logins (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentLogins = await UserModel.countDocuments({
      last_login_date: { $gte: sevenDaysAgo },
    });

    const stats = {
      overview: {
        totalUsers,
        totalAdmins,
        totalCustomers,
        activeUsers,
        inactiveUsers,
        suspendedUsers,
      },
      adminsBySubRole: usersBySubRole,
      activity: {
        recentRegistrations,
        recentLogins,
      },
      permissions: {
        canCreateUsers: ['IT', 'DIRECTOR', 'HR'].includes(adminUser.subRole),
        canDeleteUsers: ['IT', 'DIRECTOR'].includes(adminUser.subRole),
        canResetPasswords: ['IT', 'DIRECTOR', 'HR'].includes(adminUser.subRole),
        canViewAllUsers: true,
      },
    };

    return response.json({
      message: 'Dashboard stats retrieved successfully',
      error: false,
      success: true,
      data: stats,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
}
