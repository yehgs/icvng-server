//icvng-server/middleware/roleAuth.js
export const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        message: "Authentication required",
        error: true,
        success: false,
      });
    }

    // Check if user has required role
    if (user.role !== "ADMIN") {
      return res.status(403).json({
        message: "Admin access required",
        error: true,
        success: false,
      });
    }

    // Check if user has required sub-role
    if (allowedRoles && allowedRoles.length > 0) {
      if (!allowedRoles.includes(user.subRole)) {
        return res.status(403).json({
          message: `Access denied. Required roles: ${allowedRoles.join(", ")}`,
          error: true,
          success: false,
        });
      }
    }

    next();
  };
};
