const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const dotenv = require('dotenv');
const path = require('path');
const http = require('http');
const socketIO = require('socket.io');
const { Conversation, Message, UserStatus } = require('./model/message');
const cartRouter = require('./routes/cart');
const favoriteRouter = require('./routes/favorites');
const sponsoredProductRoutes = require('./routes/sponsoredProducts');
const enhancedProductFeedRoutes = require('./routes/enhancedProductFeed');
const searchRoutes = require('./routes/searchRoutes');
dotenv.config();

const { verifyCloudinaryConfig, testCloudinaryConnection } = require('./config/cloudinary');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});







/**
 * Broadcast user status to all relevant users
 */
async function broadcastUserStatus(userId, isOnline, lastSeen = new Date()) {
  try {
    console.log(`📡 Broadcasting status for ${userId}: ${isOnline ? 'ONLINE' : 'OFFLINE'}`);
    
    // Find conversations - handle both old and new schema
    const conversations = await Conversation.find({
      $or: [
        { participants: userId },
        { buyerId: userId },
        { sellerId: userId }
      ]
    }).populate('participants buyerId sellerId', '_id');

    const participantIds = new Set();
    
    conversations.forEach(conv => {
      // Add from participants array
      if (conv.participants && Array.isArray(conv.participants)) {
        conv.participants.forEach(participant => {
          if (participant && participant._id) {
            const participantId = participant._id.toString();
            if (participantId !== userId) {
              participantIds.add(participantId);
            }
          }
        });
      }
      
      // Add from buyerId
      if (conv.buyerId) {
        const buyerId = (conv.buyerId._id || conv.buyerId).toString();
        if (buyerId !== userId) {
          participantIds.add(buyerId);
        }
      }
      
      // Add from sellerId
      if (conv.sellerId) {
        const sellerId = (conv.sellerId._id || conv.sellerId).toString();
        if (sellerId !== userId) {
          participantIds.add(sellerId);
        }
      }
    });

    const statusPayload = {
      userId,
      isOnline,
      lastSeen: lastSeen.toISOString(),
      timestamp: new Date().toISOString(),
    };

    // Emit to each participant
    let emittedCount = 0;
    participantIds.forEach(participantId => {
      try {
        io.to(participantId).emit('user_status', statusPayload);
        emittedCount++;
      } catch (emitError) {
        console.error(`❌ Failed to emit to ${participantId}:`, emitError.message);
      }
    });

    console.log(`📡 Broadcasted status for ${userId}: ${isOnline ? 'ONLINE' : 'OFFLINE'} to ${emittedCount}/${participantIds.size} users`);
  } catch (error) {
    console.error('❌ Error broadcasting user status:', error);
  }
}

/**
 * Update user status in database
 */
async function updateUserStatus(userId, isOnline, socketId = null) {
  try {
    const updateData = {
      userId,
      isOnline,
      lastSeen: new Date(),
    };

    if (socketId) {
      updateData.socketId = socketId;
    }

    await UserStatus.findOneAndUpdate(
      { userId },
      updateData,
      { upsert: true, new: true }
    );

    console.log(`✅ Updated DB status for ${userId}: ${isOnline ? 'ONLINE' : 'OFFLINE'}`);
  } catch (error) {
    console.error('❌ Error updating user status:', error);
  }
}

/**
 * Handle user going online
 */
async function handleUserOnline(userId, socketId) {
  await updateUserStatus(userId, true, socketId);
  await broadcastUserStatus(userId, true);
}

/**
 * Handle user going offline
 */
async function handleUserOffline(userId) {
  const lastSeen = new Date();
  await updateUserStatus(userId, false, null);
  await broadcastUserStatus(userId, false, lastSeen);
}



