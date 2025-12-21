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

const { initializeFirebase } = require('./config/firebase');
const NotificationScheduler = require('./services/notificationScheduler');



try {
  initializeFirebase();
  console.log('✅ Firebase Admin SDK initialized');
} catch (error) {
  console.error('⚠️ Firebase initialization failed:', error.message);
  console.error('Push notifications will not work. Check your firebase-service-account.json file.');
}



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

// Track which users are actively viewing which conversations
const activeChats = new Map(); // { userId: conversationId }

/**
 * Check if a user is actively viewing a specific conversation
 */
function isUserInActiveChat(userId, conversationId) {
  const activeConv = activeChats.get(userId);
  const isActive = activeConv === conversationId;
  console.log(`🔍 User ${userId} active in ${conversationId}? ${isActive} (current: ${activeConv})`);
  return isActive;
}

/**
 * Mark messages as read ONLY if user is actively viewing the chat
 */
async function markMessagesAsReadIfActive(conversationId, userId) {
  try {
    // ✅ CRITICAL: Only mark as read if user is in active chat
    if (!isUserInActiveChat(userId, conversationId)) {
      console.log(`⏭️ User ${userId} NOT in active chat ${conversationId}, skipping mark as read`);
      return false;
    }

    console.log(`📖 Marking messages as read for ${userId} in ${conversationId}`);

    // Update message statuses to 'read'
    const result = await Message.updateMany(
      {
        conversationId,
        sender: { $ne: userId },
        status: { $in: ['sent', 'delivered'] } // Only update sent/delivered messages
      },
      { status: 'read' }
    );

    console.log(`✅ Marked ${result.modifiedCount} messages as read`);

    // Update conversation unread count to 0
    const conversation = await Conversation.findById(conversationId)
      .populate('participants buyerId sellerId');
      
    if (conversation) {
      const userIdString = userId.toString();
      if (userIdString && userIdString.trim() !== '') {
        conversation.unreadCounts.set(userIdString, 0);
        await conversation.save();
        console.log(`✅ Cleared unread count for ${userId}`);
      }

      // ✅ Notify ALL participants about read status
      conversation.participants.forEach((participant) => {
        io.to(participant._id.toString()).emit('messages_read', { 
          conversationId,
          userId: userId,
          timestamp: new Date().toISOString(),
        });
      });
    }

    return true;

  } catch (error) {
    console.error('❌ Error marking messages as read:', error);
    return false;
  }
}

