const express = require('express');
const asyncHandler = require('express-async-handler');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const mongoose = require('mongoose');
const { Conversation, Message, UserStatus } = require('../model/message');
const User = require('../model/user');
const Product = require('../model/product');

let baseUrl = "http://localhost:3000" || process.env.BASE_URL;

// Socket.IO import fix - lazy loading to avoid circular dependency
let io;
const getIO = () => {
    if (!io) {
        try {
            const app = require('../index');
            io = app.io;
        } catch (error) {
            console.error('❌ Failed to get Socket.IO instance:', error);
            return null;
        }
    }
    return io;
};

// Create upload directories if they don't exist
const createDirectories = async () => {
    const directories = [
        'public/messages/images/',
        'public/messages/videos/',
        'public/messages/voice/',
        'public/messages/documents/'
    ];
    
    for (const dir of directories) {
        try {
            await fs.mkdir(dir, { recursive: true });
            console.log(`✅ Directory created/verified: ${dir}`);
        } catch (error) {
            console.error(`❌ Error creating directory ${dir}:`, error);
        }
    }
};

// Initialize directories on startup
createDirectories();

// Enhanced multer setup with better error handling
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        let uploadPath;
        console.log(`📁 Processing file: ${file.fieldname} - ${file.originalname}`);
        
        switch (file.fieldname) {
            case 'image':
                uploadPath = 'public/messages/images/';
                break;
            case 'video':
                uploadPath = 'public/messages/videos/';
                break;
            case 'voice':
                uploadPath = 'public/messages/voice/';
                break;
            case 'document':
                uploadPath = 'public/messages/documents/';
                break;
            default:
                console.error(`❌ Unknown field name: ${file.fieldname}`);
                uploadPath = 'public/messages/files/';
        }
        
        console.log(`📂 Upload path: ${uploadPath}`);
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        const filename = file.fieldname + '-' + uniqueSuffix + extension;
        console.log(`📝 Generated filename: ${filename}`);
        cb(null, filename);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB limit
    },
    fileFilter: function (req, file, cb) {
        console.log(`🔍 File filter check: ${file.fieldname} - ${file.originalname} - ${file.mimetype}`);
        
        // Define allowed file types per field
        const allowedTypes = {
            'image': {
                mimes: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp', 'image/webp'],
                extensions: ['.jpeg', '.jpg', '.png', '.gif', '.bmp', '.webp']
            },
            'video': {
                mimes: ['video/mp4', 'video/mov', 'video/avi', 'video/mkv', 'video/wmv', 'video/flv', 'video/webm', 'video/m4v'],
                extensions: ['.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm', '.m4v']
            },
            'voice': {
                mimes: ['audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/aac', 'audio/m4a', 'audio/ogg', 'audio/flac'],
                extensions: ['.mp3', '.wav', '.aac', '.m4a', '.ogg', '.flac']
            },
            'document': {
                mimes: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
                extensions: ['.pdf', '.doc', '.docx', '.txt', '.xls', '.xlsx', '.ppt', '.pptx']
            }
        };

        const fileExtension = path.extname(file.originalname).toLowerCase();
        const allowedForField = allowedTypes[file.fieldname];

        if (!allowedForField) {
            console.error(`❌ Unknown field: ${file.fieldname}`);
            return cb(new Error(`Unknown field: ${file.fieldname}`), false);
        }

        // Check mime type and extension
        const mimeValid = allowedForField.mimes.includes(file.mimetype.toLowerCase());
        const extensionValid = allowedForField.extensions.includes(fileExtension);

        if (mimeValid && extensionValid) {
            console.log(`✅ File validation passed: ${file.originalname}`);
            cb(null, true);
        } else {
            console.error(`❌ File validation failed: ${file.originalname} - mime: ${file.mimetype}, extension: ${fileExtension}`);
            cb(new Error(`Invalid ${file.fieldname} file. Allowed extensions: ${allowedForField.extensions.join(', ')}`), false);
        }
    }
});

// ============================================================================
// ENHANCED CONVERSATION ROUTES with Role-Based Support
// ============================================================================

