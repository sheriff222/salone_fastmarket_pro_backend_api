const express = require('express');
const asyncHandler = require('express-async-handler');
const router = express.Router();
const mongoose = require('mongoose');
const { Conversation, Message, UserStatus } = require('../model/message');
const User = require('../model/user');
const Product = require('../model/product');
const { uploadMessageAttachments, handleMulterError, multerErrorMiddleware } = require('../middleware/uploadMiddleware.js');
const { 
    uploadMessageImage,
    uploadMessageVideo,
    uploadMessageVoice,
    uploadMessageDocument,
    deleteFromCloudinary,
    extractPublicId,
    formatFileSize
} = require('../utils/cloudinaryUpload');

// Socket.IO import - lazy loading
let io;
const getIO = () => {
    if (!io) {
        try {
            const app = require('../index');
            io = app.io;
        } catch (error) {
            console.error('Failed to get Socket.IO instance:', error);
            return null;
        }
    }
    return io;
};

// ============================================================================
// CONVERSATION ROUTES
// ============================================================================

// Get or create conversation with role tracking
router.post('/conversations', asyncHandler(async (req, res) => {
    const { buyerId, sellerId, productId } = req.body;

    if (!buyerId || !sellerId) {
        return res.status(400).json({ 
            success: false, 
            message: "buyerId and sellerId are required." 
        });
    }

    if (buyerId === sellerId) {
        return res.status(400).json({
            success: false,
            message: "Buyer and seller cannot be the same user."
        });
    }

    let conversation = await Conversation.findOne({
        buyerId: buyerId,
        sellerId: sellerId,
        ...(productId && { productId })
    }).populate([
        { path: 'buyerId', select: 'fullName phoneNumber accountType' },
        { path: 'sellerId', select: 'fullName phoneNumber accountType' },
        { path: 'productId', select: 'name images' }
    ]);

    if (!conversation) {
        const [buyer, seller] = await Promise.all([
            User.findById(buyerId),
            User.findById(sellerId)
        ]);

        if (!buyer || !seller) {
            return res.status(404).json({
                success: false,
                message: "Buyer or seller not found."
            });
        }

        conversation = new Conversation({
            buyerId: buyerId,
            sellerId: sellerId,
            participants: [buyerId, sellerId],
            ...(productId && { productId }),
            unreadCounts: new Map()
        });
        
        await conversation.save();
        await conversation.populate([
            { path: 'buyerId', select: 'fullName phoneNumber accountType' },
            { path: 'sellerId', select: 'fullName phoneNumber accountType' },
            { path: 'productId', select: 'name images' }
        ]);
    }

    res.json({ 
        success: true, 
        message: "Conversation retrieved/created successfully.", 
        data: conversation 
    });
}));

// Get conversations by user role
router.get('/conversations/user/:userId', asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { role } = req.query;

    if (!role || !['buyer', 'seller'].includes(role)) {
        return res.status(400).json({
            success: false,
            message: "Role parameter is required (buyer or seller)."
        });
    }

    const query = role === 'buyer' ? { buyerId: userId } : { sellerId: userId };

    const conversations = await Conversation.find(query)
        .populate([
            { path: 'buyerId', select: 'fullName phoneNumber accountType' },
            { path: 'sellerId', select: 'fullName phoneNumber accountType' },
            { path: 'productId', select: 'name images' },
            { path: 'lastMessage.sender', select: 'fullName' }
        ])
        .sort({ updatedAt: -1 });

    const formattedConversations = conversations.map(conv => {
        const participant = role === 'buyer' ? conv.sellerId : conv.buyerId;

        return {
            _id: conv._id,
            participant: participant,
            product: conv.productId,
            lastMessage: conv.lastMessage,
            unreadCount: conv.unreadCounts.get(userId) || 0,
            updatedAt: conv.updatedAt,
            createdAt: conv.createdAt,
            buyerId: conv.buyerId?._id || conv.buyerId,
            sellerId: conv.sellerId?._id || conv.sellerId,
            currentUserRole: role,
            otherUserRole: role === 'buyer' ? 'seller' : 'buyer'
        };
    });

    res.json({ 
        success: true, 
        message: `Conversations retrieved successfully for role: ${role}.`, 
        data: formattedConversations 
    });
}));

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
        data: messages.reverse()
    });
}));