async function sendCurrentOnlineUsersTo(newUserId) {
  try {
    // Find all conversations this user is part of
    const conversations = await Conversation.find({
      $or: [
        { participants: newUserId },
        { buyerId: newUserId },
        { sellerId: newUserId }
      ]
    }).populate('participants buyerId sellerId', '_id');

    // Get all other participants
    const participantIds = new Set();
    conversations.forEach(conv => {
      conv.participants?.forEach(p => {
        if (p._id.toString() !== newUserId) {
          participantIds.add(p._id.toString());
        }
      });
      if (conv.buyerId && conv.buyerId._id.toString() !== newUserId) {
        participantIds.add(conv.buyerId._id.toString());
      }
      if (conv.sellerId && conv.sellerId._id.toString() !== newUserId) {
        participantIds.add(conv.sellerId._id.toString());
      }
    });

    // Get their online statuses
    const statuses = await UserStatus.find({
      userId: { $in: Array.from(participantIds) }
    });

    // Send each status to the new user
    statuses.forEach(status => {
      io.to(newUserId).emit('user_status', {
        userId: status.userId.toString(),
        isOnline: status.isOnline,
        lastSeen: status.lastSeen.toISOString(),
        timestamp: new Date().toISOString(),
      });
    });

    console.log(`📤 Sent ${statuses.length} online statuses to ${newUserId}`);
  } catch (error) {
    console.error('❌ Error sending current online users:', error);
  }
}
// Consolidated Socket.IO connection handling