// ============================================================================
// SOCKET.IO CONNECTION HANDLING
// ============================================================================

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
      
      socket.join(userIdToUse);
      console.log(`✅ User ${userIdToUse} joined room`);

      await handleUserOnline(userIdToUse, socket.id);
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
  // 🆕 ENTER CHAT - User opens a specific conversation
  // ============================================================================
  socket.on('enter_chat', async (data) => {
    try {
      const { conversationId, userId: enterUserId } = data;
      const userIdToUse = enterUserId || userId;

      console.log(`📂 User ${userIdToUse} ENTERED chat ${conversationId}`);

      // Store active chat session
      activeChats.set(userIdToUse, conversationId);

      // Join conversation-specific room
      socket.join(`conversation:${conversationId}`);

      // ✅ IMMEDIATELY mark existing messages as read
      await markMessagesAsReadIfActive(conversationId, userIdToUse);

      // ✅ Notify sender that user entered (ACK)
      socket.emit('enter_chat_ack', {
        conversationId,
        userId: userIdToUse,
        timestamp: new Date().toISOString()
      });

      console.log(`✅ User ${userIdToUse} now actively viewing ${conversationId}`);

    } catch (error) {
      console.error('❌ Enter chat error:', error);
      socket.emit('error', { 
        action: 'enter_chat',
        error: error.message 
      });
    }
  });

  // ============================================================================
  // 🆕 LEAVE CHAT - User exits a specific conversation
  // ============================================================================
  socket.on('leave_chat', async (data) => {
    try {
      const { conversationId, userId: leaveUserId } = data;
      const userIdToUse = leaveUserId || userId;

      console.log(`📂 User ${userIdToUse} LEFT chat ${conversationId}`);

      // Remove active chat session
      const currentActive = activeChats.get(userIdToUse);
      if (currentActive === conversationId) {
        activeChats.delete(userIdToUse);
        console.log(`✅ Cleared active chat for ${userIdToUse}`);
      }

      // Leave conversation-specific room
      socket.leave(`conversation:${conversationId}`);

      // ✅ Notify sender that user left (ACK)
      socket.emit('leave_chat_ack', {
        conversationId,
        userId: userIdToUse,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Leave chat error:', error);
    }
  });

  // ============================================================================
  // MESSAGE ROUTING with INSTANT READ DETECTION
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
        .populate('participants buyerId sellerId');
        
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

      // ✅ Route to other participants
      conversation.participants.forEach((participant) => {
        const participantId = participant._id.toString();
        
        if (participantId !== senderId) {
          // 🔍 Check if recipient is actively viewing this chat
          const isInActiveChat = isUserInActiveChat(participantId, conversationId);
          
          // Set status based on active chat state
          const messageStatus = isInActiveChat ? 'read' : 'delivered';
          
          console.log(`📬 Sending to ${participantId}: status=${messageStatus}, inActiveChat=${isInActiveChat}`);

          // Send message with correct status
          io.to(participantId).emit('new_message', {
            messageId,
            conversationId,
            senderId,
            messageType,
            content,
            timestamp: timestamp || new Date().toISOString(),
            status: messageStatus,
          });
          
          // ✅ Emit delivered status back to sender
          io.to(senderId).emit('message_delivered', {
            messageId,
            conversationId,
            status: 'delivered',
            timestamp: new Date().toISOString(),
          });

          // ✅ If recipient is in active chat, INSTANTLY mark as read
          if (isInActiveChat) {
            console.log(`👀 Recipient ${participantId} is viewing chat - marking as read INSTANTLY`);
            
            // Mark message as read in database
            Message.findByIdAndUpdate(messageId, { status: 'read' })
              .catch(err => console.error('Failed to update message status:', err));

            // Clear unread count for recipient
            const recipientIdStr = participantId.toString();
            if (conversation.unreadCounts && recipientIdStr) {
              conversation.unreadCounts.set(recipientIdStr, 0);
              conversation.save().catch(err => console.error('Failed to save conversation:', err));
            }

            // ✅ Emit read status back to sender INSTANTLY
            io.to(senderId).emit('message_read', {
              messageId,
              conversationId,
              status: 'read',
              timestamp: new Date().toISOString(),
            });

            // ✅ Also emit general messages_read event
            conversation.participants.forEach((p) => {
              io.to(p._id.toString()).emit('messages_read', { 
                conversationId,
                userId: participantId,
                timestamp: new Date().toISOString(),
              });
            });
          }
        }
      });

      console.log(`✅ Message routed successfully`);
      
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
  // MANUAL MARK AS READ (legacy support)
  // ============================================================================
  socket.on('mark_read', async (data) => {
    try {
      const { conversationId, userId: readUserId } = data;
      await markMessagesAsReadIfActive(conversationId, readUserId);
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
  // HEARTBEAT
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
          isOnline: true
        }
      );

      console.log(`💓 Heartbeat from ${userIdToUse}`);
    } catch (error) {
      console.error('❌ Heartbeat error:', error);
    }
  });

  // ============================================================================
  // DISCONNECT - User goes offline
  // ============================================================================
  socket.on('disconnect', async () => {
    console.log('🔌 User disconnected:', socket.id);
    
    try {
      if (userId) {
        // Clear active chat session
        activeChats.delete(userId);
        console.log(`🗑️ Cleared active chat for ${userId}`);

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
app.use('/notifications', require('./routes/notifications'));


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

  try {
    NotificationScheduler.start();
    console.log('✅ Notification scheduler started');
  } catch (error) {
    console.error('⚠️ Failed to start notification scheduler:', error.message);
  }
});

// Export for use in other modules if needed
module.exports = { app, io, isUserInActiveChat };