// ============================================================================
// MESSAGE ROUTES with Cloudinary
// ============================================================================

// Create message placeholder (before upload)
router.post('/placeholder', asyncHandler(async (req, res) => {
    const { 
        conversationId, 
        senderId, 
        messageType,
        caption,
        replyToMessageId
    } = req.body;

    if (!conversationId || !senderId || !messageType) {
        return res.status(400).json({ 
            success: false, 
            message: "conversationId, senderId, and messageType are required." 
        });
    }

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

    const validation = conversation.validateUserPermission(senderId);
    if (!validation.valid) {
        return res.status(403).json({ 
            success: false, 
            message: validation.error 
        });
    }

    try {
        const messageData = {
            conversationId,
            sender: senderId,
            messageType,
            content: {
                ...(caption && caption.trim() && { text: caption.trim() })
            },
            status: 'pending',
            metadata: {
                senderRole: validation.role,
                timestamp: new Date()
            }
        };

        if (replyToMessageId) {
            const replyToMessage = await Message.findById(replyToMessageId);
            if (replyToMessage && replyToMessage.conversationId.toString() === conversationId) {
                messageData.replyTo = replyToMessageId;
            }
        }

        const message = new Message(messageData);
        await message.save();
        
        await message.populate([
            { path: 'sender', select: 'fullName' },
            { path: 'replyTo', select: 'content messageType sender createdAt' }
        ]);

        res.json({ 
            success: true, 
            message: "Message placeholder created successfully.", 
            data: {
                messageId: message._id,
                message: message
            }
        });

    } catch (error) {
        console.error('Placeholder creation error:', error);
        res.status(500).json({
            success: false,
            message: "Failed to create message placeholder: " + error.message
        });
    }
}));

// Upload file to Cloudinary and complete message
router.post('/:messageId/upload', 
    uploadMessageAttachments, 
    multerErrorMiddleware,  // Add error middleware
    asyncHandler(async (req, res) => {
        try {
            // Check for multer errors first
            if (handleMulterError(req, res)) return;

            const { messageId } = req.params;
            const message = await Message.findById(messageId);
            
            if (!message) {
                return res.status(404).json({
                    success: false,
                    message: "Message not found."
                });
            }

            if (message.status !== 'pending' && message.status !== 'failed') {
                return res.status(400).json({
                    success: false,
                    message: "Message is not in uploadable state."
                });
            }

            const { voiceDuration, videoDuration, fileName } = req.body;
            const files = req.files || {};

            // Log what we received for debugging
            console.log('Upload request - Message Type:', message.messageType);
            console.log('Upload request - Files:', Object.keys(files));
            console.log('Upload request - Body:', req.body);

            // Validate that we have a file
            const hasFile = Object.keys(files).length > 0;
            if (!hasFile) {
                return res.status(400).json({
                    success: false,
                    message: `No file uploaded. Expected ${message.messageType} file.`
                });
            }

            // Upload to Cloudinary based on message type
            const content = await uploadMessageContent(
                message.messageType, 
                files, 
                {
                    voiceDuration,
                    videoDuration,
                    fileName,
                    existingText: message.content?.text
                }
            );

            if (!content) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid file upload for the specified message type."
                });
            }

            // Update message with Cloudinary URLs
            message.content = { ...message.content, ...content };
            message.status = 'sent';
            await message.save();

            await message.populate([
                { path: 'sender', select: 'fullName' },
                { path: 'replyTo', select: 'content messageType sender createdAt' }
            ]);

            // Update conversation
            const conversation = await Conversation.findById(message.conversationId).populate([
                { path: 'buyerId', select: 'fullName phoneNumber accountType' },
                { path: 'sellerId', select: 'fullName phoneNumber accountType' }
            ]);
            
            await updateConversationLastMessage(
                conversation, 
                message, 
                message.sender._id || message.sender
            );

            // Emit via socket
            const socketPayload = {
                messageId: message._id,
                conversationId: message.conversationId,
                senderId: message.sender._id,
                messageType: message.messageType,
                content: message.content,
                timestamp: message.createdAt,
                status: 'sent',
                roleContext: {
                    senderRole: message.metadata?.senderRole,
                    buyerId: conversation.buyerId?._id || conversation.buyerId,
                    sellerId: conversation.sellerId?._id || conversation.sellerId
                }
            };

            await emitToParticipants(conversation, socketPayload);

            res.json({ 
                success: true, 
                message: "File uploaded to Cloudinary and message sent successfully.", 
                data: message 
            });

        } catch (error) {
            console.error('Upload processing error:', error);
            
            // Try to update message status to failed
            try {
                const message = await Message.findById(req.params.messageId);
                if (message) {
                    message.status = 'failed';
                    await message.save();
                }
            } catch (updateError) {
                console.error('Failed to update message status:', updateError);
            }

            res.status(500).json({
                success: false,
                message: "Failed to process upload: " + error.message,
                error: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
    })
);