io.on('connection', (socket) => {
  console.log('🔌 User connected:', socket.id);

  const userId = socket.handshake.headers.userid || socket.handshake.query.userId;
  
  if (!userId) {
    console.error('❌ No userId provided in connection');
    socket.disconnect();
    return;
  }

  socket.userId = userId;

  // ============================================================================
  // JOIN EVENT - User becomes online
  // ============================================================================
  socket.on('join', async (incomingUserId) => {
    try {
      const userIdToUse = incomingUserId || userId;
      
      // Join user's personal room
      socket.join(userIdToUse);
      console.log(`✅ User ${userIdToUse} joined room`);

      // Set user as online - CRITICAL FIX
      await handleUserOnline(userIdToUse, socket.id);

      // 🆕 IMMEDIATELY send current online users to this user
      await sendCurrentOnlineUsersTo(userIdToUse);

    } catch (error) {
      console.error('❌ Join error:', error);
      socket.emit('error', { 
        action: 'join',
        error: error.message 
      });
    }
  });

  // ============================================================================
  // HEARTBEAT - Keep connection alive and update lastSeen
  // ============================================================================
  socket.on('heartbeat', async (data) => {
    try {
      const { userId: heartbeatUserId } = data;
      const userIdToUse = heartbeatUserId || userId;

      await UserStatus.findOneAndUpdate(
        { userId: userIdToUse },
        { 
          lastSeen: new Date(),
          socketId: socket.id,
          isOnline: true // 🆕 Ensure online status
        }
      );

      console.log(`💓 Heartbeat from ${userIdToUse}`);
    } catch (error) {
      console.error('❌ Heartbeat error:', error);
    }
  });

  // ============================================================================
  // MESSAGE ROUTING
  // ============================================================================
socket.on('send_message', async (data) => {
  try {
    const { 
      messageId, 
      conversationId, 
      senderId, 
      messageType, 
      content, 
      timestamp 
    } = data;

    console.log('📡 Message metadata received:', { messageId, conversationId });

    if (!messageId || !conversationId || !senderId || !messageType || !content) {
      socket.emit('message_error', { 
        error: 'Invalid message metadata',
        messageId 
      });
      return;
    }

    const conversation = await Conversation.findById(conversationId)
      .populate('participants');
      
    if (!conversation) {
      socket.emit('message_error', { 
        error: 'Conversation not found',
        messageId 
      });
      return;
    }

    if (!conversation.participants.some(p => p._id.toString() === senderId)) {
      socket.emit('message_error', { 
        error: 'Unauthorized sender',
        messageId 
      });
      return;
    }

    // ✅ Send ACK to sender
    socket.emit('message_sent', {
      messageId,
      conversationId,
      status: 'sent',
      timestamp: new Date().toISOString(),
    });

    // ✅ Route to other participants AND auto-emit delivered
    conversation.participants.forEach((participant) => {
      const participantId = participant._id.toString();
      
      if (participantId !== senderId) {
        // Send the new message
        io.to(participantId).emit('new_message', {
          messageId,
          conversationId,
          senderId,
          messageType,
          content,
          timestamp: timestamp || new Date().toISOString(),
          status: 'delivered',
        });
        
        // ✅ CRITICAL: Also emit delivered status back to sender
        io.to(senderId).emit('message_delivered', {
          messageId,
          conversationId,
          status: 'delivered',
          timestamp: new Date().toISOString(),
        });
      }
    });

    console.log(`✅ Message routed and delivered`);
    
  } catch (error) {
    console.error('❌ Message routing error:', error);
    socket.emit('message_error', { 
      error: error.message,
      messageId: data.messageId 
    });
  }
});

  // ============================================================================
  // TYPING INDICATOR
  // ============================================================================
  socket.on('typing', async (data) => {
    try {
      const { conversationId, userId: typingUserId, isTyping } = data;
      
      const conversation = await Conversation.findById(conversationId)
        .populate('participants');
        
      if (conversation) {
        conversation.participants.forEach((participant) => {
          if (participant._id.toString() !== typingUserId) {
            io.to(participant._id.toString()).emit('user_typing', {
              conversationId,
              userId: typingUserId,
              isTyping,
            });
          }
        });
      }
    } catch (error) {
      console.error('❌ Typing indicator error:', error);
    }
  });

  // ============================================================================
  // RECORDING INDICATOR
  // ============================================================================
  socket.on('recording_indicator', async (data) => {
    try {
      const { conversationId, isRecording } = data;
      
      const conversation = await Conversation.findById(conversationId)
        .populate('participants');
        
      if (conversation) {
        conversation.participants.forEach((participant) => {
          if (participant._id.toString() !== userId) {
            io.to(participant._id.toString()).emit('recording_indicator', {
              userId,
              conversationId,
              isRecording,
              timestamp: new Date().toISOString(),
            });
          }
        });
      }
    } catch (error) {
      console.error('❌ Recording indicator error:', error);
    }
  });

  // ============================================================================
  // MARK MESSAGES AS READ
  // ============================================================================
socket.on('mark_read', async (data) => {
  try {
    const { conversationId, userId: readUserId } = data;

    // Update message statuses
    await Message.updateMany(
      {
        conversationId,
        sender: { $ne: readUserId },
        status: { $ne: 'read' },
      },
      { status: 'read' }
    );

    // Update conversation unread count
    const conversation = await Conversation.findById(conversationId)
      .populate('participants');
      
    if (conversation) {
      conversation.unreadCounts.set(readUserId, 0);
      await conversation.save();

      // ✅ Notify ALL participants (including sender) about read status
      conversation.participants.forEach((participant) => {
        io.to(participant._id.toString()).emit('messages_read', { 
          conversationId,
          userId: readUserId,
          timestamp: new Date().toISOString(),
        });
      });
    }

    socket.emit('mark_read_success', { conversationId });
    
  } catch (error) {
    console.error('❌ Mark read error:', error);
    socket.emit('error', { 
      action: 'mark_read', 
      error: error.message 
    });
  }
});

  // ============================================================================
  // DELETE CONVERSATION
  // ============================================================================
  socket.on('delete_conversation', async (data) => {
    try {
      const { conversationId, userId: deletingUserId } = data;

      const conversation = await Conversation.findById(conversationId);
      if (conversation) {
        conversation.participants.forEach((participantId) => {
          if (participantId.toString() !== deletingUserId) {
            io.to(participantId.toString()).emit('conversation_deleted', {
              conversationId,
              userId: deletingUserId,
              timestamp: new Date().toISOString(),
            });
          }
        });
      }
    } catch (error) {
      console.error('❌ Delete conversation error:', error);
      socket.emit('error', { 
        action: 'delete_conversation',
        error: error.message 
      });
    }
  });

  // ============================================================================
  // DISCONNECT - User goes offline
  // ============================================================================
 socket.on('disconnect', async () => {
    console.log('🔌 User disconnected:', socket.id);
    
    try {
      if (userId) {
        await handleUserOffline(userId);
      }
    } catch (error) {
      console.error('❌ Disconnect error:', error);
    }
  });
});