// ENHANCED: Get or create conversation with explicit role tracking
router.post('/conversations', asyncHandler(async (req, res) => {
    const { buyerId, sellerId, productId } = req.body;

    if (!buyerId || !sellerId) {
        return res.status(400).json({ 
            success: false, 
            message: "buyerId and sellerId are required." 
        });
    }

    // Ensure buyer and seller are different users
    if (buyerId === sellerId) {
        return res.status(400).json({
            success: false,
            message: "Buyer and seller cannot be the same user."
        });
    }

    // Check if conversation already exists - enhanced with explicit role fields
    let conversation = await Conversation.findOne({
        // IMPORTANT: Use explicit buyer/seller fields instead of generic participants
        buyerId: buyerId,
        sellerId: sellerId,
        ...(productId && { productId })
    }).populate([
        { path: 'buyerId', select: 'fullName phoneNumber accountType' },
        { path: 'sellerId', select: 'fullName phoneNumber accountType' },
        { path: 'productId', select: 'name images' }
    ]);

    // Fallback: check legacy conversations
    if (!conversation) {
        conversation = await Conversation.findOne({
            participants: { $all: [buyerId, sellerId] },
            ...(productId && { productId })
        }).populate([
            { path: 'participants', select: 'fullName phoneNumber accountType' },
            { path: 'productId', select: 'name images' }
        ]);
    }

    if (!conversation) {
        // Verify users exist and have correct roles
        const buyer = await User.findById(buyerId);
        const seller = await User.findById(sellerId);

        if (!buyer || !seller) {
            return res.status(404).json({
                success: false,
                message: "Buyer or seller not found."
            });
        }

        // Create new conversation with explicit role tracking
        conversation = new Conversation({
            buyerId: buyerId,
            sellerId: sellerId,
            participants: [buyerId, sellerId], // Keep for backward compatibility
            ...(productId && { productId }),
            unreadCounts: new Map()
        });
        
        await conversation.save();
        await conversation.populate([
            { path: 'buyerId', select: 'fullName phoneNumber accountType' },
            { path: 'sellerId', select: 'fullName phoneNumber accountType' },
            { path: 'productId', select: 'name images' }
        ]);
        
        console.log('✅ New conversation created with role tracking:', conversation._id);
    }

    res.json({ 
        success: true, 
        message: "Conversation retrieved/created successfully.", 
        data: conversation 
    });
}));

// ENHANCED: Get conversations by user role - STRICT role separation
router.get('/conversations/user/:userId', asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { role } = req.query; // 'buyer' or 'seller' - REQUIRED for proper separation

    console.log(`📱 Getting conversations for user: ${userId} as role: ${role}`);

    // STRICT: Role parameter is REQUIRED for proper conversation separation
    if (!role || !['buyer', 'seller'].includes(role)) {
        return res.status(400).json({
            success: false,
            message: "Role parameter is required and must be either 'buyer' or 'seller' for conversation separation."
        });
    }

    // Build query based on STRICT role - no fallback to mixed conversations
    let query = {};
    if (role === 'buyer') {
        query = { buyerId: userId };
    } else if (role === 'seller') {
        query = { sellerId: userId };
    }

    const conversations = await Conversation.find(query)
        .populate([
            { path: 'buyerId', select: 'fullName phoneNumber accountType' },
            { path: 'sellerId', select: 'fullName phoneNumber accountType' },
            { path: 'productId', select: 'name images' },
            { path: 'lastMessage.sender', select: 'fullName' }
        ])
        .sort({ updatedAt: -1 });

    // Format conversations for response with STRICT role context
    const formattedConversations = conversations.map(conv => {
        // Determine the other participant based on current user's role
        const participant = role === 'buyer' ? conv.sellerId : conv.buyerId;

        return {
            _id: conv._id,
            participant: participant,
            product: conv.productId,
            lastMessage: conv.lastMessage,
            unreadCount: conv.unreadCounts.get(userId) || 0,
            updatedAt: conv.updatedAt,
            createdAt: conv.createdAt,
            // Role context for client-side handling
            buyerId: conv.buyerId?._id || conv.buyerId,
            sellerId: conv.sellerId?._id || conv.sellerId,
            currentUserRole: role,
            otherUserRole: role === 'buyer' ? 'seller' : 'buyer'
        };
    });

    console.log(`✅ Retrieved ${formattedConversations.length} conversations for ${userId} as ${role}`);

    res.json({ 
        success: true, 
        message: `Conversations retrieved successfully for role: ${role}.`, 
        data: formattedConversations 
    });
}));

