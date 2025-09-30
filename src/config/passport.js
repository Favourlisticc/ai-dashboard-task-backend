const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const User = require('../models/users');
const jwt = require('jsonwebtoken');
const GitHubEmailFetcher = require('../utils/githubEmailFetcher');


// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

// Serialize user
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Deserialize user
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

// Google Strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL || 
    (process.env.NODE_ENV === 'production' 
      ? 'https://ai-dashboard-task-backend-1.onrender.com/api/auth/google/callback'
      : 'http://localhost:3005/api/auth/google/callback'),
  scope: ['profile', 'email']
}, async (accessToken, refreshToken, profile, done) => {
  try {
    console.log('🔑 Google OAuth Profile Received:', {
      id: profile.id,
      email: profile.emails[0].value,
      name: profile.displayName
    });

    // Check if user already exists with this Google ID
    let user = await User.findOne({ 'socialAuth.googleId': profile.id });
    
    if (user) {
      console.log('✅ Existing user found with Google ID:', user.email);
      return done(null, user);
    }

    // Check if user exists with the same email
    user = await User.findOne({ email: profile.emails[0].value });
    
    if (user) {
      console.log('🔗 Linking Google account to existing user:', user.email);
      // Link Google account to existing user
      user.socialAuth.googleId = profile.id;
      await user.save();
      return done(null, user);
    }

    // Create new user
    console.log('👤 Creating new user with Google OAuth');
    user = new User({
      username: profile.displayName.replace(/\s+/g, '').toLowerCase() + Math.random().toString(36).substring(7),
      email: profile.emails[0].value,
      password: Math.random().toString(36).slice(2), // Random password for social auth
      profile: {
        firstName: profile.name?.givenName,
        lastName: profile.name?.familyName,
        avatar: profile.photos[0]?.value
      },
      socialAuth: {
        googleId: profile.id
      },
      isVerified: true
    });

    await user.save();
    console.log('✅ New user created successfully:', user.email);
    done(null, user);
  } catch (error) {
    console.error('❌ Error in Google OAuth callback:', error);
    done(error, null);
  }
}));

passport.use(new GitHubStrategy({
  clientID: process.env.GITHUB_CLIENT_ID,
  clientSecret: process.env.GITHUB_CLIENT_SECRET,
  callbackURL: "/api/auth/github/callback",
  scope: ['user:email'],
  userAgent: 'NexusAI-App'
}, async (accessToken, refreshToken, profile, done) => {
  try {
    console.log('=== GitHub Authentication Started ===');
    console.log('Profile ID:', profile.id);
    console.log('Username:', profile.username);

    // Check existing user
    let user = await User.findOne({ 'socialAuth.githubId': profile.id });
    if (user) {
      console.log('Existing user found:', user.email);
      return done(null, user);
    }

    // Fetch emails using our dedicated fetcher
    let emails = null;
    if (accessToken) {
      emails = await GitHubEmailFetcher.getUserEmails(accessToken);
      console.log('Fetched emails:', emails ? emails.length : 0);
    }

    // Get the best available email
    const email = GitHubEmailFetcher.getBestEmail(emails, profile);
    console.log('Selected email:', email);

    // Check for existing email user
    user = await User.findOne({ email: email.toLowerCase() });
    if (user) {
      console.log('Linking to existing user:', user.email);
      user.socialAuth.githubId = profile.id;
      user.socialAuth.githubUsername = profile.username;
      await user.save();
      return done(null, user);
    }

    // Create new user
    user = new User({
      username: profile.username,
      email: email.toLowerCase(),
      password: require('crypto').randomBytes(32).toString('hex'),
      profile: {
        firstName: profile.displayName?.split(' ')[0] || profile.username,
        lastName: profile.displayName?.split(' ').slice(1).join(' ') || 'GitHub User',
        avatar: profile._json?.avatar_url
      },
      socialAuth: {
        githubId: profile.id,
        githubUsername: profile.username,
        githubAccessToken: accessToken
      },
      isVerified: true
    });

    await user.save();
    console.log('New user created successfully');
    done(null, user);

  } catch (error) {
    console.error('GitHub auth error:', error);
    done(error);
  }
}));

// // Facebook Strategy
passport.use(new FacebookStrategy({
  clientID: process.env.FACEBOOK_APP_ID,
  clientSecret: process.env.FACEBOOK_APP_SECRET,
  callbackURL: "/api/auth/facebook/callback",
  profileFields: ['id', 'emails', 'name', 'displayName', 'photos']
}, async (accessToken, refreshToken, profile, done) => {
  try {
    let user = await User.findOne({ 'socialAuth.facebookId': profile.id });
    
    if (user) {
      return done(null, user);
    }

    // Facebook might not return email if user hasn't granted permission
    let email = profile.emails && profile.emails[0] ? profile.emails[0].value : `${profile.id}@facebook.user`;

    user = await User.findOne({ email });
    
    if (user) {
      user.socialAuth.facebookId = profile.id;
      await user.save();
      return done(null, user);
    }

    user = new User({
      username: profile.displayName.replace(/\s+/g, '').toLowerCase() + Math.random().toString(36).substring(7),
      email: email,
      password: Math.random().toString(36).slice(2),
      profile: {
        firstName: profile.name?.givenName,
        lastName: profile.name?.familyName,
        avatar: profile.photos[0]?.value
      },
      socialAuth: {
        facebookId: profile.id
      },
      isVerified: true
    });

    await user.save();
    done(null, user);
  } catch (error) {
    done(error, null);
  }
}));

module.exports = passport;