// Helper function to get message preview text
function getMessagePreview(messageType) {
  switch (messageType) {
    case 'image':
      return '📷 Photo';
    case 'video':
      return '🎥 Video';
    case 'voice':
      return '🎵 Voice message';
    case 'document':
      return '📄 Document';
    default:
      return 'Message';
  }
}

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors({ origin: '*' }));

// Static file paths for all content
app.use('/image/products', express.static(path.join(__dirname, 'public/products')));
app.use('/image/category', express.static(path.join(__dirname, 'public/category')));
app.use('/image/poster', express.static(path.join(__dirname, 'public/posters')));
app.use('/image/messages', express.static(path.join(__dirname, 'public/messages/images')));
app.use('/videos/messages', express.static(path.join(__dirname, 'public/messages/videos')));
app.use('/voice/messages', express.static(path.join(__dirname, 'public/messages/voice')));
app.use('/documents/messages', express.static(path.join(__dirname, 'public/messages/documents')));

// MongoDB connection
const URL = process.env.MONGO_URL;
mongoose.connect(URL);
const db = mongoose.connection;
db.on('error', (error) => console.error('MongoDB connection error:', error));
db.once('open', () => console.log('Connected to sfm Database'));

// Routes
app.use('/api/feed', enhancedProductFeedRoutes);
app.use('/products', require('./routes/product_cloudinary'));
app.use('/api/favorites', require('./routes/favorites'));
app.use('/categories', require('./routes/category_cloudinary'));
app.use('/subCategories', require('./routes/subCategory'));
app.use('/brands', require('./routes/brand'));
app.use('/variantTypes', require('./routes/variantType'));
app.use('/variants', require('./routes/variant'));
app.use('/couponCodes', require('./routes/couponCode'));
app.use('/posters', require('./routes/poster_cloudinary'));
app.use('/users', require('./routes/user'));
app.use('/reviews', require('./routes/review'));
app.use('/messages', require('./routes/message_cloudinary'));
app.use('/analytics', require('./routes/analytics'));
app.use('/cart', require('./routes/cart'));
app.use('/favorite', require('./routes/favorites'));
app.use('/api/sponsored', sponsoredProductRoutes);
app.use('/bulk', require('./routes/bulkUpload'));
app.use('/api/search', searchRoutes);

// Example route
app.get('/', asyncHandler(async (req, res) => {
  res.json({ success: true, message: 'API working successfully', data: null });
}));

// Global error handler
app.use((error, req, res, next) => {
  console.error('Global error:', error);
  res.status(500).json({ success: false, message: error.message, data: null });
});

verifyCloudinaryConfig();
testCloudinaryConnection();

// Start server
const HOST = '0.0.0.0';
const PORT = process.env.PORT || 3000;
server.listen(PORT, HOST, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Static files served from:`);
  console.log(`- Images: ${path.join(__dirname, 'public/messages/images')}`);
  console.log(`- Videos: ${path.join(__dirname, 'public/messages/videos')}`);
  console.log(`- Voice: ${path.join(__dirname, 'public/messages/voice')}`);
  console.log(`- Documents: ${path.join(__dirname, 'public/messages/documents')}`);
});

// Export for use in other modules if needed
module.exports = { app, io };