// model/searchHistory.js
const mongoose = require('mongoose');

const searchHistorySchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null // null for guest searches
    },
    query: {
        type: String,
        required: true,
        trim: true,
        lowercase: true
    },
    resultCount: {
        type: Number,
        default: 0
    },
    isSaved: {
        type: Boolean,
        default: false
    },
    clickedProductId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product'
    },
    searchType: {
        type: String,
        enum: ['manual', 'suggestion', 'recent'],
        default: 'manual'
    }
}, { 
    timestamps: true 
});

// Indexes for better query performance
searchHistorySchema.index({ userId: 1, createdAt: -1 });
searchHistorySchema.index({ query: 1, createdAt: -1 });
searchHistorySchema.index({ isSaved: 1, userId: 1 });
searchHistorySchema.index({ query: 'text' }); // Text index for search

// Compound index for user-specific searches
searchHistorySchema.index({ userId: 1, query: 1 });

const SearchHistory = mongoose.model('SearchHistory', searchHistorySchema);

module.exports = SearchHistory;