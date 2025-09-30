const express = require('express');
const openaiService = require('../services/openaiService');
const ChatHistory = require('../models/ChatHistory');
const auth = require('../middleware/auth');
const mongoose = require('mongoose');
const User = require('../models/users');

const router = express.Router();

// Protected chat endpoint
router.post('/message', auth, async (req, res) => {
  try {
    const { message, sessionId = `session_${Date.now()}` } = req.body;
    const userId = req.user._id;
    
    if (!message || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Message cannot be empty'
      });
    }

    // Save user message first (regardless of topic)
    await saveMessage(userId, sessionId, message, 'user');

    // Check if message is within specialization
    const lowerMessage = message.toLowerCase();
    
    // Check for Chelsea-related terms
    const chelseaTerms = ['chelsea', 'premier league', 'stamford bridge', 'pochettino', 
                         'player', 'match', 'transfer', 'goal', 'league', 'football', 
                         'soccer', 'blues', 'cfc', 'mauricio', 'enzo', 'palmer', 'caicedo'];
    const isChelseaRelated = chelseaTerms.some(term => lowerMessage.includes(term));
    
    // Check for frontend-related terms
    const frontendTerms = ['react', 'javascript', 'tailwind', 'css', 'html', 'gsap', 
                          'frontend', 'web development', 'programming', 'code', 
                          'component', 'hook', 'state', 'props', 'animation', 'style'];
    const isFrontendRelated = frontendTerms.some(term => lowerMessage.includes(term));

    // If not related to either topic, respond politely
    if (!isChelseaRelated && !isFrontendRelated) {
      const outOfScopeResponse = "I specialize exclusively in Chelsea FC and frontend development topics. Please ask me about:\n\n• Chelsea FC: matches, players, transfers, history\n• Frontend development: React, JavaScript, Tailwind CSS, GSAP\n\nI'd be happy to help with questions in these areas!";
      
      // Save the out-of-scope response
      await saveMessage(userId, sessionId, outOfScopeResponse, 'assistant', true);
      
      return res.json({
        success: true,
        response: outOfScopeResponse,
        isOutOfScope: true,
        sessionId: sessionId
      });
    }

    let response;
    
    try {
      // Use specialized methods based on question type
      if (isChelseaRelated) {
        response = await openaiService.answerChelseaQuestion(message);
      } else if (isFrontendRelated) {
        response = await openaiService.answerFrontendQuestion(message);
      } else {
        response = await openaiService.generateResponse(message);
      }

      // Save AI response
      await saveMessage(userId, sessionId, response, 'assistant');

      res.json({
        success: true,
        response: response,
        isOutOfScope: false,
        sessionId: sessionId,
        timestamp: new Date().toISOString()
      });

    } catch (openaiError) {
      console.error('OpenAI API error:', openaiError);
      
      const errorResponse = "I apologize, but I'm currently unable to process your request. This might be due to high demand or temporary service issues. Please try again in a few moments.";
      
      // Save error response
      await saveMessage(userId, sessionId, errorResponse, 'assistant', false, true);
      
      res.status(500).json({
        success: false,
        error: errorResponse
      });
    }

  } catch (error) {
    console.error('Chat route error:', error);
    
    res.status(500).json({
      success: false,
      error: 'An unexpected error occurred. Please try again.'
    });
  }
});

// Helper function to save messages
async function saveMessage(userId, sessionId, content, sender, isOutOfScope = false, isError = false) {
  try {
    // Find existing chat session or create new one
    let chatSession = await ChatHistory.findOne({ 
      user: userId, 
      sessionId: sessionId 
    });

    if (!chatSession) {
      chatSession = new ChatHistory({
        user: userId,
        sessionId: sessionId,
        isPremium: false,
        messages: [],
        isAuthenticated: true
      });
    }

    // Add metadata to the message
    const messageData = {
      content: content,
      sender: sender,
      timestamp: new Date(),
      metadata: {
        isOutOfScope: isOutOfScope,
        isError: isError,
        topic: getMessageTopic(content, sender)
      }
    };

    chatSession.messages.push(messageData);
    await chatSession.save();
    
    console.log(`Message saved for user ${userId}: ${sender} message`);
    
  } catch (error) {
    console.error('Error saving message to database:', error);
  }
}

