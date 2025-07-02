// middleware/adminAuth.js
const adminAuth = async (request, response, next) => {
  try {
    const user = request.user; // From auth middleware

    if (!user) {
      return response.status(401).json({
        message: 'Authentication required',
        error: true,
        success: false,
      });
    }

    // Check if user is admin
    if (user.role !== 'ADMIN') {
      return response.status(403).json({
        message: 'Admin access required',
        error: true,
        success: false,
      });
    }

    // Check if user is active
    if (user.status !== 'Active') {
      return response.status(403).json({
        message: 'Account is not active',
        error: true,
        success: false,
      });
    }

    next();
  } catch (error) {
    return response.status(500).json({
      message: 'Authorization error',
      error: true,
      success: false,
    });
  }
};

export default adminAuth;
