
const express = require('express');
const router = express.Router();
const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const AnalyticsEvent = require('../model/analytics');

// Favorite model
const favoriteSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    addedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Compound index to prevent duplicates and optimize queries
favoriteSchema.index({ userId: 1, productId: 1 }, { unique: true });
favoriteSchema.index({ userId: 1, addedAt: -1 });

const Favorite = mongoose.model('Favorite', favoriteSchema);

/**
 * @route   POST /api/favorites/toggle
 * @desc    Toggle favorite status (add/remove)
 * @access  Public (with userId in body)
 */
router.post('/toggle', asyncHandler(async (req, res) => {
    const { userId, productId } = req.body;

    if (!userId || !productId) {
        return res.status(400).json({
            success: false,
            message: "User ID and Product ID are required"
        });
    }

    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({
            success: false,
            message: "Invalid User ID or Product ID format"
        });
    }

    try {
        const existingFavorite = await Favorite.findOne({ userId, productId });

        if (existingFavorite) {
            // Remove from favorites
            await Favorite.deleteOne({ userId, productId });

            // Track analytics
            await trackFavoriteEvent(userId, productId, 'unfavorite');

            res.json({
                success: true,
                message: "Product removed from favorites",
                data: {
                    isFavorite: false,
                    action: 'removed'
                }
            });
        } else {
            // Add to favorites
            const newFavorite = new Favorite({ userId, productId });
            await newFavorite.save();

            // Track analytics
            await trackFavoriteEvent(userId, productId, 'favorite');

            res.json({
                success: true,
                message: "Product added to favorites",
                data: {
                    isFavorite: true,
                    action: 'added'
                }
            });
        }
    } catch (error) {
        console.error('Favorite toggle error:', error);
        
        if (error.code === 11000) {
            // Duplicate key error - already favorited
            res.json({
                success: true,
                message: "Product already in favorites",
                data: {
                    isFavorite: true,
                    action: 'already_exists'
                }
            });
        } else {
            res.status(500).json({
                success: false,
                message: "Error updating favorite status",
                error: error.message
            });
        }
    }
}));

/**
 * @route   GET /api/favorites/user/:userId
 * @desc    Get user's favorite products
 * @access  Public
 */
router.get('/user/:userId', asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({
            success: false,
            message: "Invalid User ID format"
        });
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    try {
        const favorites = await Favorite.find({ userId })
            .populate({
                path: 'productId',
                populate: [
                    { path: 'proCategoryId', select: 'name' },
                    { path: 'proSubCategoryId', select: 'name' },
                    { path: 'sellerId', select: 'fullName' }
                ]
            })
            .sort({ addedAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .lean();

        const totalFavorites = await Favorite.countDocuments({ userId });

        // Filter out any favorites where the product was deleted
        const validFavorites = favorites
            .filter(fav => fav.productId)
            .map(fav => ({
                ...fav.productId,
                favoritedAt: fav.addedAt
            }));

        res.json({
            success: true,
            message: "Favorites retrieved successfully",
            data: {
                products: validFavorites,
                pagination: {
                    currentPage: pageNum,
                    totalPages: Math.ceil(totalFavorites / limitNum),
                    totalFavorites,
                    hasMore: pageNum * limitNum < totalFavorites
                }
            }
        });

    } catch (error) {
        console.error('Get favorites error:', error);
        res.status(500).json({
            success: false,
            message: "Error retrieving favorites",
            error: error.message
        });
    }
}));

/**
 * @route   GET /api/favorites/check/:userId/:productId
 * @desc    Check if product is favorited by user
 * @access  Public
 */
router.get('/check/:userId/:productId', asyncHandler(async (req, res) => {
    const { userId, productId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({
            success: false,
            message: "Invalid User ID or Product ID format"
        });
    }

    try {
        const favorite = await Favorite.findOne({ userId, productId });

        res.json({
            success: true,
            message: "Favorite status checked",
            data: {
                isFavorite: !!favorite,
                favoritedAt: favorite ? favorite.addedAt : null
            }
        });

    } catch (error) {
        console.error('Check favorite error:', error);
        res.status(500).json({
            success: false,
            message: "Error checking favorite status",
            error: error.message
        });
    }
}));

/**
 * @route   POST /api/favorites/bulk-check
 * @desc    Check favorite status for multiple products
 * @access  Public
 */
router.post('/bulk-check', asyncHandler(async (req, res) => {
    const { userId, productIds } = req.body;

    if (!userId || !Array.isArray(productIds)) {
        return res.status(400).json({
            success: false,
            message: "User ID and product IDs array are required"
        });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({
            success: false,
            message: "Invalid User ID format"
        });
    }

    const validProductIds = productIds.filter(id => mongoose.Types.ObjectId.isValid(id));

    if (validProductIds.length === 0) {
        return res.json({
            success: true,
            message: "No valid product IDs provided",
            data: {}
        });
    }

    try {
        const favorites = await Favorite.find({
            userId,
            productId: { $in: validProductIds }
        }).lean();

        const favoriteMap = {};
        favorites.forEach(fav => {
            favoriteMap[fav.productId.toString()] = {
                isFavorite: true,
                favoritedAt: fav.addedAt
            };
        });

        // Add non-favorite entries
        validProductIds.forEach(id => {
            if (!favoriteMap[id]) {
                favoriteMap[id] = {
                    isFavorite: false,
                    favoritedAt: null
                };
            }
        });

        res.json({
            success: true,
            message: "Bulk favorite status checked",
            data: favoriteMap
        });

    } catch (error) {
        console.error('Bulk check favorites error:', error);
        res.status(500).json({
            success: false,
            message: "Error checking favorite statuses",
            error: error.message
        });
    }
}));

/**
 * @route   DELETE /api/favorites/clear/:userId
 * @desc    Clear all favorites for a user
 * @access  Public
 */
router.delete('/clear/:userId', asyncHandler(async (req, res) => {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({
            success: false,
            message: "Invalid User ID format"
        });
    }

    try {
        const result = await Favorite.deleteMany({ userId });

        res.json({
            success: true,
            message: "All favorites cleared successfully",
            data: {
                deletedCount: result.deletedCount
            }
        });

    } catch (error) {
        console.error('Clear favorites error:', error);
        res.status(500).json({
            success: false,
            message: "Error clearing favorites",
            error: error.message
        });
    }
}));

// Helper function to track favorite events
async function trackFavoriteEvent(userId, productId, action) {
    try {
        const event = new AnalyticsEvent({
            userId,
            productId,
            action,
            metadata: {
                source: 'favorites'
            },
            timestamp: new Date()
        });

        await event.save();
    } catch (error) {
        console.error('Analytics tracking error:', error);
        // Don't throw error - analytics failure shouldn't break the main functionality
    }
}

module.exports = router;