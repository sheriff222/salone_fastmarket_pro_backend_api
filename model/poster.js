// model/poster.js - Complete new schema
const mongoose = require('mongoose');

const posterImageSchema = new mongoose.Schema({
    url: {
        type: String,
        required: true
    },
    filename: {
        type: String,
        required: true
    },
    order: {
        type: Number,
        required: true,
        min: 0,
        max: 4 // 5 images max (0-4)
    },
    alt: {
        type: String,
        default: ''
    }
}, { _id: true });

const posterSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Poster title is required'],
        trim: true,
        maxlength: [100, 'Title cannot exceed 100 characters']
    },
    description: {
        type: String,
        trim: true,
        maxlength: [500, 'Description cannot exceed 500 characters']
    },
    type: {
        type: String,
        required: true,
        enum: ['product', 'seller'],
        default: 'product'
    },
    // For product posters - single product
    targetProductId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: function() { return this.type === 'product'; }
    },
    // For seller posters - all products from seller
    targetSellerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: function() { return this.type === 'seller'; }
    },
    images: {
        type: [posterImageSchema],
        validate: {
            validator: function(v) {
                return v && v.length >= 1 && v.length <= 5;
            },
            message: 'Poster must have between 1 and 5 images'
        }
    },
    // Scheduling
    startDate: {
        type: Date,
        required: true,
        default: Date.now
    },
    endDate: {
        type: Date,
        required: true,
        validate: {
            validator: function(v) {
                return v > this.startDate;
            },
            message: 'End date must be after start date'
        }
    },
    isActive: {
        type: Boolean,
        default: true
    },
    priority: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    // Analytics
    viewCount: {
        type: Number,
        default: 0
    },
    clickCount: {
        type: Number,
        default: 0
    },
    // Creator info
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, { 
    timestamps: true,
    collection: 'posters_v2'
});

// Indexes for performance
posterSchema.index({ isActive: 1, priority: -1, startDate: 1 });
posterSchema.index({ type: 1, targetProductId: 1 });
posterSchema.index({ type: 1, targetSellerId: 1 });
posterSchema.index({ startDate: 1, endDate: 1 });
posterSchema.index({ createdAt: -1 });

// Virtual for checking if poster is currently active
posterSchema.virtual('isCurrentlyActive').get(function() {
    const now = new Date();
    return this.isActive && 
           this.startDate <= now && 
           this.endDate >= now;
});

// Method to increment view count
posterSchema.methods.incrementViewCount = function() {
    return this.model('Poster').updateOne(
        { _id: this._id },
        { $inc: { viewCount: 1 } }
    );
};

// Method to increment click count
posterSchema.methods.incrementClickCount = function() {
    return this.model('Poster').updateOne(
        { _id: this._id },
        { $inc: { clickCount: 1 } }
    );
};

// Static method to get active posters
posterSchema.statics.getActivePosters = function() {
    const now = new Date();
    return this.find({
        isActive: true,
        startDate: { $lte: now },
        endDate: { $gte: now }
    })
    .populate('targetProductId', 'name price images')
    .populate('targetSellerId', 'fullName businessInfo')
    .sort({ priority: -1, createdAt: -1 });
};

const Poster = mongoose.model('Poster', posterSchema);

// Analytics model for detailed tracking
const posterAnalyticsSchema = new mongoose.Schema({
    posterId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Poster',
        required: true
    },
    event: {
        type: String,
        required: true,
        enum: ['view', 'click', 'conversion']
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    sessionId: {
        type: String
    },
    userAgent: {
        type: String
    },
    ipAddress: {
        type: String
    },
    metadata: {
        imageIndex: Number, // Which image was shown during interaction
        source: String, // 'feed', 'category', etc.
        timestamp: Date
    }
}, { 
    timestamps: true,
    collection: 'poster_analytics'
});

// Indexes for analytics
posterAnalyticsSchema.index({ posterId: 1, event: 1, createdAt: -1 });
posterAnalyticsSchema.index({ userId: 1, createdAt: -1 });
posterAnalyticsSchema.index({ createdAt: -1 });

const PosterAnalytics = mongoose.model('PosterAnalytics', posterAnalyticsSchema);

module.exports = { Poster, PosterAnalytics };