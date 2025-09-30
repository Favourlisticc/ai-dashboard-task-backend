const express = require('express');
const User = require('../models/users');
const ChatHistory = require('../models/ChatHistory');
const auth = require('../middleware/auth');
const router = express.Router();


// Admin login
// Admin login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      
      console.log('Invalid password attempt for admin:', email);
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    // Demo admin credentials (for testing purposes)
    const demoAdmins = [
      {
        email: 'admin@demo.com',
        password: 'admin123',
        username: 'admin_demo',
        profile: { firstName: 'Demo', lastName: 'Admin' }
      },
      {
        email: 'super@admin.com', 
        password: 'super123',
        username: 'super_admin',
        profile: { firstName: 'Super', lastName: 'Admin' }
      }
    ];

    // Check if it's a demo admin login
    const demoAdmin = demoAdmins.find(admin => 
      admin.email === email.toLowerCase() && admin.password === password
    );

    if (demoAdmin) {
      // For demo admin, return success without database check
      const token = await require('../services/authService').generateToken({
        _id: 'demo_admin_id_' + Date.now(),
        email: demoAdmin.email,
        username: demoAdmin.username,
        role: 'admin'
      });

      return res.json({
        success: true,
        token: token,
        admin: {
          _id: 'demo_admin_id_' + Date.now(),
          email: demoAdmin.email,
          username: demoAdmin.username,
          profile: demoAdmin.profile,
          role: 'admin'
        },
        message: 'Demo admin login successful',
        isDemo: true
      });
    }

    // Regular admin login (database check)
    const admin = await User.findOne({ 
      email: email.toLowerCase(),
      role: 'admin'
    });

    if (!admin) {
         console.log('Invalid password attempt for admin:', email);
      return res.status(401).json({
        success: false,
        error: 'Invalid admin credentials'
      });
    }

    // Check password
    const isPasswordValid = await admin.comparePassword(password);
    if (!isPasswordValid) {
        console.log('Invalid password attempt for admin:', email);
      return res.status(401).json({
        success: false,
        error: 'Invalid admin credentials'
      });
    }

    // Update login stats
    await admin.updateLoginStats();

    // Generate token
    const token = await require('../services/authService').generateToken({
      _id: admin._id,
      email: admin.email,
      username: admin.username,
      role: admin.role
    });

    res.json({
      success: true,
      token: token,
      admin: {
        _id: admin._id,
        email: admin.email,
        username: admin.username,
        profile: admin.profile,
        role: admin.role
      },
      message: 'Admin login successful',
      isDemo: false
    });

  } catch (error) {
    console.log('Admin login error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error during admin login'
    });
  }
});

// Get all users (admin only)
router.get('/users', async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;

    // Modified query to include users without role field OR role = 'user'
    const query = {
      $or: [
        { role: 'user' },
        { role: { $exists: false } } // Include users without role field
      ]
    };

    // Add search functionality
    if (search) {
      query.$and = [
        {
          $or: [
            { username: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { 'profile.firstName': { $regex: search, $options: 'i' } },
            { 'profile.lastName': { $regex: search, $options: 'i' } }
          ]
        },
        {
          $or: [
            { role: 'user' },
            { role: { $exists: false } }
          ]
        }
      ];
      delete query.$or; // Remove the original $or since we're using $and now
    }

    const users = await User.find(query)
      .select('-password') // Exclude password
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const totalUsers = await User.countDocuments(query);
    const activeUsers = await User.countDocuments({ ...query, isActive: true });
    const verifiedUsers = await User.countDocuments({ ...query, isVerified: true });

    console.log(`Fetched ${users.length} users (Page: ${page}, Limit: ${limit}, Search: "${search}")`);

    res.json({
      success: true,
      users: users,
      stats: {
        total: totalUsers,
        active: activeUsers,
        verified: verifiedUsers,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(totalUsers / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users'
    });
  }
});

// Get user details
router.get('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId)
      .select('-password')
      .populate({
        path: 'chatHistory',
        options: { sort: { lastActivity: -1 }, limit: 10 }
      });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Get user stats
    const chatStats = await ChatHistory.aggregate([
      { $match: { user: user._id } },
      {
        $group: {
          _id: null,
          totalChats: { $sum: 1 },
          totalMessages: { $sum: '$messageCount' },
          avgMessagesPerChat: { $avg: '$messageCount' }
        }
      }
    ]);

    const topicStats = await ChatHistory.aggregate([
      { $match: { user: user._id } },
      {
        $group: {
          _id: '$topic',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    res.json({
      success: true,
      user: {
        ...user.toObject(),
        stats: {
          totalChats: chatStats[0]?.totalChats || 0,
          totalMessages: chatStats[0]?.totalMessages || 0,
          avgMessagesPerChat: Math.round(chatStats[0]?.avgMessagesPerChat || 0),
          topicDistribution: topicStats
        }
      }
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user details'
    });
  }
});

// Get all chats (admin view)
router.get('/chats', async (req, res) => {
  try {
    const { page = 1, limit = 20, userId, topic, dateFrom, dateTo } = req.query;
    
    let query = { isAuthenticated: true };

    // Apply filters
    if (userId) {
      query.user = userId;
    }
    if (topic && topic !== 'all') {
      query.topic = topic;
    }
    if (dateFrom || dateTo) {
      query.lastActivity = {};
      if (dateFrom) query.lastActivity.$gte = new Date(dateFrom);
      if (dateTo) query.lastActivity.$lte = new Date(dateTo);
    }

    const chats = await ChatHistory.find(query)
      .populate('user', 'username email profile.firstName profile.lastName')
      .sort({ lastActivity: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const totalChats = await ChatHistory.countDocuments(query);

    // Get chat statistics
    const stats = await ChatHistory.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalChats: { $sum: 1 },
          totalMessages: { $sum: '$messageCount' },
          uniqueUsers: { $addToSet: '$user' }
        }
      },
      {
        $project: {
          totalChats: 1,
          totalMessages: 1,
          uniqueUsersCount: { $size: '$uniqueUsers' }
        }
      }
    ]);

    const topicStats = await ChatHistory.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$topic',
          count: { $sum: 1 },
          avgMessages: { $avg: '$messageCount' }
        }
      }
    ]);

    res.json({
      success: true,
      chats: chats,
      stats: {
        ...stats[0],
        topicDistribution: topicStats,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(totalChats / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch chats'
    });
  }
});

