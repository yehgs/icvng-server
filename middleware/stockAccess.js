export const stockAccess = (requiredAccess = 'view') => {
  return (req, res, next) => {
    const userSubRole = req.user?.subRole;

    // Define roles that can manage stock
    const canManageStock = ['MD', 'IT', 'WAREHOUSE'].includes(userSubRole);

    if (requiredAccess === 'manage' && !canManageStock) {
      return res.status(403).json({
        message: 'You do not have permission to manage stock',
        error: true,
        success: false,
      });
    }

    // All authenticated users can view stock
    next();
  };
};