// REMOVED: Legacy unified conversation route - now requires role-based separation
// Users must specify their role (buyer/seller) to get appropriate conversations

// Get messages in conversation
router.get('/conversations/:conversationId/messages', asyncHandler(async (req, res) => {
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const messages = await Message.find({
        conversationId,
        isDeleted: false
    })
    .populate([
        { path: 'sender', select: 'fullName' },
        { path: 'replyTo', select: 'content messageType sender createdAt' }
    ])
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

    res.json({ 
        success: true, 
        message: "Messages retrieved successfully.", 
        data: messages.reverse() // Reverse to show oldest first
    });
}));

// ============================================================================
// MESSAGE ROUTES with Enhanced Role Support
// ============================================================================

// Create message placeholder (before upload)
router.post('/placeholder', asyncHandler(async (req, res) => {
    const { 
        conversationId, 
        senderId, 
        messageType,
        caption, // Optional text for media messages
        replyToMessageId
    } = req.body;

    console.log('📝 Creating message placeholder:', { conversationId, senderId, messageType });

    // Validate required fields
    if (!conversationId || !senderId || !messageType) {
        return res.status(400).json({ 
            success: false, 
            message: "conversationId, senderId, and messageType are required." 
        });
    }

    // Verify conversation exists and get role information
    const conversation = await Conversation.findById(conversationId).populate([
        { path: 'buyerId', select: 'fullName phoneNumber accountType' },
        { path: 'sellerId', select: 'fullName phoneNumber accountType' }
    ]);
    
    if (!conversation) {
        return res.status(404).json({ 
            success: false, 
            message: "Conversation not found." 
        });
    }

    // Enhanced participant validation with role checking
    const validation = validateMessagePermissions(conversation, senderId);
    if (!validation.valid) {
        return res.status(403).json({ 
            success: false, 
            message: validation.error 
        });
    }

    console.log(`📝 Placeholder from ${senderId} as ${validation.role}`);

    try {
        // Create placeholder message with role context
        const messageData = {
            conversationId,
            sender: senderId,
            messageType,
            content: {
                ...(caption && caption.trim() && { text: caption.trim() })
            },
            status: 'pending', // Placeholder status
            // NEW: Add role metadata
            metadata: {
                senderRole: validation.role,
                timestamp: new Date()
            }
        };

        // Add reply reference if provided
        if (replyToMessageId) {
            const replyToMessage = await Message.findById(replyToMessageId);
            if (replyToMessage && replyToMessage.conversationId.toString() === conversationId) {
                messageData.replyTo = replyToMessageId;
            }
        }

        const message = new Message(messageData);
        await message.save();
        
        // Populate sender information
        await message.populate([
            { path: 'sender', select: 'fullName' },
            { path: 'replyTo', select: 'content messageType sender createdAt' }
        ]);

        console.log('✅ Placeholder created:', message._id);

        res.json({ 
            success: true, 
            message: "Message placeholder created successfully.", 
            data: {
                messageId: message._id,
                message: message
            }
        });

    } catch (error) {
        console.error('❌ Placeholder creation error:', error);
        res.status(500).json({
            success: false,
            message: "Failed to create message placeholder: " + error.message
        });
    }
}));

