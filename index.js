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

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // User joins their room
  socket.on('join', async (userId) => {
    socket.join(userId);
    console.log(`User ${userId} joined room`);
    
    // Update user status to online
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
  });

  // Handle real-time message sending
  socket.on('send_message', async (data) => {
    try {
      const { conversationId, senderId, messageType, content } = data;

      // Create and save message
      const message = new Message({
        conversationId,
        sender: senderId,
        messageType,
        content,
        status: 'sent'
      });

      await message.save();
      await message.populate('sender', 'fullName');

      // Update conversation
      const conversation = await Conversation.findByIdAndUpdate(
        conversationId,
        {
          lastMessage: {
            text: content.text || (messageType === 'image' ? 'Image' : 'Voice message'),
            sender: senderId,
            timestamp: new Date(),
            messageType
          },
          updatedAt: new Date(),
        },
        { new: true }
      ).populate('participants');

      // Update unread counts
      conversation.participants.forEach((participant) => {
        if (participant._id.toString() !== senderId) {
          const currentCount = conversation.unreadCounts.get(participant._id.toString()) || 0;
          conversation.unreadCounts.set(participant._id.toString(), currentCount + 1);
        }
      });
      await conversation.save();

      // Emit to other participants
      conversation.participants.forEach((participant) => {
        if (participant._id.toString() !== senderId) {
          io.to(participant._id.toString()).emit('new_message', {
            message,
            conversationId,
          });
        }
      });

      // Confirm to sender
      socket.emit('message_sent', { message });
      
    } catch (error) {
      console.error('Send message error:', error);
      socket.emit('message_error', { error: error.message });
    }
  });

  // Handle mark messages as read
  socket.on('mark_read', async (data) => {
    try {
      const { conversationId, userId } = data;

      // Update message statuses
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
          io.to(participant._id.toString()).emit('messages_read', { conversationId });
        }
      });
      
    } catch (error) {
      console.error('Mark read error:', error);
      socket.emit('message_error', { error: error.message });
    }
  });

  // Handle user disconnect
  socket.on('disconnect', async () => {
    console.log('User disconnected:', socket.id);
    
    // Update user status to offline
    await UserStatus.findOneAndUpdate(
      { socketId: socket.id },
      { 
        isOnline: false, 
        lastSeen: new Date() 
      }
    );
  });
});

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors({ origin: '*' }));


// Static file paths
app.use('/image/products', express.static(path.join(__dirname, 'public/products')));
app.use('/image/category', express.static(path.join(__dirname, 'public/category')));
app.use('/image/poster', express.static(path.join(__dirname, 'public/posters')));
app.use('/image/messages', express.static(path.join(__dirname, 'public/messages')));

// MongoDB connection
const URL = process.env.MONGO_URL;
mongoose.connect(URL);
const db = mongoose.connection;
db.on('error', (error) => console.error('MongoDB connection error:', error));
db.once('open', () => console.log('Connected to sfm Database'));

// Routes
app.use('/categories', require('./routes/category'));
app.use('/subCategories', require('./routes/subCategory'));
app.use('/brands', require('./routes/brand'));
app.use('/variantTypes', require('./routes/variantType'));
app.use('/variants', require('./routes/variant'));
app.use('/products', require('./routes/product'));
app.use('/couponCodes', require('./routes/couponCode'));
app.use('/posters', require('./routes/poster'));
app.use('/users', require('./routes/user'));
app.use('/orders', require('./routes/order'));
app.use('/payment', require('./routes/payment'));
app.use('/notification', require('./routes/notification'));
app.use('/reviews', require('./routes/review'));
app.use('/messages', require('./routes/messages')); // New message routes
app.use('/analytics', require('./routes/analytics'));
// Example route
app.get('/', asyncHandler(async (req, res) => {
  res.json({ success: true, message: 'API working successfully', data: null });
}));

// Global error handler
app.use((error, req, res, next) => {
  res.status(500).json({ success: false, message: error.message, data: null });
});

// Start server
const HOST = '0.0.0.0';
const PORT = process.env.PORT || 3000;
server.listen(PORT, HOST, () => {
  console.log(`Server running on port ${PORT}`);
});

// Export for use in other modules if needed
module.exports = { app, io };