const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  content: {
    type: String,
    required: [true, 'Message content is required'],
    trim: true,
    maxlength: [5000, 'Message content cannot exceed 5000 characters']
  },
  sender: {
    type: String,
    enum: ['user', 'assistant'],
    required: true  // Fixed: added required for sender
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  metadata: {
    isOutOfScope: {
      type: Boolean,
      default: false
    },
    isError: {
      type: Boolean,
      default: false
    },
    topic: {
      type: String,
      enum: ['chelsea', 'frontend', 'general', 'mixed', 'assistant'],
      default: 'general'
    }
  }
});

const chatHistorySchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
    required: false  // Made optional for non-authenticated chats
  },
  sessionId: {
    type: String,
    required: [true, 'Session ID is required'],
    index: true
  },
  title: {
    type: String,
    default: 'New Chat',
    trim: true,
    maxlength: [100, 'Chat title cannot exceed 100 characters']
  },
  messages: [messageSchema],
  messageCount: {
    type: Number,
    default: 0,
    min: 0
  },
  isPremium: {
    type: Boolean,
    default: false
  },
  topic: {
    type: String,
    enum: ['chelsea', 'frontend', 'general', 'mixed'],
    default: 'general'
  },
  lastActivity: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // Add a field to track if it's an authenticated session
  isAuthenticated: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Indexes
chatHistorySchema.index({ user: 1, createdAt: -1 });
chatHistorySchema.index({ sessionId: 1 });
chatHistorySchema.index({ lastActivity: -1 });
chatHistorySchema.index({ topic: 1 });
chatHistorySchema.index({ 'messages.metadata.isOutOfScope': 1 });
chatHistorySchema.index({ isAuthenticated: 1 }); // New index for auth status

// Pre-save middleware
chatHistorySchema.pre('save', function(next) {
  // Safely handle messages array
  this.messageCount = Array.isArray(this.messages) ? this.messages.length : 0;
  this.lastActivity = new Date();
  
  // Set authentication status based on user field
  this.isAuthenticated = !!this.user;
  
  // Auto-generate title from first user message if not set
  if (this.isNew && Array.isArray(this.messages) && this.messages.length > 0) {
    const firstUserMessage = this.messages.find(msg => msg.sender === 'user');
    if (firstUserMessage && !this.title) {
      this.title = firstUserMessage.content.substring(0, 50) + 
                  (firstUserMessage.content.length > 50 ? '...' : '');
    }
  }
  
  // Determine overall topic based on all messages
  if (Array.isArray(this.messages) && this.messages.length > 0) {
    const allContent = this.messages.map(msg => msg.content).join(' ').toLowerCase();
    
    const chelseaTerms = ['chelsea', 'premier league', 'stamford bridge', 'pochettino'];
    const frontendTerms = ['react', 'javascript', 'tailwind', 'css', 'html', 'gsap'];
    
    const hasChelsea = chelseaTerms.some(term => allContent.includes(term));
    const hasFrontend = frontendTerms.some(term => allContent.includes(term));
    
    if (hasChelsea && hasFrontend) {
      this.topic = 'mixed';
    } else if (hasChelsea) {
      this.topic = 'chelsea';
    } else if (hasFrontend) {
      this.topic = 'frontend';
    } else {
      this.topic = 'general';
    }
  }
  
  next();
});

// Instance method to add a new message with metadata
chatHistorySchema.methods.addMessage = function(content, sender, metadata = {}) {
  const messageData = {
    content: content,
    sender: sender,
    timestamp: new Date(),
    metadata: {
      isOutOfScope: metadata.isOutOfScope || false,
      isError: metadata.isError || false,
      topic: metadata.topic || 'general'
    }
  };
  
  this.messages.push(messageData);
  return this.save();
};

// Static method to get chats by session ID (for non-authenticated users)
chatHistorySchema.statics.findBySessionId = function(sessionId) {
  return this.findOne({ sessionId: sessionId });
};

// Static method to get authenticated user's chat history
chatHistorySchema.statics.findByUserId = function(userId, limit = 50) {
  return this.find({ user: userId, isAuthenticated: true })
    .sort({ lastActivity: -1 })
    .limit(limit)
    .select('title messages.messageCount topic lastActivity createdAt')
    .populate('user', 'username email profile.firstName');
};

// Static method to get recent chats for dashboard (only authenticated)
chatHistorySchema.statics.getRecentChats = function(userId, days = 7) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  
  return this.aggregate([
    {
      $match: {
        user: mongoose.Types.ObjectId(userId),
        isAuthenticated: true,
        lastActivity: { $gte: date }
      }
    },
    {
      $project: {
        title: 1,
        messageCount: 1,
        topic: 1,
        lastActivity: 1,
        lastMessage: { $arrayElemAt: ['$messages', -1] }
      }
    },
    {
      $sort: { lastActivity: -1 }
    },
    {
      $limit: 20
    }
  ]);
};

// Virtual for preview (last message snippet)
chatHistorySchema.virtual('preview').get(function() {
  if (!this.messages || !Array.isArray(this.messages) || this.messages.length === 0) {
    return 'No messages yet';
  }
  const lastMessage = this.messages[this.messages.length - 1];
  if (!lastMessage || !lastMessage.content) {
    return 'No message content';
  }
  return lastMessage.content.substring(0, 100) + 
         (lastMessage.content.length > 100 ? '...' : '');
});

// Ensure virtual fields are serialized
chatHistorySchema.set('toJSON', { virtuals: true });
chatHistorySchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('ChatHistory', chatHistorySchema);