// Upload file and emit socket metadata
router.post('/:messageId/upload', asyncHandler(async (req, res) => {
    const { messageId } = req.params;
    
    console.log('📤 File upload for message:', messageId);

    // Find the placeholder message
    const message = await Message.findById(messageId);
    if (!message) {
        console.log('❌ Message not found.');
        return res.status(404).json({
            success: false,
            message: "Message not found."
        });
    }

    console.log('📋 Current message status:', message.status);

    if (message.status !== 'pending' && message.status !== 'failed') {
        console.log('❌ Message not in uploadable state. Current status:', message.status);
        return res.status(400).json({
            success: false,
            message: "Message is not in uploadable state."
        });
    }

    // Use multer middleware for file upload
    upload.fields([
        { name: 'image', maxCount: 1 },
        { name: 'video', maxCount: 1 },
        { name: 'voice', maxCount: 1 },
        { name: 'document', maxCount: 1 }
    ])(req, res, async function (err) {
        if (err) {
            console.error('❌ Upload error:', err);
            return res.status(400).json({ 
                success: false, 
                message: err.message || 'File upload failed' 
            });
        }

        try {
            const { 
                voiceDuration,
                videoDuration,
                fileName
            } = req.body;

            // Prepare message content based on uploaded file
            const content = await prepareMessageContent(message.messageType, req, {
                voiceDuration,
                videoDuration,
                fileName,
                existingText: message.content?.text // Preserve any caption from placeholder
            });

            if (!content) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid file upload for the specified message type."
                });
            }

            // Update message with file content and change status to sent
            message.content = { ...message.content, ...content };
            message.status = 'sent';
            await message.save();

            // Populate for socket emission
            await message.populate([
                { path: 'sender', select: 'fullName' },
                { path: 'replyTo', select: 'content messageType sender createdAt' }
            ]);

            // Update conversation with last message
            const conversation = await Conversation.findById(message.conversationId).populate([
                { path: 'buyerId', select: 'fullName phoneNumber accountType' },
                { path: 'sellerId', select: 'fullName phoneNumber accountType' }
            ]);
            await updateConversationLastMessage(conversation, message, message.sender._id || message.sender);

            // ENHANCED SOCKET EMISSION with role information
            console.log('📡 Emitting file upload via socket with role context:', messageId);
            
            const socketPayload = {
                messageId: message._id,
                conversationId: message.conversationId,
                senderId: message.sender._id,
                messageType: message.messageType,
                content: message.content,
                timestamp: message.createdAt,
                status: 'sent',
                // NEW: Include role context for client-side filtering
                roleContext: {
                    senderRole: message.metadata?.senderRole,
                    buyerId: conversation.buyerId?._id || conversation.buyerId,
                    sellerId: conversation.sellerId?._id || conversation.sellerId
                }
            };

            // Emit to both participants with role context
            await emitToParticipants(conversation, socketPayload);

            console.log('✅ File uploaded and message sent successfully with role tracking');

            res.json({ 
                success: true, 
                message: "File uploaded and message sent successfully.", 
                data: message 
            });

        } catch (error) {
            console.error('❌ Upload processing error:', error);
            
            // Mark message as failed
            message.status = 'failed';
            await message.save();

            res.status(500).json({
                success: false,
                message: "Failed to process upload: " + error.message
            });
        }
    });
}));

// ENHANCED: Send text message with socket emission and role validation
router.post('/text', asyncHandler(async (req, res) => {
    const { 
        conversationId, 
        senderId, 
        text,
        replyToMessageId
    } = req.body;

    console.log('💬 Creating text message:', { conversationId, senderId, hasText: !!text });

    // Validate required fields
    if (!conversationId || !senderId || !text || text.trim() === '') {
        return res.status(400).json({ 
            success: false, 
            message: "conversationId, senderId, and text are required." 
        });
    }

    // Verify conversation exists and get role information
    const conversation = await Conversation.findById(conversationId).populate([
        { path: 'buyerId', select: 'fullName phoneNumber accountType' },
        { path: 'sellerId', select: 'fullName phoneNumber accountType' }
    ]);
    
    if (!conversation) {
        return res.status(404).json({ 
            success: false, 
            message: "Conversation not found." 
        });
    }

    // Enhanced participant validation with role checking
    const validation = validateMessagePermissions(conversation, senderId);
    if (!validation.valid) {
        return res.status(403).json({ 
            success: false, 
            message: validation.error 
        });
    }

    console.log(`📝 Message from ${senderId} as ${validation.role}`);

    try {
        // Create text message with role context
        const messageData = {
            conversationId,
            sender: senderId,
            messageType: 'text',
            content: { text: text.trim() },
            status: 'sent',
            // NEW: Add role metadata for potential future use
            metadata: {
                senderRole: validation.role,
                timestamp: new Date()
            }
        };

        // Add reply reference if provided
        if (replyToMessageId) {
            const replyToMessage = await Message.findById(replyToMessageId);
            if (replyToMessage && replyToMessage.conversationId.toString() === conversationId) {
                messageData.replyTo = replyToMessageId;
            }
        }

        const message = new Message(messageData);
        await message.save();
        
        // Populate sender information
        await message.populate([
            { path: 'sender', select: 'fullName' },
            { path: 'replyTo', select: 'content messageType sender createdAt' }
        ]);

        // Update conversation
        await updateConversationLastMessage(conversation, message, senderId);

        // ENHANCED SOCKET EMISSION with role information
        console.log('📡 Emitting text message via socket with role context:', message._id);
        
        const socketPayload = {
            messageId: message._id,
            conversationId: message.conversationId,
            senderId: message.sender._id,
            messageType: message.messageType,
            content: message.content,
            timestamp: message.createdAt,
            status: 'sent',
            // NEW: Include role context for client-side filtering
            roleContext: {
                senderRole: validation.role,
                buyerId: conversation.buyerId?._id || conversation.buyerId,
                sellerId: conversation.sellerId?._id || conversation.sellerId
            }
        };

        // Emit to both participants with role context
        await emitToParticipants(conversation, socketPayload);

        console.log('✅ Text message created and sent successfully with role tracking');

        res.json({ 
            success: true, 
            message: "Text message sent successfully.", 
            data: message 
        });

    } catch (error) {
        console.error('❌ Text message creation error:', error);
        res.status(500).json({
            success: false,
            message: "Failed to send text message: " + error.message
        });
    }
}));

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// Enhanced message validation with role context using schema methods
function validateMessagePermissions(conversation, senderId, requiredRole = null) {
    // Use the schema method for cleaner validation
    const validation = conversation.validateUserPermission(senderId, requiredRole);
    
    // Fix: Convert 'participant' to 'unknown' to match Message schema enum
    if (validation.valid && validation.role === 'participant') {
        validation.role = 'unknown';
    }
    
    return validation;
}

