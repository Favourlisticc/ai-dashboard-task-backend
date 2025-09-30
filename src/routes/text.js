const express = require('express');
const openaiService = require('../services/openaiService');
const ChatHistory = require('../models/ChatHistory');

const router = express.Router();

// Public chat endpoint (no authentication required)
router.post('/message', async (req, res) => {
  try {
    const { message, sessionId = `session_${Date.now()}` } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Message cannot be empty'
      });
    }

    // Save user message first (without user ID)
    await saveMessage(sessionId, message, 'user');

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
      await saveMessage(sessionId, outOfScopeResponse, 'assistant', true);
      
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
      await saveMessage(sessionId, response, 'assistant');

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
      await saveMessage(sessionId, errorResponse, 'assistant', false, true);
      
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

// Helper function to save messages (without user ID)
async function saveMessage(sessionId, content, sender, isOutOfScope = false, isError = false) {
  try {
    // Find existing chat session or create new one
    let chatSession = await ChatHistory.findOne({ 
      sessionId: sessionId 
    });

    if (!chatSession) {
      chatSession = new ChatHistory({
        sessionId: sessionId,
        isPremium: false,
        messages: [],
        isAuthenticated: false // Mark as non-authenticated session
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
    
    console.log(`Message saved for session ${sessionId}: ${sender} message`);
    
  } catch (error) {
    console.error('Error saving message to database:', error);
    // Don't throw error to avoid breaking the chat flow
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

// Health check endpoint
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