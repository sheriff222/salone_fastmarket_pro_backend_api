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
        required: true,
        index: true // Add index for faster queries
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
        sessionId: String,
        isSponsored: { type: Boolean, default: false },
        sponsorshipId: String
    },
    timestamp: {
        type: Date,
        default: Date.now,
        index: true // Index for time-based queries
    },
    ipAddress: {
        type: String,
        required: false
    },
    userAgent: {
        type: String,
        required: false
    }
}, {
    timestamps: true,
    collection: 'analytics_events'
});

// CRITICAL INDEXES FOR PERFORMANCE
// Compound index for user analytics queries
analyticsEventSchema.index({ userId: 1, timestamp: -1 });

// Compound index for product analytics queries
analyticsEventSchema.index({ productId: 1, action: 1, timestamp: -1 });

// Index for action-based queries
analyticsEventSchema.index({ action: 1, timestamp: -1 });

// Index for time-based queries
analyticsEventSchema.index({ timestamp: -1 });

// Index for IP-based rate limiting
analyticsEventSchema.index({ ipAddress: 1, timestamp: -1 });

// TTL index to auto-delete old analytics (90 days)
analyticsEventSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7776000 }); // 90 days

// Static method to clean up old events manually (backup)
analyticsEventSchema.statics.cleanupOldEvents = async function(daysToKeep = 90) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    const result = await this.deleteMany({
        timestamp: { $lt: cutoffDate }
    });
    
    console.log(`🧹 Cleaned up ${result.deletedCount} old analytics events`);
    return result;
};

// Instance method to validate metadata
analyticsEventSchema.methods.validateMetadata = function() {
    if (this.action === 'search' && !this.metadata.searchQuery) {
        throw new Error('Search query required for search action');
    }
    return true;
};

module.exports = mongoose.model('AnalyticsEvent', analyticsEventSchema);