// Enhanced socket emission function
async function emitToParticipants(conversation, payload) {
    try {
        const socketIO = getIO();
        if (!socketIO) {
            console.warn('⚠️ Socket.IO not available - message saved but not emitted');
            return;
        }

        // Emit to buyer
        if (conversation.buyerId) {
            const buyerSocketId = conversation.buyerId._id || conversation.buyerId;
            socketIO.to(buyerSocketId.toString()).emit('send_message', payload);
            console.log(`📡 Emitted to buyer: ${buyerSocketId}`);
        }
        
        // Emit to seller
        if (conversation.sellerId) {
            const sellerSocketId = conversation.sellerId._id || conversation.sellerId;
            socketIO.to(sellerSocketId.toString()).emit('send_message', payload);
            console.log(`📡 Emitted to seller: ${sellerSocketId}`);
        }
        
        // Fallback for legacy conversations
        if (conversation.participants && (!conversation.buyerId || !conversation.sellerId)) {
            conversation.participants.forEach((participantId) => {
                socketIO.to(participantId.toString()).emit('send_message', payload);
                console.log(`📡 Emitted to legacy participant: ${participantId}`);
            });
        }
        
        console.log('✅ Message emitted via socket with role context');
    } catch (socketError) {
        console.error('❌ Socket emission error:', socketError);
        // Don't throw error - message was saved successfully
    }
}

