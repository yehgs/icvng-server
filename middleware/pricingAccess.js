export const pricingAccess = (requiredAccess = 'view') => {
  return (req, res, next) => {
    const userSubRole = req.user?.subRole;

    // Define roles that can manage pricing
    const canManagePricing = ['MD', 'IT', 'ACCOUNTANT'].includes(userSubRole);

    if (requiredAccess === 'manage' && !canManagePricing) {
      return res.status(403).json({
        message: 'You do not have permission to manage pricing',
        error: true,
        success: false,
      });
    }

    // All authenticated users can view pricing
    next();
  };
};
