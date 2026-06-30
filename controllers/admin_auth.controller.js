// controllers/admin_auth.controller.js
import UserModel from '../models/user.model.js';
import bcryptjs from 'bcryptjs';
import generatedAccessToken from '../utils/generatedAccessToken.js';
import genertedRefreshToken from '../utils/generatedRefreshToken.js';

/**
 * POST /api/admin/auth/login
 *
 * Standard login: email + password + subRole (department selector).
 * subRole in the request body must match the user's subRole in the database.
 *
 * scope and assignedCountry are automatically read from the user record —
 * the frontend never needs to know about them at login time.
 */
export async function adminLoginController(request, response) {
  try {
    const { email, password, subRole } = request.body;

    if (!email || !password || !subRole) {
      return response.status(400).json({
        message: 'Please provide email, password, and department',
        error: true,
        success: false,
      });
    }

    const user = await UserModel.findOne({ email });

    if (!user) {
      return response.status(400).json({ message: 'Invalid credentials', error: true, success: false });
    }

    if (user.role !== 'ADMIN') {
      return response.status(403).json({ message: 'Admin access only', error: true, success: false });
    }

    // Department selector must match the user's actual subRole
    if (user.subRole !== subRole) {
      return response.status(400).json({ message: 'Invalid department selection', error: true, success: false });
    }

    if (user.status !== 'Active') {
      return response.status(400).json({ message: 'Account is inactive. Contact administrator.', error: true, success: false });
    }

    const checkPassword = await bcryptjs.compare(password, user.password);
    if (!checkPassword) {
      return response.status(400).json({ message: 'Invalid credentials', error: true, success: false });
    }

    const accessToken  = await generatedAccessToken(user._id);
    const refreshToken = await genertedRefreshToken(user._id);

    await UserModel.findByIdAndUpdate(user._id, {
      last_login_date: new Date(),
      refresh_token: refreshToken,
    });

    const cookiesOption = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 24 * 60 * 60 * 1000,
    };

    response.cookie('accessToken', accessToken, cookiesOption);
    response.cookie('refreshToken', refreshToken, { ...cookiesOption, maxAge: 7 * 24 * 60 * 60 * 1000 });

    // Return all fields the frontend needs to drive UI behaviour
    const userData = {
      _id:             user._id,
      name:            user.name,
      email:           user.email,
      role:            user.role,
      subRole:         user.subRole,
      scope:           user.scope,           // "GLOBAL" | "COUNTRY"
      assignedCountry: user.assignedCountry, // null | "NG" | "TG" | "BJ" | "IT"
      preferredLanguage: user.preferredLanguage,
      avatar:          user.avatar,
      last_login_date: new Date(),
      ...(user.subRole === 'SALES' && { userMode: user.userMode }),
    };

    return response.json({
      message: 'Admin login successful',
      error: false,
      success: true,
      data: { user: userData, accessToken, refreshToken },
    });
  } catch (error) {
    return response.status(500).json({ message: error.message || error, error: true, success: false });
  }
}

/**
 * GET /api/admin/auth/stats
 * Stats for the admin dashboard (used by IT/DIRECTOR/MANAGER dashboard tiles).
 */
export async function getAdminStatsController(request, response) {
  try {
    const adminUser = request.user;

    const [totalUsers, totalAdmins, totalCustomers, activeUsers,
           inactiveUsers, suspendedUsers, usersBySubRole,
           recentRegistrations, recentLogins] = await Promise.all([
      UserModel.countDocuments(),
      UserModel.countDocuments({ role: 'ADMIN' }),
      UserModel.countDocuments({ role: 'USER' }),
      UserModel.countDocuments({ status: 'Active' }),
      UserModel.countDocuments({ status: 'Inactive' }),
      UserModel.countDocuments({ status: 'Suspended' }),
      UserModel.aggregate([{ $match: { role: 'ADMIN' } }, { $group: { _id: '$subRole', count: { $sum: 1 } } }]),
      UserModel.countDocuments({ createdAt: { $gte: new Date(Date.now() - 30 * 86400000) } }),
      UserModel.countDocuments({ last_login_date: { $gte: new Date(Date.now() - 7 * 86400000) } }),
    ]);

    return response.json({
      message: 'Dashboard stats retrieved successfully',
      error: false,
      success: true,
      data: {
        overview: { totalUsers, totalAdmins, totalCustomers, activeUsers, inactiveUsers, suspendedUsers },
        adminsBySubRole: usersBySubRole,
        activity: { recentRegistrations, recentLogins },
        permissions: {
          canCreateUsers:   ['IT', 'DIRECTOR', 'HR', 'MANAGER'].includes(adminUser.subRole),
          canDeleteUsers:   ['IT', 'DIRECTOR'].includes(adminUser.subRole),
          canResetPasswords:['IT', 'DIRECTOR', 'HR', 'MANAGER'].includes(adminUser.subRole),
          canViewAllUsers:  true,
        },
      },
    });
  } catch (error) {
    return response.status(500).json({ message: error.message || error, error: true, success: false });
  }
}
