// model/analytics.js
const mongoose = require('mongoose');

const analyticsEventSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false // Allow anonymous tracking
    },
    productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    action: {
        type: String,
        required: true,
        enum: ['view', 'click', 'add_to_cart', 'remove_from_cart', 'purchase', 'favorite', 'unfavorite', 'share', 'search']
    },
    metadata: {
        // Additional context data
        source: String, // 'feed', 'search', 'category', 'recommendation'
        position: Number, // Position in list/grid
        searchQuery: String,
        categoryId: String,
        referrer: String,
        sessionId: String
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
    ipAddress: String,
    userAgent: String
}, {
    timestamps: true,
    // Add indexes for common queries
    collection: 'analytics_events'
});

// Indexes for performance
analyticsEventSchema.index({ userId: 1, timestamp: -1 });
analyticsEventSchema.index({ productId: 1, timestamp: -1 });
analyticsEventSchema.index({ action: 1, timestamp: -1 });
analyticsEventSchema.index({ timestamp: -1 });

module.exports = mongoose.model('AnalyticsEvent', analyticsEventSchema);

// routes/favorites.js - Enhanced version