import jwt from 'jsonwebtoken';

// Strict authentication middleware (for protected routes)
const auth = async (request, response, next) => {
  try {
    const token =
      request.cookies?.accessToken ||
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

    request.userId = decode.id;

    next();
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// Optional authentication middleware (for cart and guest features)
const optionalAuth = async (request, response, next) => {
  try {
    const token =
      request.cookies?.accessToken ||
      request?.headers?.authorization?.split(' ')[1];

    if (token) {
      try {
        const decode = await jwt.verify(
          token,
          process.env.SECRET_KEY_ACCESS_TOKEN
        );
        if (decode) {
          request.userId = decode.id;
        }
      } catch (error) {
        // Token is invalid but we continue without authentication
        console.log('Invalid token, continuing as guest:', error.message);
      }
    }

    // Continue regardless of token validity
    next();
  } catch (error) {
    // Continue as guest user
    next();
  }
};

export default auth;
export { optionalAuth };
