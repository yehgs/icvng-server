import jwt from 'jsonwebtoken';
import UserModel from '../models/user.model.js';

// Strict authentication middleware (for protected routes)
const auth = async (request, response, next) => {
  try {
    const token =
      request.cookies.accessToken ||
      request?.headers?.authorization?.split(' ')[1];

    if (!token) {
      return response.status(401).json({
        message: 'Provide token',
        error: true,
        success: false,
      });
    }

    const decode = await jwt.verify(token, process.env.SECRET_KEY_ACCESS_TOKEN);

    if (!decode) {
      return response.status(401).json({
        message: 'unauthorized access',
        error: true,
        success: false,
      });
    }

    const user = await UserModel.findById(decode.id);

    if (!user) {
      return response.status(401).json({
        message: 'User not found',
        error: true,
        success: false,
      });
    }

    request.user = user;
    request.userId = decode.id;

    next();
  } catch (error) {
    // PHASE 1 FIX: invalid/expired tokens are an auth failure (401), not a
    // server error (500). Clients rely on 401 to trigger refresh/redirect.
    return response.status(401).json({
      message: 'Invalid or expired token. Please login again.',
      error: true,
      success: false,
    });
  }
};

// Optional authentication middleware (for cart and guest features)
const optionalAuth = async (request, response, next) => {
  try {
    const token =
      request.cookies.accessToken ||
      request?.headers?.authorization?.split(' ')[1];

    if (token) {
      try {
        const decode = await jwt.verify(
          token,
          process.env.SECRET_KEY_ACCESS_TOKEN
        );

        if (decode) {
          const user = await UserModel.findById(decode.id);

          if (user) {
            request.user = user;
            request.userId = decode.id;
          }
        }
      } catch (error) {
        // Token is invalid but we continue without authentication
        console.log('Invalid token, continuing as guest:', error.message);
        // Don't set user/userId, let request continue as guest
      }
    }

    // Continue regardless of token validity - guest users allowed
    next();
  } catch (error) {
    // Continue as guest user even if there's an error
    console.log('Auth error, continuing as guest:', error.message);
    next();
  }
};


// PHASE 4: mark as a guard so the boot-time route auditor detects it
auth.__isGuard = true;
export default auth;
export { optionalAuth };
