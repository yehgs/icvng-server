/**
 * middleware/roleAuth.js
 *
 * requireRole — standard subRole guard.
 * Works identically for all admin users regardless of scope.
 *
 * Usage:
 *   router.get("/orders", auth, adminAuth, requireRole(["SALES", "MANAGER", "IT", "DIRECTOR"]), handler);
 */
export const requireRole = (allowedRoles) => {
  const mw = (req, res, next) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ message: "Authentication required", error: true, success: false });
    }

    if (user.role !== "ADMIN") {
      return res.status(403).json({ message: "Admin access required", error: true, success: false });
    }

    if (!allowedRoles || allowedRoles.length === 0) return next();

    if (allowedRoles.includes(user.subRole)) return next();

    return res.status(403).json({
      message: `Access denied. Required roles: ${allowedRoles.join(", ")}`,
      error: true,
      success: false,
    });
  };
  mw.__isGuard = true;
  return mw;
};
