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

// Consolidated Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Store user ID from handshake
  const userId = socket.handshake.headers.userid || socket.handshake.query.userId;
  socket.userId = userId;

  // Join user to their personal room
  socket.join(userId);
  console.log(`User ${userId} joined room`);

  // Broadcast user online status
  socket.broadcast.emit('user_online', {
    userId: userId,
    timestamp: new Date().toISOString(),
  });

  // Handle join event
  socket.on('join', async (userId) => {
    socket.join(userId);
    console.log(`User ${userId} joined room`);

    // Update user status to online
    try {
      await UserStatus.findOneAndUpdate(
        { userId },
        { 
          userId, 
          isOnline: true, 
          lastSeen: new Date(),
          socketId: socket.id 
        },
        { upsert: true, new: true }
      );

      // Broadcast status to relevant users
      socket.broadcast.emit('user_status', {
        userId,
        isOnline: true,
        lastSeen: new Date().toISOString(),
      });
    } catch (error) {
      console.error('User join error:', error);
      socket.emit('error', { error: error.message });
    }
  });

  // Handle message metadata routing (no message creation)
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

      console.log('📡 Socket metadata received:', { messageId, conversationId, messageType });

      // Validate required fields
      if (!messageId || !conversationId || !senderId || !messageType || !content) {
        console.error('❌ Invalid socket metadata:', data);
        socket.emit('message_error', { 
          error: 'Invalid message metadata',
          messageId 
        });
        return;
      }

      // Verify conversation exists and sender is participant
      const conversation = await Conversation.findById(conversationId).populate('participants');
      if (!conversation) {
        console.error('❌ Conversation not found:', conversationId);
        socket.emit('message_error', { 
          error: 'Conversation not found',
          messageId 
        });
        return;
      }

      if (!conversation.participants.some(p => p._id.toString() === senderId)) {
        console.error('❌ Sender not in conversation:', { senderId, conversationId });
        socket.emit('message_error', { 
          error: 'Unauthorized sender',
          messageId 
        });
        return;
      }

      // Route metadata to all participants (including sender for ACK)
      let deliveredCount = 0;
      conversation.participants.forEach((participant) => {
        const participantId = participant._id.toString();
        
        if (participantId === senderId) {
          // Send ACK to sender
          socket.emit('message_sent', {
            messageId,
            conversationId,
            status: 'sent',
            timestamp: new Date().toISOString(),
          });
          console.log(`✅ ACK sent to sender: ${senderId}`);
        } else {
          // Send metadata to other participants
          io.to(participantId).emit('new_message', {
            messageId,
            conversationId,
            senderId,
            messageType,
            content,
            timestamp: timestamp || new Date().toISOString(),
            status: 'delivered',
          });
          deliveredCount++;
          console.log(`📤 Metadata sent to participant: ${participantId}`);
        }
      });

      console.log(`✅ Message metadata routed to ${deliveredCount} recipients`);
      
    } catch (error) {
      console.error('❌ Socket metadata routing error:', error);
      socket.emit('message_error', { 
        error: error.message,
        messageId: data.messageId 
      });
    }
  });

  // Handle typing indicators
  socket.on('typing', async (data) => {
    try {
      const { conversationId, userId, isTyping } = data;
      
      console.log(`👤 ${userId} ${isTyping ? 'started' : 'stopped'} typing in ${conversationId}`);
      
      // Get conversation to find other participants
      const conversation = await Conversation.findById(conversationId).populate('participants');
      if (conversation) {
        conversation.participants.forEach((participant) => {
          if (participant._id.toString() !== userId) {
            io.to(participant._id.toString()).emit('user_typing', {
              conversationId,
              userId,
              isTyping,
            });
          }
        });
      }
    } catch (error) {
      console.error('Typing indicator error:', error);
      socket.emit('error', { error: error.message });
    }
  });

  // Handle recording indicator
  socket.on('recording_indicator', (data) => {
    const { conversationId, isRecording } = data;
    
    // Broadcast to conversation participants
    socket.to(conversationId).emit('recording_indicator', {
      userId: socket.userId,
      conversationId,
      isRecording,
      timestamp: new Date().toISOString(),
    });
    console.log(`🎤 ${socket.userId} ${isRecording ? 'started' : 'stopped'} recording in ${conversationId}`);
  });

  // Handle mark messages as read
  socket.on('mark_read', async (data) => {
    try {
      const { conversationId, userId } = data;

      console.log(`👀 User ${userId} marking messages as read in ${conversationId}`);

      // Update message statuses in database
      await Message.updateMany(
        {
          conversationId,
          sender: { $ne: userId },
          status: { $ne: 'read' },
        },
        { status: 'read' }
      );

      // Update conversation unread count
      const conversation = await Conversation.findById(conversationId);
      if (conversation) {
        conversation.unreadCounts.set(userId, 0);
        await conversation.save();
      }

      // Notify other participants
      const conv = await Conversation.findById(conversationId).populate('participants');
      conv.participants.forEach((participant) => {
        if (participant._id.toString() !== userId) {
          io.to(participant._id.toString()).emit('messages_read', { 
            conversationId,
            userId,
          });
        }
      });

      // Send success confirmation to the user
      socket.emit('mark_read_success', { conversationId });
      
    } catch (error) {
      console.error('Mark read error:', error);
      socket.emit('error', { 
        action: 'mark_read', 
        error: error.message 
      });
    }
  });

  // Handle user online status
  socket.on('user_online', async (data) => {
    try {
      const { userId } = data;
      await UserStatus.findOneAndUpdate(
        { userId },
        { 
          userId,
          isOnline: true, 
          lastSeen: new Date(),
          socketId: socket.id 
        },
        { upsert: true, new: true }
      );
      
      // Broadcast status to relevant users
      socket.broadcast.emit('user_status', {
        userId,
        isOnline: true,
        lastSeen: new Date().toISOString(),
      });
    } catch (error) {
      console.error('User online error:', error);
      socket.emit('error', { error: error.message });
    }
  });

  // Handle user offline status
  socket.on('user_offline', async (data) => {
    try {
      const { userId } = data;
      await UserStatus.findOneAndUpdate(
        { userId },
        { 
          isOnline: false, 
          lastSeen: new Date() 
        }
      );
      
      // Broadcast status to relevant users
      socket.broadcast.emit('user_status', {
        userId,
        isOnline: false,
        lastSeen: new Date().toISOString(),
      });
    } catch (error) {
      console.error('User offline error:', error);
      socket.emit('error', { error: error.message });
    }
  });

  // Handle heartbeat
  socket.on('heartbeat', async (data) => {
    try {
      const { userId } = data;
      await UserStatus.findOneAndUpdate(
        { userId },
        { 
          lastSeen: new Date(),
          socketId: socket.id 
        }
      );
      console.log(`💓 Heartbeat received from user: ${userId}`);
    } catch (error) {
      console.error('Heartbeat error:', error);
    }
  });

  // Handle user disconnect
  socket.on('disconnect', async () => {
    console.log('User disconnected:', socket.id);
    
    // Update user status to offline
    try {
      await UserStatus.findOneAndUpdate(
        { socketId: socket.id },
        { 
          isOnline: false, 
          lastSeen: new Date() 
        }
      );

      // Broadcast user offline status with last seen
      socket.broadcast.emit('user_offline', {
        userId: socket.userId,
        lastSeen: new Date().toISOString(),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Disconnect error:', error);
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