// Send text message
router.post('/text', asyncHandler(async (req, res) => {
    const { conversationId, senderId, text, replyToMessageId } = req.body;

    if (!conversationId || !senderId || !text || text.trim() === '') {
        return res.status(400).json({ 
            success: false, 
            message: "conversationId, senderId, and text are required." 
        });
    }

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

    const validation = conversation.validateUserPermission(senderId);
    if (!validation.valid) {
        return res.status(403).json({ 
            success: false, 
            message: validation.error 
        });
    }

    try {
        const messageData = {
            conversationId,
            sender: senderId,
            messageType: 'text',
            content: { text: text.trim() },
            status: 'sent',
            metadata: {
                senderRole: validation.role,
                timestamp: new Date()
            }
        };

        if (replyToMessageId) {
            const replyToMessage = await Message.findById(replyToMessageId);
            if (replyToMessage && replyToMessage.conversationId.toString() === conversationId) {
                messageData.replyTo = replyToMessageId;
            }
        }

        const message = new Message(messageData);
        await message.save();
        
        await message.populate([
            { path: 'sender', select: 'fullName' },
            { path: 'replyTo', select: 'content messageType sender createdAt' }
        ]);

        await updateConversationLastMessage(conversation, message, senderId);

        const socketPayload = {
            messageId: message._id,
            conversationId: message.conversationId,
            senderId: message.sender._id,
            messageType: message.messageType,
            content: message.content,
            timestamp: message.createdAt,
            status: 'sent',
            roleContext: {
                senderRole: validation.role,
                buyerId: conversation.buyerId?._id || conversation.buyerId,
                sellerId: conversation.sellerId?._id || conversation.sellerId
            }
        };

        await emitToParticipants(conversation, socketPayload);

        res.json({ 
            success: true, 
            message: "Text message sent successfully.", 
            data: message 
        });

    } catch (error) {
        console.error('Text message creation error:', error);
        res.status(500).json({
            success: false,
            message: "Failed to send text message: " + error.message
        });
    }
}));

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

async function uploadMessageContent(messageType, files, additionalData) {
    const { voiceDuration, videoDuration, fileName, existingText } = additionalData;

    switch (messageType) {
        case 'image':
            if (!files.image || files.image.length === 0) {
                throw new Error('Image file is required');
            }
            const imageFile = files.image[0];
            const imageResult = await uploadMessageImage(imageFile.buffer, imageFile.originalname);
            
            return {
                imageUrl: imageResult.url,
                publicId: imageResult.publicId,
                fileName: imageFile.originalname,
                fileSize: formatFileSize(imageResult.size),
                mimeType: imageFile.mimetype,
                ...(existingText && { text: existingText })
            };

        case 'video':
            if (!files.video || files.video.length === 0) {
                throw new Error('Video file is required');
            }
            const videoFile = files.video[0];
            const videoResult = await uploadMessageVideo(videoFile.buffer, videoFile.originalname);
            
            return {
                videoUrl: videoResult.url,
                publicId: videoResult.publicId,
                fileName: videoFile.originalname,
                fileSize: formatFileSize(videoResult.size),
                mimeType: videoFile.mimetype,
                videoDuration: videoResult.duration || parseInt(videoDuration) || 0,
                ...(existingText && { text: existingText })
            };

        case 'voice':
            if (!files.voice || files.voice.length === 0) {
                throw new Error('Voice file is required');
            }
            const voiceFile = files.voice[0];
            const voiceResult = await uploadMessageVoice(voiceFile.buffer, voiceFile.originalname);
            
            return {
                voiceUrl: voiceResult.url,
                publicId: voiceResult.publicId,
                fileName: voiceFile.originalname,
                fileSize: formatFileSize(voiceResult.size),
                mimeType: voiceFile.mimetype,
                voiceDuration: voiceResult.duration || parseInt(voiceDuration) || 0
            };

        case 'document':
            if (!files.document || files.document.length === 0) {
                throw new Error('Document file is required');
            }
            const docFile = files.document[0];
            const docResult = await uploadMessageDocument(docFile.buffer, docFile.originalname);
            
            return {
                documentUrl: docResult.url,
                publicId: docResult.publicId,
                fileName: fileName || docFile.originalname,
                fileSize: formatFileSize(docResult.size),
                mimeType: docFile.mimetype,
                fileExtension: docResult.format
            };

        default:
            throw new Error('Unsupported message type: ' + messageType);
    }
}

