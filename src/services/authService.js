const jwt = require('jsonwebtoken');
const User = require('../models/users');

class AuthService {
  // Generate JWT token
  generateToken(user) {
    return jwt.sign(
      {
        _id: user._id,
        email: user.email,
        username: user.username,
        role: user.role || 'user' // Include role in token
      },
      process.env.JWT_SECRET, // Use environment variable
      { expiresIn: '7d' }
    );
  }

  // Verify JWT token
  verifyToken(token) {
    try {
      return jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  // Generate admin token (same as regular token but with role check)
  generateAdminToken(admin) {
    return jwt.sign(
      {
        _id: admin._id,
        email: admin.email,
        username: admin.username,
        role: 'admin'
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
  }

  // Decode token without verification (for checking expiration, etc.)
  decodeToken(token) {
    return jwt.decode(token);
  }

  // Check if token is expired
  isTokenExpired(token) {
    try {
      const decoded = this.decodeToken(token);
      if (!decoded || !decoded.exp) return true;
      
      const currentTime = Math.floor(Date.now() / 1000);
      return decoded.exp < currentTime;
    } catch (error) {
      return true;
    }
  }

  // Refresh token
  refreshToken(oldToken) {
    try {
      const decoded = this.verifyToken(oldToken);
      return this.generateToken({
        _id: decoded._id,
        email: decoded.email,
        username: decoded.username,
        role: decoded.role
      });
    } catch (error) {
      throw new Error('Cannot refresh invalid token');
    }
  }

  // Validate user from token
  async validateUser(token) {
    try {
      const decoded = this.verifyToken(token);
      const user = await User.findById(decoded._id);
      
      if (!user || !user.isActive) {
        throw new Error('User not found or inactive');
      }
      
      return user;
    } catch (error) {
      throw new Error('Invalid user token');
    }
  }

  // Validate admin from token
  async validateAdmin(token) {
    try {
      const decoded = this.verifyToken(token);
      
      if (decoded.role !== 'admin') {
        throw new Error('Admin access required');
      }
      
      // For demo admins, just return the decoded data
      if (decoded._id.includes('demo_admin_id')) {
        return decoded;
      }
      
      // For real admins, check database
      const admin = await User.findOne({ 
        _id: decoded._id, 
        role: 'admin',
        isActive: true 
      });
      
      if (!admin) {
        throw new Error('Admin not found');
      }
      
      return admin;
    } catch (error) {
      throw new Error('Invalid admin token');
    }
  }
}

module.exports = new AuthService();