// Helper function to prepare message content based on type
async function prepareMessageContent(messageType, req, additionalData) {
    const { voiceDuration, videoDuration, fileName, existingText } = additionalData;
    const files = req.files || {};

    console.log(`🔧 Preparing content for messageType: ${messageType}`);
    console.log('📁 Available files:', Object.keys(files));

    switch (messageType) {
        case 'image':
            if (!files.image || files.image.length === 0) {
                throw new Error('Image file is required for image messages');
            }
            const imageFile = files.image[0];
            const imageStats = await fs.stat(imageFile.path);
            
            return {
                imageUrl: `${baseUrl}/image/messages/${imageFile.filename}`,
                fileName: imageFile.originalname,
                fileSize: formatFileSize(imageStats.size),
                mimeType: imageFile.mimetype,
                ...(existingText && { text: existingText })
            };

        case 'video':
            if (!files.video || files.video.length === 0) {
                throw new Error('Video file is required for video messages');
            }
            const videoFile = files.video[0];
            const videoStats = await fs.stat(videoFile.path);
            
            return {
                videoUrl: `${baseUrl}/videos/messages/${videoFile.filename}`,
                fileName: videoFile.originalname,
                fileSize: formatFileSize(videoStats.size),
                mimeType: videoFile.mimetype,
                videoDuration: parseInt(videoDuration) || 0,
                ...(existingText && { text: existingText })
            };

        case 'voice':
            if (!files.voice || files.voice.length === 0) {
                throw new Error('Voice file is required for voice messages');
            }
            const voiceFile = files.voice[0];
            const voiceStats = await fs.stat(voiceFile.path);
            
            return {
                voiceUrl: `${baseUrl}/voice/messages/${voiceFile.filename}`,
                fileName: voiceFile.originalname,
                fileSize: formatFileSize(voiceStats.size),
                mimeType: voiceFile.mimetype,
                voiceDuration: parseInt(voiceDuration) || 0
            };

        case 'document':
            if (!files.document || files.document.length === 0) {
                throw new Error('Document file is required for document messages');
            }
            const docFile = files.document[0];
            const docStats = await fs.stat(docFile.path);
            
            return {
                documentUrl: `${baseUrl}/documents/messages/${docFile.filename}`,
                fileName: fileName || docFile.originalname,
                fileSize: formatFileSize(docStats.size),
                mimeType: docFile.mimetype,
                fileExtension: path.extname(docFile.originalname).toLowerCase()
            };

        default:
            throw new Error('Unsupported message type: ' + messageType);
    }
}

// FIXED: Helper function to update conversation with last message
async function updateConversationLastMessage(conversation, message, senderId) {
    try {
        console.log('🔄 Updating conversation last message:', {
            conversationId: conversation._id,
            messageType: message.messageType,
            senderType: typeof message.sender,
            senderIdParam: senderId
        });

        // Find receiver based on role structure
        let receiverId;
        if (conversation.buyerId && conversation.sellerId) {
            // Use explicit role fields
            const senderIdStr = senderId.toString();
            const buyerIdStr = (conversation.buyerId._id || conversation.buyerId).toString();
            const sellerIdStr = (conversation.sellerId._id || conversation.sellerId).toString();
            
            if (senderIdStr === buyerIdStr) {
                receiverId = sellerIdStr;
            } else if (senderIdStr === sellerIdStr) {
                receiverId = buyerIdStr;
            }
        } else {
            // Fallback to participants array
            receiverId = conversation.participants?.find(p => p.toString() !== senderId.toString());
        }
        
        // Update unread count for receiver
        if (receiverId) {
            const currentUnreadCount = conversation.unreadCounts.get(receiverId.toString()) || 0;
            conversation.unreadCounts.set(receiverId.toString(), currentUnreadCount + 1);
            console.log(`📊 Updated unread count for ${receiverId}: ${currentUnreadCount + 1}`);
        }
        
        // Create preview text based on message type
        let previewText = '';
        switch (message.messageType) {
            case 'text':
                previewText = message.content.text || 'Message';
                break;
            case 'image':
                previewText = message.content.text ? `📷 ${message.content.text}` : '📷 Photo';
                break;
            case 'video':
                previewText = message.content.text ? `🎥 ${message.content.text}` : '🎥 Video';
                break;
            case 'voice':
                previewText = '🎵 Voice message';
                break;
            case 'document':
                const fileName = message.content.fileName || 'Document';
                previewText = `📄 ${fileName}`;
                break;
            default:
                previewText = 'Message';
        }

        // CRITICAL FIX: Ensure sender is always an ObjectId string, not a populated object
        let senderObjectId;
        
        if (typeof message.sender === 'string') {
            // Already a string ObjectId
            senderObjectId = message.sender;
        } else if (message.sender && typeof message.sender === 'object' && message.sender._id) {
            // Populated object with _id
            senderObjectId = message.sender._id.toString();
        } else {
            // Fallback to the senderId parameter
            senderObjectId = senderId.toString();
        }

        console.log('📝 Setting lastMessage with sender:', senderObjectId);

        // Update conversation last message
        conversation.lastMessage = {
            text: previewText,
            sender: senderObjectId, // Use the properly extracted ObjectId
            timestamp: new Date(),
            messageType: message.messageType
        };
        
        conversation.updatedAt = new Date();
        
        await conversation.save();
        
        console.log('✅ Conversation last message updated successfully');
        
    } catch (error) {
        console.error('❌ Error updating conversation last message:', error);
        throw new Error(`Failed to update conversation: ${error.message}`);
    }
}

