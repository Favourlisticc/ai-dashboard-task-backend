const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const { body, validationResult } = require('express-validator');
const User = require('../models/users');

const router = express.Router();

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET || 'your_fallback_secret', { expiresIn: '7d' });
};

// Input validation middleware
const validateUser = (method) => {
  switch (method) {
    case 'register':
      return [
        body('username')
          .isLength({ min: 3 })
          .withMessage('Username must be at least 3 characters long')
          .isAlphanumeric()
          .withMessage('Username must contain only letters and numbers')
          .trim()
          .escape(),
        body('email')
          .isEmail()
          .withMessage('Please provide a valid email')
          .normalizeEmail(),
        body('password')
          .isLength({ min: 6 })
          .withMessage('Password must be at least 6 characters long')
          .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
          .withMessage('Password must contain at least one lowercase letter, one uppercase letter, and one number')
      ];
    case 'login':
      return [
        body('email')
          .isEmail()
          .withMessage('Please provide a valid email')
          .normalizeEmail(),
        body('password')
          .exists()
          .withMessage('Password is required')
      ];
  }
};

const handleSocialAuthSuccess = (req, res) => {
  if (!req.user) {
    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth?error=authentication_failed`);
  }

  const token = generateToken(req.user._id);
  
  // Include comprehensive user data
  const userData = {
    id: req.user._id,
    username: req.user.username,
    email: req.user.email,
    profile: req.user.profile,
    socialAuth: req.user.socialAuth,
    createdAt: req.user.createdAt,
    isVerified: req.user.isVerified
  };

  console.log('Social auth successful for user:', userData);

  try {
    // Debug: Check the FRONTEND_URL value
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    console.log('Frontend URL:', frontendUrl);
    
    // Validate the URL
    if (!frontendUrl || typeof frontendUrl !== 'string') {
      throw new Error(`Invalid FRONTEND_URL: ${frontendUrl}`);
    }

    // Ensure the URL has protocol
    let validatedUrl = frontendUrl;
    if (!validatedUrl.startsWith('http://') && !validatedUrl.startsWith('https://')) {
      validatedUrl = `https://${validatedUrl}`;
    }

    // Remove any trailing slashes
    validatedUrl = validatedUrl.replace(/\/$/, '');

    console.log('Validated Frontend URL:', validatedUrl);

    // Create the redirect URL safely
    const redirectUrl = new URL('/auth/success', validatedUrl);
    redirectUrl.searchParams.set('token', token);
    redirectUrl.searchParams.set('user', JSON.stringify(userData));
    
    console.log('Final redirect URL:', redirectUrl.toString());
    
    res.redirect(redirectUrl.toString());
    
  } catch (error) {
    console.error('❌ Error creating redirect URL:', error.message);
    console.error('FRONTEND_URL value:', process.env.FRONTEND_URL);
    
    // Fallback redirect
    const fallbackUrl = `http://localhost:3000/auth/success?token=${token}&user=${encodeURIComponent(JSON.stringify(userData))}`;
    console.log('Using fallback URL:', fallbackUrl);
    res.redirect(fallbackUrl);
  }
};

// Error handler for social auth
const handleSocialAuthError = (error, req, res, next) => {
  console.error('Social auth error:', error);
  res.redirect(`${process.env.FRONTEND_URL}/auth?error=authentication_failed`);
};

// In your backend auth routes, add more detailed logging
router.post('/register', validateUser('register'), async (req, res) => {
  try {
    console.log('Registration attempt:', { 
      username: req.body.username, 
      email: req.body.email 
    });

    // Check for validation errors
    const errors = validationResult(req);
    console.log('Validation errors:', errors.array());
    
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array().map(error => ({
          field: error.path,
          message: error.msg,
          value: error.value
        }))
      });
    }

    const { username, email, password } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { username }]
    });

    if (existingUser) {
      console.log('User already exists:', { email, username });
      return res.status(400).json({
        success: false,
        message: 'User with this email or username already exists'
      });
    }

    // Create new user
    const user = new User({
      username,
      email,
      password
    });

    await user.save();
    console.log('User created successfully:', user._id);

    // Generate token
    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        createdAt: user.createdAt
      }
    });

  } catch (error) {
    console.error('Registration error details:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration',
      error: error.message
    });
  }
});

router.post('/login', validateUser('login'), async (req, res) => {
  try {
    console.log('Login attempt:', { email: req.body.email });

    // Check for validation errors
    const errors = validationResult(req);
    console.log('Validation errors:', errors.array());
    
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array().map(error => ({
          field: error.path,
          message: error.msg,
          value: error.value
        }))
      });
    }

    const { email, password } = req.body;

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      console.log('User not found for email:', email);
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      console.log('Invalid password for user:', email);
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    console.log('Login successful for user:', user._id);

    // Generate token
    const token = generateToken(user._id);

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        createdAt: user.createdAt
      }
    });

  } catch (error) {
    console.error('Login error details:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login',
      error: error.message
    });
  }
});

// Google Auth
router.get('/google', (req, res, next) => {
  console.log('🔐 Initiating Google OAuth flow');
  console.log('🌐 Environment:', {
    NODE_ENV: process.env.NODE_ENV,
    BACKEND_URL: process.env.BACKEND_URL,
    GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL
  });
  
  console.log('🔍 Request details:', {
    protocol: req.protocol,
    host: req.get('host'),
    originalUrl: req.originalUrl,
    secure: req.secure
  });
  
  passport.authenticate('google', { 
    scope: ['profile', 'email'],
    session: false 
  })(req, res, next);
});

router.get('/google/callback', 
  (req, res, next) => {
    console.log('🔄 Google OAuth callback received');
    console.log('📝 Callback details:', {
      method: req.method,
      url: req.url,
      query: req.query,
      hasCode: !!req.query.code,
      hasError: !!req.query.error,
      error: req.query.error
    });
    
    passport.authenticate('google', { 
      failureRedirect: `${process.env.FRONTEND_URL}/auth?error=google_auth_failed`,
      session: false 
    })(req, res, next);
  },
  (req, res, next) => {
    console.log('✅ Google OAuth authentication successful');
    console.log('👤 User authenticated:', {
      id: req.user?.id,
      email: req.user?.email,
      name: req.user?.name
    });
    handleSocialAuthSuccess(req, res, next);
  }
);

// GitHub Auth
router.get('/github', passport.authenticate('github', { 
  scope: ['user:email'],
  session: false 
}));

router.get('/github/callback',
  passport.authenticate('github', { 
    failureRedirect: `${process.env.FRONTEND_URL}/auth?error=github_auth_failed`,
    session: false 
  }),
  handleSocialAuthSuccess
);

// Facebook Auth
router.get('/facebook', passport.authenticate('facebook', { 
  scope: ['email'],
  session: false 
}));

router.get('/facebook/callback',
  passport.authenticate('facebook', { 
    failureRedirect: `${process.env.FRONTEND_URL}/auth?error=facebook_auth_failed`,
    session: false 
  }),
  handleSocialAuthSuccess
);

// Get social auth URLs (for frontend)
router.get('/providers', (req, res) => {
  res.json({
    success: true,
    providers: {
      google: '/api/auth/google',
      github: '/api/auth/github',
      facebook: '/api/auth/facebook'
    }
  });
});



module.exports = router;