// ============================================================================
// UPDATED MONGOOSE SCHEMAS for Role-Based Messaging
// Update your model/message.js file with these enhanced schemas
// ============================================================================

const mongoose = require('mongoose');

// Enhanced Conversation Schema with Role Support
const conversationSchema = new mongoose.Schema({
    // Legacy field - keep for backward compatibility
    participants: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User',
        required: true 
    }],
    
    // NEW: Explicit role tracking fields
    buyerId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User',
        required: false, // Will become required after migration
        index: true
    },
    sellerId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User',
        required: false, // Will become required after migration
        index: true
    },
    
    // Product reference (helps determine roles)
    productId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Product',
        required: false
    },
    
    // Last message tracking
    lastMessage: {
        text: { type: String, maxlength: 500 },
        sender: { 
            type: mongoose.Schema.Types.ObjectId, 
            ref: 'User' 
        },
        timestamp: { type: Date, default: Date.now },
        messageType: { 
            type: String, 
            enum: ['text', 'image', 'voice', 'video', 'document'],
            default: 'text'
        }
    },
    
    // Unread message counts per user
    unreadCounts: {
        type: Map,
        of: Number,
        default: () => new Map()
    },
    
    // Conversation status
    status: {
        type: String,
        enum: ['active', 'archived', 'blocked'],
        default: 'active'
    },
    
    // Metadata for role-based features
    metadata: {
        createdByRole: { 
            type: String, 
            enum: ['buyer', 'seller'],
            required: false
        },
        conversationType: {
            type: String,
            enum: ['product_inquiry', 'general', 'support'],
            default: 'product_inquiry'
        }
    }
}, { 
    timestamps: true,
    // Add version key for schema migrations
    versionKey: '__v'
});

// Compound indexes for efficient role-based queries
conversationSchema.index({ buyerId: 1, updatedAt: -1 });
conversationSchema.index({ sellerId: 1, updatedAt: -1 });
conversationSchema.index({ buyerId: 1, sellerId: 1, productId: 1 }, { unique: true });
conversationSchema.index({ participants: 1, productId: 1 }); // Legacy support

// Virtual for getting other participant based on current user and role
conversationSchema.virtual('getOtherParticipant').get(function() {
    return function(currentUserId, currentRole) {
        if (currentRole === 'buyer') {
            return this.sellerId;
        } else if (currentRole === 'seller') {
            return this.buyerId;
        } else {
            // Fallback to legacy logic
            return this.participants.find(p => p.toString() !== currentUserId.toString());
        }
    };
});

// Method to get user's role in conversation
conversationSchema.methods.getUserRole = function(userId) {
    const userIdStr = userId.toString();
    if (this.buyerId && this.buyerId.toString() === userIdStr) {
        return 'buyer';
    } else if (this.sellerId && this.sellerId.toString() === userIdStr) {
        return 'seller';
    } else if (this.participants && this.participants.some(p => p.toString() === userIdStr)) {
        return 'unknown'; // Changed from 'participant' to match Message schema enum
    }
    return null;
};

// FIXED: Method to validate user has permission for action
conversationSchema.methods.validateUserPermission = function(userId, requiredRole = null) {
    const userRole = this.getUserRole(userId);
    
    if (!userRole) {
        return { valid: false, error: "User is not a participant in this conversation." };
    }
    
    if (requiredRole && userRole !== requiredRole && userRole !== 'unknown') {
        return { valid: false, error: `User must be a ${requiredRole} for this action.` };
    }
    
    return { valid: true, role: userRole };
};

// Method to validate user has permission for action
conversationSchema.methods.validateUserPermission = function(userId, requiredRole = null) {
    const userRole = this.getUserRole(userId);
    
    if (!userRole) {
        return { valid: false, error: "User is not a participant in this conversation." };
    }
    
    if (requiredRole && userRole !== requiredRole && userRole !== 'participant') {
        return { valid: false, error: `User must be a ${requiredRole} for this action.` };
    }
    
    return { valid: true, role: userRole };
};

// Enhanced Message Schema
const messageSchema = new mongoose.Schema({
    conversationId: { 
        type: String, 
        ref: 'Conversation', 
        required: true,
        index: true
    },
    sender: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true,
        index: true
    },
    messageType: {
        type: String,
        enum: ['text', 'image', 'voice', 'video', 'document'],
        required: true,
        default: 'text'
    },
    
    // Message content based on type
    content: {
        // Text messages
        text: { type: String, maxlength: 2000 },
        
        // Image messages
        imageUrl: String,
        
        // Voice messages
        voiceUrl: String,
        voiceDuration: { type: Number, min: 0 }, // in seconds
        
        // Video messages
        videoUrl: String,
        videoDuration: { type: Number, min: 0 }, // in seconds
        
        // Document messages
        documentUrl: String,
        fileName: String,
        fileSize: String,
        fileExtension: String,
        mimeType: String
    },
    
    // Message status tracking
    status: {
        type: String,
        enum: ['pending', 'sent', 'delivered', 'read', 'failed'],
        default: 'sent'
    },
    
    // Reply functionality
    replyTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message',
        required: false
    },
    
    // Soft delete functionality
    isDeleted: { type: Boolean, default: false },
    deletedBy: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User' 
    }],
    deletedAt: Date,
    
    // NEW: Role and context metadata
    metadata: {
        senderRole: { 
            type: String, 
            enum: ['buyer', 'seller', 'unknown'],
            required: false
        },
        conversationContext: {
            productId: { 
                type: mongoose.Schema.Types.ObjectId, 
                ref: 'Product' 
            },
            isProductInquiry: { type: Boolean, default: false }
        },
        deliveryInfo: {
            deliveredAt: Date,
            readAt: Date,
            deliveryAttempts: { type: Number, default: 0 }
        }
    }
}, { 
    timestamps: true 
});

// Indexes for efficient querying
messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ sender: 1, createdAt: -1 });
messageSchema.index({ conversationId: 1, isDeleted: 1, createdAt: -1 });
messageSchema.index({ status: 1, createdAt: -1 });

// Method to check if message is visible to user (considering soft deletes)
messageSchema.methods.isVisibleTo = function(userId) {
    if (this.isDeleted && this.deletedBy.includes(userId)) {
        return false;
    }
    return true;
};

// User Status Schema (for real-time features)
const userStatusSchema = new mongoose.Schema({
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true,
        unique: true,
        index: true
    },
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },
    socketId: String,
    currentRole: { 
        type: String, 
        enum: ['buyer', 'seller'],
        required: false 
    },
    activeConversations: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Conversation' 
    }]
}, { 
    timestamps: true 
});

userStatusSchema.index({ isOnline: 1, lastSeen: -1 });

// Pre-save middleware to update metadata
conversationSchema.pre('save', function(next) {
    // Update participants array when buyerId/sellerId change
    if (this.isModified('buyerId') || this.isModified('sellerId')) {
        const participants = [];
        if (this.buyerId) participants.push(this.buyerId);
        if (this.sellerId) participants.push(this.sellerId);
        this.participants = participants;
    }
    next();
});

messageSchema.pre('save', function(next) {
    // Set sender role metadata if not already set
    if (!this.metadata?.senderRole && this.conversationId) {
        // This would require populating the conversation to determine role
        // For now, we'll set it in the route handlers
    }
    next();
});

// Create models
const Conversation = mongoose.model('Conversation', conversationSchema);
const Message = mongoose.model('Message', messageSchema);
const UserStatus = mongoose.model('UserStatus', userStatusSchema);

module.exports = {
    Conversation,
    Message,
    UserStatus
};