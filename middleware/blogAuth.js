// middleware/adminAuth.js
import UserModel from '../models/user.model.js';

const blogAuth = (allowedSubRoles = []) => {
  return async (request, response, next) => {
    try {
      const userId = request.userId; // from auth middleware

      if (!userId) {
        return response.status(401).json({
          message: 'Access denied. User not authenticated.',
          error: true,
          success: false,
        });
      }

      // Get user details
      const user = await UserModel.findById(userId);

      if (!user) {
        return response.status(401).json({
          message: 'Access denied. User not found.',
          error: true,
          success: false,
        });
      }

      // Check if user has admin role
      if (user.role !== 'ADMIN') {
        return response.status(403).json({
          message: 'Access denied. Admin role required.',
          error: true,
          success: false,
        });
      }

      // Check sub-role if specified
      if (
        allowedSubRoles.length > 0 &&
        !allowedSubRoles.includes(user.subRole)
      ) {
        return response.status(403).json({
          message: `Access denied. Required sub-role: ${allowedSubRoles.join(
            ' or '
          )}`,
          error: true,
          success: false,
        });
      }

      // Add user info to request
      request.userRole = user.role;
      request.userSubRole = user.subRole;

      next();
    } catch (error) {
      console.error('Admin auth middleware error:', error);
      return response.status(500).json({
        message: 'Internal server error',
        error: true,
        success: false,
      });
    }
  };
};

export default blogAuth;
