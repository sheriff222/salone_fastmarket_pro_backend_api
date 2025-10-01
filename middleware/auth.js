const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler');
const User = require('../model/user');

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-2024';

// Token expiration: 30 days (720 hours)
const TOKEN_EXPIRY = '720h';

// Generate JWT Token with 30-day expiration
const generateToken = (userId) => {
  return jwt.sign(
    { id: userId }, 
    JWT_SECRET, 
    { expiresIn: TOKEN_EXPIRY }
  );
};

// Verify JWT Token Middleware
const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization?.startsWith('Bearer')) {
    try {
      // Extract token
      token = req.headers.authorization.split(' ')[1];
      
      // Verify token
      const decoded = jwt.verify(token, JWT_SECRET);
      
      // Find user (exclude password)
      req.user = await User.findById(decoded.id).select('-password');
      
      if (!req.user) {
        return res.status(401).json({ 
          success: false, 
          message: 'User not found - token invalid' 
        });
      }

      // Token is valid, continue
      next();
      
    } catch (error) {
      console.error('Token verification error:', error.message);
      
      // Handle specific JWT errors
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          success: false, 
          message: 'Token expired',
          code: 'TOKEN_EXPIRED'
        });
      }
      
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({ 
          success: false, 
          message: 'Invalid token',
          code: 'INVALID_TOKEN'
        });
      }
      
      // Generic token error
      return res.status(401).json({ 
        success: false, 
        message: 'Token verification failed',
        code: 'AUTH_FAILED'
      });
    }
  } else {
    return res.status(401).json({ 
      success: false, 
      message: 'Access denied. No token provided.',
      code: 'NO_TOKEN'
    });
  }
});

// Optional: Middleware to check if token is about to expire (within 24 hours)
// and send a warning header
const checkTokenExpiry = asyncHandler(async (req, res, next) => {
  if (req.headers.authorization?.startsWith('Bearer')) {
    try {
      const token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      
      // Check if token expires within 24 hours
      const expiryTime = decoded.exp * 1000; // Convert to milliseconds
      const timeUntilExpiry = expiryTime - Date.now();
      const hoursUntilExpiry = timeUntilExpiry / (1000 * 60 * 60);
      
      if (hoursUntilExpiry <= 24 && hoursUntilExpiry > 0) {
        res.setHeader('X-Token-Expiring-Soon', 'true');
        res.setHeader('X-Token-Hours-Remaining', Math.floor(hoursUntilExpiry).toString());
      }
    } catch (error) {
      // Ignore errors in this middleware - main protect middleware will handle
    }
  }
  next();
});

// Refresh token endpoint (optional - generates new token)
const refreshToken = asyncHandler(async (req, res) => {
  let token;

  if (req.headers.authorization?.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true });
      
      // Check if user still exists
      const user = await User.findById(decoded.id).select('-password');
      
      if (!user) {
        return res.status(404).json({ 
          success: false, 
          message: 'User not found' 
        });
      }

      // Generate new token
      const newToken = generateToken(user._id);
      
      return res.status(200).json({
        success: true,
        token: newToken,
        message: 'Token refreshed successfully',
        data: user
      });
      
    } catch (error) {
      return res.status(401).json({ 
        success: false, 
        message: 'Token refresh failed' 
      });
    }
  } else {
    return res.status(401).json({ 
      success: false, 
      message: 'No token provided' 
    });
  }
});

module.exports = { 
  generateToken, 
  protect, 
  checkTokenExpiry,
  refreshToken 
};