async function updateConversationLastMessage(conversation, message, senderId) {
    try {
        let receiverId;
        if (conversation.buyerId && conversation.sellerId) {
            const senderIdStr = senderId.toString();
            const buyerIdStr = (conversation.buyerId._id || conversation.buyerId).toString();
            const sellerIdStr = (conversation.sellerId._id || conversation.sellerId).toString();
            
            receiverId = senderIdStr === buyerIdStr ? sellerIdStr : buyerIdStr;
        }
        
        if (receiverId) {
            const currentUnreadCount = conversation.unreadCounts.get(receiverId.toString()) || 0;
            conversation.unreadCounts.set(receiverId.toString(), currentUnreadCount + 1);
        }
        
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

        let senderObjectId;
        if (typeof message.sender === 'string') {
            senderObjectId = message.sender;
        } else if (message.sender && typeof message.sender === 'object' && message.sender._id) {
            senderObjectId = message.sender._id.toString();
        } else {
            senderObjectId = senderId.toString();
        }

        conversation.lastMessage = {
            text: previewText,
            sender: senderObjectId,
            timestamp: new Date(),
            messageType: message.messageType
        };
        
        conversation.updatedAt = new Date();
        await conversation.save();
        
    } catch (error) {
        console.error('Error updating conversation:', error);
        throw error;
    }
}

async function emitToParticipants(conversation, payload) {
    try {
        const socketIO = getIO();
        if (!socketIO) {
            console.warn('Socket.IO not available');
            return;
        }

        if (conversation.buyerId) {
            const buyerSocketId = conversation.buyerId._id || conversation.buyerId;
            socketIO.to(buyerSocketId.toString()).emit('send_message', payload);
        }
        
        if (conversation.sellerId) {
            const sellerSocketId = conversation.sellerId._id || conversation.sellerId;
            socketIO.to(sellerSocketId.toString()).emit('send_message', payload);
        }
        
    } catch (socketError) {
        console.error('Socket emission error:', socketError);
    }
}

// Mark messages as read
router.put('/conversations/:conversationId/read', asyncHandler(async (req, res) => {
    const { conversationId } = req.params;
    const { userId } = req.body;

    await Message.updateMany(
        {
            conversationId,
            sender: { $ne: userId },
            status: { $ne: 'read' }
        },
        { status: 'read' }
    );

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

    const conversation = await Conversation.findById(message.conversationId);
    if (!conversation) {
        return res.status(404).json({ 
            success: false, 
            message: "Conversation not found." 
        });
    }

    const validation = conversation.validateUserPermission(userId);
    if (!validation.valid) {
        return res.status(403).json({ 
            success: false, 
            message: "Unauthorized to delete this message." 
        });
    }

    if (!message.deletedBy.includes(userId)) {
        message.deletedBy.push(userId);
    }

    const totalParticipants = conversation.participants?.length || 2;

    if (message.deletedBy.length >= totalParticipants) {
        message.isDeleted = true;
        
        if (message.content?.publicId) {
            try {
                const resourceType = message.messageType === 'video' ? 'video' : 
                                   message.messageType === 'voice' ? 'video' :
                                   message.messageType === 'document' ? 'raw' : 'image';
                await deleteFromCloudinary(message.content.publicId, resourceType);
            } catch (delError) {
                console.error('Could not delete from Cloudinary:', delError);
            }
        }
    }

    await message.save();

    res.json({ 
        success: true, 
        message: "Message deleted successfully." 
    });
}));

module.exports = router;