// Helper function to format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ============================================================================
// ENHANCED UTILITY AND MANAGEMENT ROUTES
// ============================================================================

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

    // Update conversation unread count
    const conversation = await Conversation.findById(conversationId);
    if (conversation) {
        conversation.unreadCounts.set(userId, 0);
        await conversation.save();
    }

    res.json({ 
        success: true, 
        message: "Messages marked as read successfully." 
    });
}));

// Retry failed upload
router.post('/:messageId/retry', asyncHandler(async (req, res) => {
    const { messageId } = req.params;
    
    console.log('🔄 Retrying message upload:', messageId);

    // Find the failed message
    const message = await Message.findById(messageId);
    if (!message) {
        return res.status(404).json({
            success: false,
            message: "Message not found."
        });
    }

    if (message.status !== 'failed') {
        return res.status(400).json({
            success: false,
            message: "Message is not in failed state."
        });
    }

    // Reset message status to pending for retry
    message.status = 'pending';
    await message.save();

    res.json({
        success: true,
        message: "Message marked for retry.",
        data: { messageId: message._id }
    });
}));

// Delete message
router.delete('/:messageId', asyncHandler(async (req, res) => {
    const { messageId } = req.params;
    const { userId } = req.query;

    const message = await Message.findById(messageId);
    if (!message) {
        return res.status(404).json({ 
            success: false, 
            message: "Message not found." 
        });
    }

    // Verify user is sender or participant in conversation
    const conversation = await Conversation.findById(message.conversationId);
    if (!conversation) {
        return res.status(404).json({ 
            success: false, 
            message: "Conversation not found." 
        });
    }

    // Enhanced validation with role support
    const validation = validateMessagePermissions(conversation, userId);
    if (!validation.valid) {
        return res.status(403).json({ 
            success: false, 
            message: "Unauthorized to delete this message." 
        });
    }

    // Add user to deletedBy array
    if (!message.deletedBy.includes(userId)) {
        message.deletedBy.push(userId);
    }

    // Determine total participants count
    const totalParticipants = conversation.participants?.length || 
                             (conversation.buyerId && conversation.sellerId ? 2 : 1);

    // If both participants have deleted, mark as deleted
    if (message.deletedBy.length >= totalParticipants) {
        message.isDeleted = true;
    }

    await message.save();

    res.json({ 
        success: true, 
        message: "Message deleted successfully." 
    });
}));

// Database migration utility to update existing conversations
router.post('/migrate/add-role-fields', asyncHandler(async (req, res) => {
    console.log('🔄 Starting role field migration...');
    
    try {
        // Find conversations without explicit role fields
        const conversationsToMigrate = await Conversation.find({
            $or: [
                { buyerId: { $exists: false } },
                { sellerId: { $exists: false } }
            ]
        }).populate('participants productId');

        console.log(`📊 Found ${conversationsToMigrate.length} conversations to migrate`);

        let migratedCount = 0;
        let errorCount = 0;

        for (const conversation of conversationsToMigrate) {
            try {
                if (!conversation.participants || conversation.participants.length < 2) {
                    console.warn(`⚠️ Skipping conversation ${conversation._id} - insufficient participants`);
                    continue;
                }

                // Strategy: If there's a product, the product owner is the seller
                let buyerId, sellerId;

                if (conversation.productId && conversation.productId.sellerId) {
                    // Product owner is seller, other participant is buyer
                    const productOwnerId = conversation.productId.sellerId.toString();
                    sellerId = conversation.participants.find(p => p._id.toString() === productOwnerId);
                    buyerId = conversation.participants.find(p => p._id.toString() !== productOwnerId);
                } else {
                    // Fallback: Check user account types
                    const participant1 = await User.findById(conversation.participants[0]);
                    const participant2 = await User.findById(conversation.participants[1]);

                    if (participant1?.accountType === 'seller' && participant2?.accountType === 'buyer') {
                        sellerId = participant1._id;
                        buyerId = participant2._id;
                    } else if (participant1?.accountType === 'buyer' && participant2?.accountType === 'seller') {
                        buyerId = participant1._id;
                        sellerId = participant2._id;
                    } else {
                        // Default: first participant is buyer, second is seller
                        buyerId = conversation.participants[0];
                        sellerId = conversation.participants[1];
                        console.warn(`⚠️ Using default role assignment for conversation ${conversation._id}`);
                    }
                }

                // Update conversation with role fields
                await Conversation.findByIdAndUpdate(conversation._id, {
                    buyerId: buyerId,
                    sellerId: sellerId
                });

                migratedCount++;
                console.log(`✅ Migrated conversation ${conversation._id}: buyer=${buyerId}, seller=${sellerId}`);

            } catch (convError) {
                console.error(`❌ Error migrating conversation ${conversation._id}:`, convError);
                errorCount++;
            }
        }

        console.log(`🏁 Migration completed: ${migratedCount} migrated, ${errorCount} errors`);

        res.json({
            success: true,
            message: `Migration completed successfully.`,
            data: {
                totalFound: conversationsToMigrate.length,
                migrated: migratedCount,
                errors: errorCount
            }
        });

    } catch (error) {
        console.error('❌ Migration error:', error);
        res.status(500).json({
            success: false,
            message: "Migration failed: " + error.message
        });
    }
}));

