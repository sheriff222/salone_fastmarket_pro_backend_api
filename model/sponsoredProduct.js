// model/sponsoredProduct.js
const mongoose = require('mongoose');

const sponsoredProductSchema = new mongoose.Schema({
    productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    sponsorshipType: {
        type: String,
        required: true,
        enum: ['basic', 'premium', 'featured'],
        default: 'basic'
    },
    startDate: {
        type: Date,
        required: true
    },
    endDate: {
        type: Date,
        required: true
    },
    budget: {
        type: Number,
        required: true,
        min: 0
    },
    dailyCost: {
        type: Number,
        required: true,
        min: 0
    },
    totalSpent: {
        type: Number,
        default: 0,
        min: 0
    },
    priority: {
        type: Number,
        required: true,
        min: 1,
        max: 10,
        default: 5
    },
    isActive: {
        type: Boolean,
        default: true
    },
    status: {
        type: String,
        enum: ['scheduled', 'active', 'paused', 'completed', 'cancelled'],
        default: 'scheduled'
    },
    targetAudience: {
        ageRange: {
            min: { type: Number, min: 13, max: 100 },
            max: { type: Number, min: 13, max: 100 }
        },
        location: {
            districts: [String], // Sierra Leone districts
            regions: [String]   // Western, Northern, Southern, Eastern
        },
        interests: [String],
       deviceTypes: {
    type: [String],
    enum: ['mobile', 'tablet', 'desktop'],
    default: ['mobile', 'tablet', 'desktop'],
    validate: {
        validator: function(values) {
            return values.every(value => 
                ['mobile', 'tablet', 'desktop'].includes(value.toLowerCase())
            );
        },
        message: props => `${props.value} contains invalid device types. Allowed values are: mobile, tablet, desktop.`
    },
    set: function(values) {
        // Normalize to lowercase before saving
        return values.map(value => value.toLowerCase());
    }
}
    },
    displaySettings: {
        showInFeed: { type: Boolean, default: true },
        showInSearch: { type: Boolean, default: true },
        showInCategory: { type: Boolean, default: true },
        boostInRanking: { type: Boolean, default: true }
    },
    analytics: {
        totalViews: { type: Number, default: 0 },
        totalClicks: { type: Number, default: 0 },
        totalConversions: { type: Number, default: 0 },
        ctr: { type: Number, default: 0 }, // Click-through rate
        conversionRate: { type: Number, default: 0 },
        roi: { type: Number, default: 0 }, // Return on investment
        dailyStats: [{
            date: Date,
            views: { type: Number, default: 0 },
            clicks: { type: Number, default: 0 },
            conversions: { type: Number, default: 0 },
            spent: { type: Number, default: 0 }
        }]
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    notes: {
        type: String,
        maxLength: 500
    }
}, {
    timestamps: true,
    collection: 'sponsored_products'
});

// Indexes for performance
sponsoredProductSchema.index({ productId: 1 });
sponsoredProductSchema.index({ status: 1, isActive: 1 });
sponsoredProductSchema.index({ startDate: 1, endDate: 1 });
sponsoredProductSchema.index({ priority: -1 });
sponsoredProductSchema.index({ createdBy: 1 });

// Virtual for calculating days remaining
sponsoredProductSchema.virtual('daysRemaining').get(function() {
    if (this.endDate) {
        const today = new Date();
        const timeDiff = this.endDate - today;
        const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));
        return Math.max(0, daysDiff);
    }
    return 0;
});

// Virtual for calculating total duration
sponsoredProductSchema.virtual('totalDuration').get(function() {
    if (this.startDate && this.endDate) {
        const timeDiff = this.endDate - this.startDate;
        return Math.ceil(timeDiff / (1000 * 3600 * 24));
    }
    return 0;
});

// Method to check if sponsorship is currently active
sponsoredProductSchema.methods.isCurrentlyActive = function() {
    const now = new Date();
    return this.isActive && 
           this.status === 'active' && 
           this.startDate <= now && 
           this.endDate >= now &&
           this.totalSpent < this.budget;
};

// Method to update analytics
sponsoredProductSchema.methods.updateAnalytics = function(action, value = 1) {
    switch(action) {
        case 'view':
            this.analytics.totalViews += value;
            break;
        case 'click':
            this.analytics.totalClicks += value;
            break;
        case 'conversion':
            this.analytics.totalConversions += value;
            break;
    }
    
    // Calculate CTR and conversion rate
    if (this.analytics.totalViews > 0) {
        this.analytics.ctr = (this.analytics.totalClicks / this.analytics.totalViews * 100);
        this.analytics.conversionRate = (this.analytics.totalConversions / this.analytics.totalViews * 100);
    }
    
    // Calculate ROI (assuming conversion value)
    if (this.totalSpent > 0) {
        const estimatedRevenue = this.analytics.totalConversions * (this.productId?.price || 0);
        this.analytics.roi = ((estimatedRevenue - this.totalSpent) / this.totalSpent * 100);
    }
};

// Pre-save middleware to update status based on dates
sponsoredProductSchema.pre('save', function(next) {
    const now = new Date();
    
    if (this.startDate > now) {
        this.status = 'scheduled';
    } else if (this.startDate <= now && this.endDate >= now && this.isActive) {
        this.status = 'active';
    } else if (this.endDate < now) {
        this.status = 'completed';
        this.isActive = false;
    }
    
    next();
});

// Static method to get active sponsored products
sponsoredProductSchema.statics.getActiveSponsored = function(options = {}) {
    const now = new Date();
    const query = {
        isActive: true,
        status: 'active',
        startDate: { $lte: now },
        endDate: { $gte: now },
        $expr: { $lt: ['$totalSpent', '$budget'] }
    };
    
    return this.find(query)
        .populate('productId')
        .sort({ priority: -1, createdAt: -1 })
        .limit(options.limit || 50);
};

// Static method for bulk operations
sponsoredProductSchema.statics.bulkUpdateStatus = function(productIds, status, isActive) {
    return this.updateMany(
        { productId: { $in: productIds } },
        { 
            $set: { 
                status: status,
                isActive: isActive,
                updatedAt: new Date()
            }
        }
    );
};

const SponsoredProduct = mongoose.model('SponsoredProduct', sponsoredProductSchema);
module.exports = SponsoredProduct;