// Helper function to determine message topic
function getMessageTopic(content, sender) {
  if (sender === 'user') {
    const lowerContent = content.toLowerCase();
    
    const chelseaTerms = ['chelsea', 'premier league', 'stamford bridge', 'pochettino'];
    const frontendTerms = ['react', 'javascript', 'tailwind', 'css', 'html', 'gsap'];
    
    const hasChelsea = chelseaTerms.some(term => lowerContent.includes(term));
    const hasFrontend = frontendTerms.some(term => lowerContent.includes(term));
    
    if (hasChelsea && hasFrontend) return 'mixed';
    if (hasChelsea) return 'chelsea';
    if (hasFrontend) return 'frontend';
    return 'general';
  }
  return 'assistant';
}

// Get user's chat history
// Get user's chat history - FIXED VERSION
router.get('/history', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const { limit = 20, page = 1 } = req.query;

    const chats = await ChatHistory.find({ user: userId, isAuthenticated: true })
      .sort({ lastActivity: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .select('title messageCount topic lastActivity createdAt sessionId messages') // Added messages to be safe
      .lean(); // Use lean() to get plain objects

    const totalChats = await ChatHistory.countDocuments({ user: userId, isAuthenticated: true });

    // Manually add preview to each chat to avoid virtual field issues
    const chatsWithPreview = chats.map(chat => ({
      ...chat,
      preview: chat.messages && chat.messages.length > 0 
        ? (chat.messages[chat.messages.length - 1].content.substring(0, 100) + 
           (chat.messages[chat.messages.length - 1].content.length > 100 ? '...' : ''))
        : 'No messages yet'
    }));

    res.json({
      success: true,
      chats: chatsWithPreview,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalChats,
        pages: Math.ceil(totalChats / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch chat history'
    });
  }
});

// Get specific chat session with messages
router.get('/history/:sessionId', auth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user._id;

    const chat = await ChatHistory.findOne({ 
      user: userId, 
      sessionId: sessionId 
    });

    if (!chat) {
      return res.status(404).json({
        success: false,
        error: 'Chat session not found'
      });
    }

    res.json({
      success: true,
      chat: {
        sessionId: chat.sessionId,
        title: chat.title,
        topic: chat.topic,
        messageCount: chat.messageCount,
        createdAt: chat.createdAt,
        lastActivity: chat.lastActivity,
        messages: chat.messages.map(msg => ({
          content: msg.content,
          sender: msg.sender,
          timestamp: msg.timestamp,
          metadata: msg.metadata
        }))
      }
    });

  } catch (error) {
    console.error('Get chat error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch chat session'
    });
  }
});

// Delete chat session
router.delete('/history/:sessionId', auth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user._id;

    const result = await ChatHistory.findOneAndDelete({ 
      user: userId, 
      sessionId: sessionId 
    });

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'Chat session not found'
      });
    }

    res.json({
      success: true,
      message: 'Chat session deleted successfully'
    });

  } catch (error) {
    console.error('Delete chat error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete chat session'
    });
  }
});

// Get chat statistics
router.get('/stats', auth, async (req, res) => {
  try {
    const userId = req.user._id;

    // Basic stats
    const totalChats = await ChatHistory.countDocuments({ user: userId, isAuthenticated: true });
    const totalMessages = await ChatHistory.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(userId), isAuthenticated: true } },
      { $group: { _id: null, total: { $sum: '$messageCount' } } }
    ]);

    const topicStats = await ChatHistory.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(userId), isAuthenticated: true } },
      { $group: { _id: '$topic', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    const recentActivity = await ChatHistory.find({ user: userId, isAuthenticated: true })
      .sort({ lastActivity: -1 })
      .limit(5)
      .select('title lastActivity topic messageCount');

    const stats = {
      totalChats: totalChats,
      totalMessages: totalMessages[0]?.total || 0,
      avgMessagesPerChat: totalChats > 0 ? Math.round((totalMessages[0]?.total || 0) / totalChats) : 0,
      mostActiveTopic: topicStats[0]?._id || 'general',
      topicDistribution: topicStats
    };

    res.json({
      success: true,
      stats: stats,
      recentActivity: recentActivity
    });

  } catch (error) {
    console.log('Get stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch chat statistics'
    });
  }
});

// Health check endpoint for OpenAI API
router.get('/health', async (req, res) => {
  try {
    const testResponse = await openaiService.generateResponse('Hello, are you working?');
    
    res.json({
      success: true,
      status: 'OpenAI API is connected and working',
      response: testResponse.substring(0, 100) + '...'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'OpenAI API connection failed: ' + error.message
    });
  }
});

module.exports = router;