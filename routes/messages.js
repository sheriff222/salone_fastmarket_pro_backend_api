const express = require('express');
const asyncHandler = require('express-async-handler');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { Conversation, Message, UserStatus } = require('../model/message');
const User = require('../model/user');
const Product = require('../model/product');
const baseUrl = process.env.BASE_URL  ;

// Multer setup for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        if (file.fieldname === 'image') {
            cb(null, 'public/messages/images/');
        } else if (file.fieldname === 'voice') {
            cb(null, 'public/messages/voice/');
        }
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: function (req, file, cb) {
        if (file.fieldname === 'image') {
            if (file.mimetype.startsWith('image/')) {
                cb(null, true);
            } else {
                cb(new Error('Only image files are allowed'), false);
            }
        } else if (file.fieldname === 'voice') {
            if (file.mimetype.startsWith('audio/')) {
                cb(null, true);
            } else {
                cb(new Error('Only audio files are allowed'), false);
            }
        }
    }
});

// Get or create conversation
router.post('/conversations', asyncHandler(async (req, res) => {
    const { buyerId, sellerId, productId } = req.body;

    if (!buyerId || !sellerId) {
        return res.status(400).json({ success: false, message: "Both buyerId and sellerId are required." });
    }

    // Check if conversation already exists
    let conversation = await Conversation.findOne({
        participants: { $all: [buyerId, sellerId] },
        ...(productId && { productId })
    }).populate('participants', 'fullName phoneNumber accountType')
      .populate('productId', 'name images sellerId');

    if (!conversation) {
        // Create new conversation
        conversation = new Conversation({
            participants: [buyerId, sellerId],
            ...(productId && { productId }),
            unreadCounts: new Map([[buyerId, 0], [sellerId, 0]])
        });
        await conversation.save();
        
        // Populate after save
        conversation = await Conversation.findById(conversation._id)
            .populate('participants', 'fullName phoneNumber accountType')
            .populate('productId', 'name images sellerId');
    }

    res.json({ success: true, message: "Conversation retrieved successfully.", data: conversation });
}));

// Get user's conversations
router.get('/conversations/:userId', asyncHandler(async (req, res) => {
    const { userId } = req.params;

    const conversations = await Conversation.find({
        participants: userId
    })
    .populate('participants', 'fullName phoneNumber accountType')
    .populate('productId', 'name images')
    .populate('lastMessage.sender', 'fullName')
    .sort({ updatedAt: -1 });

    // Format conversations for frontend
    const formattedConversations = conversations.map(conv => {
        const otherParticipant = conv.participants.find(p => p._id.toString() !== userId);
        const unreadCount = conv.unreadCounts.get(userId) || 0;
        
        return {
            _id: conv._id,
            participant: otherParticipant,
            product: conv.productId,
            lastMessage: conv.lastMessage,
            unreadCount,
            updatedAt: conv.updatedAt
        };
    });

    res.json({ success: true, message: "Conversations retrieved successfully.", data: formattedConversations });
}));

// Get messages in a conversation
router.get('/conversations/:conversationId/messages', asyncHandler(async (req, res) => {
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const messages = await Message.find({
        conversationId,
        isDeleted: false
    })
    .populate('sender', 'fullName')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

    // Reverse to show oldest first
    messages.reverse();

    res.json({ success: true, message: "Messages retrieved successfully.", data: messages });
}));

// Send message (with file upload support)
router.post('/messages', asyncHandler(async (req, res) => {
    upload.fields([
        { name: 'image', maxCount: 1 },
        { name: 'voice', maxCount: 1 }
    ])(req, res, async function (err) {
        if (err) {
            return res.status(400).json({ success: false, message: err.message });
        }

        const { conversationId, senderId, messageType, text, voiceDuration } = req.body;

        if (!conversationId || !senderId || !messageType) {
            return res.status(400).json({ success: false, message: "Required fields are missing." });
        }

        // Verify conversation exists and sender is participant
        const conversation = await Conversation.findById(conversationId);
        if (!conversation || !conversation.participants.includes(senderId)) {
            return res.status(404).json({ success: false, message: "Conversation not found or unauthorized." });
        }

        // Prepare message content
        const content = {};
        
        if (messageType === 'text') {
            content.text = text;
        } else if (messageType === 'image' && req.files.image) {
            content.imageUrl = `${baseUrl}/image/messages/images/${req.files.image[0].filename}`;
        } else if (messageType === 'voice' && req.files.voice) {
            content.voiceUrl = `${baseUrl}/image/messages/voice/${req.files.voice[0].filename}`;
            content.voiceDuration = voiceDuration || 0;
        }

        // Create message
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
        const receiverId = conversation.participants.find(p => p.toString() !== senderId);
        const currentUnreadCount = conversation.unreadCounts.get(receiverId.toString()) || 0;
        conversation.unreadCounts.set(receiverId.toString(), currentUnreadCount + 1);
        
        conversation.lastMessage = {
            text: content.text || (messageType === 'image' ? 'Image' : 'Voice message'),
            sender: senderId,
            timestamp: new Date(),
            messageType
        };
        conversation.updatedAt = new Date();
        
        await conversation.save();

        res.json({ success: true, message: "Message sent successfully.", data: message });
    });
}));

// Mark messages as read
router.put('/conversations/:conversationId/read', asyncHandler(async (req, res) => {
    const { conversationId } = req.params;
    const { userId } = req.body;

    // Update message statuses
    await Message.updateMany(
        {
            conversationId,
            sender: { $ne: userId },
            status: { $ne: 'read' }
        },
        { status: 'read' }
    );

    // Reset unread count
    const conversation = await Conversation.findById(conversationId);
    if (conversation) {
        conversation.unreadCounts.set(userId, 0);
        await conversation.save();
    }

    res.json({ success: true, message: "Messages marked as read." });
}));

// Delete message
router.delete('/messages/:messageId', asyncHandler(async (req, res) => {
    const { messageId } = req.params;
    const { userId } = req.body;

    const message = await Message.findById(messageId);
    if (!message) {
        return res.status(404).json({ success: false, message: "Message not found." });
    }

    // Add user to deletedBy array
    if (!message.deletedBy.includes(userId)) {
        message.deletedBy.push(userId);
    }

    // If both participants have deleted, mark as deleted
    const conversation = await Conversation.findById(message.conversationId);
    if (message.deletedBy.length >= conversation.participants.length) {
        message.isDeleted = true;
    }

    await message.save();

    res.json({ success: true, message: "Message deleted successfully." });
}));

// Update user online status
router.put('/users/:userId/status', asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { isOnline, socketId } = req.body;

    await UserStatus.findOneAndUpdate(
        { userId },
        {
            userId,
            isOnline,
            lastSeen: new Date(),
            ...(socketId && { socketId })
        },
        { upsert: true, new: true }
    );

    res.json({ success: true, message: "Status updated successfully." });
}));

// Get user online status
router.get('/users/:userId/status', asyncHandler(async (req, res) => {
    const { userId } = req.params;

    const status = await UserStatus.findOne({ userId });
    
    res.json({ 
        success: true, 
        message: "Status retrieved successfully.", 
        data: status || { isOnline: false, lastSeen: new Date() }
    });
}));

module.exports = router;