// Get specific chat details
router.get('/chats/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;

    const chat = await ChatHistory.findById(chatId)
      .populate('user', 'username email profile.firstName profile.lastName');

    if (!chat) {
      return res.status(404).json({
        success: false,
        error: 'Chat not found'
      });
    }

    res.json({
      success: true,
      chat: chat
    });

  } catch (error) {
    console.error('Get chat error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch chat details'
    });
  }
});

// Delete user (admin only)
router.delete('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // Prevent admin from deleting themselves
    if (userId === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete your own account'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Delete user's chat history first
    await ChatHistory.deleteMany({ user: userId });
    
    // Then delete the user
    await User.findByIdAndDelete(userId);

    res.json({
      success: true,
      message: 'User and their chat history deleted successfully'
    });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete user'
    });
  }
});

// Delete chat (admin only)
router.delete('/chats/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;

    const chat = await ChatHistory.findByIdAndDelete(chatId);

    if (!chat) {
      return res.status(404).json({
        success: false,
        error: 'Chat not found'
      });
    }

    res.json({
      success: true,
      message: 'Chat deleted successfully'
    });

  } catch (error) {
    console.error('Delete chat error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete chat'
    });
  }
});

// Update user status (activate/deactivate)
router.patch('/users/:userId/status', async (req, res) => {
  try {
    const { userId } = req.params;
    const { isActive } = req.body;

    const user = await User.findByIdAndUpdate(
      userId,
      { isActive: isActive },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
      user: user
    });

  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update user status'
    });
  }
});

// Admin dashboard statistics
router.get('/stats', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({isActive: true });
    const newUsersToday = await User.countDocuments({
      createdAt: { $gte: new Date().setHours(0, 0, 0, 0) }
    });

    const totalChats = await ChatHistory.countDocuments({ isAuthenticated: true });
    const totalMessages = await ChatHistory.aggregate([
      { $match: { isAuthenticated: true } },
      { $group: { _id: null, total: { $sum: '$messageCount' } } }
    ]);

    const recentActivity = await ChatHistory.find({ isAuthenticated: true })
      .populate('user', 'username email')
      .sort({ lastActivity: -1 })
      .limit(10)
      .select('title topic messageCount lastActivity user');

    const popularTopics = await ChatHistory.aggregate([
      { $match: { isAuthenticated: true } },
      { $group: { _id: '$topic', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);

    res.json({
      success: true,
      stats: {
        users: {
          total: totalUsers,
          active: activeUsers,
          newToday: newUsersToday
        },
        chats: {
          total: totalChats,
          totalMessages: totalMessages[0]?.total || 0
        },
        popularTopics: popularTopics,
        recentActivity: recentActivity
      }
    });

  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch admin statistics'
    });
  }
});

module.exports = router;