// Role-specific message statistics
router.get('/stats/user/:userId', asyncHandler(async (req, res) => {
    const { userId } = req.params;
    
    try {
        // Get conversation counts by role
        const buyerConversations = await Conversation.countDocuments({ buyerId: userId });
        const sellerConversations = await Conversation.countDocuments({ sellerId: userId });
        
        // Get message counts
        const totalMessages = await Message.countDocuments({
            sender: userId,
            isDeleted: false
        });
        
        // Get unread counts using proper ObjectId conversion
        const userObjectId = mongoose.Types.ObjectId(userId);
        
        const buyerUnreadResult = await Conversation.aggregate([
            { $match: { buyerId: userObjectId } },
            { 
                $project: { 
                    unreadCount: { 
                        $ifNull: [
                            { $arrayElemAt: [
                                { $objectToArray: "$unreadCounts" }, 
                                { $indexOfArray: [
                                    { $map: { input: { $objectToArray: "$unreadCounts" }, as: "item", in: "$item.k" } }, 
                                    userId 
                                ]}
                            ]}, 
                            { v: 0 }
                        ]
                    }
                }
            },
            { $group: { _id: null, total: { $sum: "$unreadCount.v" } } }
        ]);
        
        const sellerUnreadResult = await Conversation.aggregate([
            { $match: { sellerId: userObjectId } },
            { 
                $project: { 
                    unreadCount: { 
                        $ifNull: [
                            { $arrayElemAt: [
                                { $objectToArray: "$unreadCounts" }, 
                                { $indexOfArray: [
                                    { $map: { input: { $objectToArray: "$unreadCounts" }, as: "item", in: "$item.k" } }, 
                                    userId 
                                ]}
                            ]}, 
                            { v: 0 }
                        ]
                    }
                }
            },
            { $group: { _id: null, total: { $sum: "$unreadCount.v" } } }
        ]);

        const stats = {
            conversations: {
                asBuyer: buyerConversations,
                asSeller: sellerConversations,
                total: buyerConversations + sellerConversations
            },
            messages: {
                total: totalMessages
            },
            unread: {
                asBuyer: buyerUnreadResult[0]?.total || 0,
                asSeller: sellerUnreadResult[0]?.total || 0
            }
        };

        res.json({
            success: true,
            message: "User message statistics retrieved successfully.",
            data: stats
        });

    } catch (error) {
        console.error('❌ Stats error:', error);
        res.status(500).json({
            success: false,
            message: "Failed to retrieve statistics: " + error.message
        });
    }
}));

// Cleanup abandoned placeholders (run periodically)
router.delete('/cleanup/placeholders', asyncHandler(async (req, res) => {
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

    const result = await Message.deleteMany({
        status: 'pending',
        createdAt: { $lt: cutoffTime }
    });

    console.log(`🧹 Cleaned up ${result.deletedCount} abandoned placeholders`);

    res.json({
        success: true,
        message: `Cleaned up ${result.deletedCount} abandoned message placeholders.`,
        data: { deletedCount: result.deletedCount }
    });
}));

module.exports = router;