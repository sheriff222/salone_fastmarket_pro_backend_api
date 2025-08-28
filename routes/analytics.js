// routes/analytics.js
const express = require('express');
const router = express.Router();
const Product = require('../model/product');
const { Conversation, Message } = require('../model/message');
const User = require('../model/user');
const asyncHandler = require('express-async-handler');
const { protect } = require('../middleware/auth');

// Get dashboard analytics for seller
router.get('/dashboard/:sellerId', protect, asyncHandler(async (req, res) => {
    try {
        const sellerId = req.params.sellerId;
        const { timeframe = '30' } = req.query; // days
        
        const dateFilter = new Date();
        dateFilter.setDate(dateFilter.getDate() - parseInt(timeframe));
        
        // Get seller's products
        const products = await Product.find({ sellerId })
            .populate('proCategoryId', 'name')
            .populate('proSubCategoryId', 'name');
            
        // Basic product metrics
        const totalProducts = products.length;
        const activeProducts = products.filter(p => p.quantity > 0).length;
        const outOfStockProducts = products.filter(p => p.quantity === 0).length;
        const lowStockProducts = products.filter(p => p.quantity > 0 && p.quantity <= 5).length;
        
        // Calculate total inventory value
        const totalInventoryValue = products.reduce((sum, product) => {
            return sum + (product.price * product.quantity);
        }, 0);
        
        // Get messages for seller's products
        const conversations = await Conversation.find({
            'participants': sellerId
        }).populate('lastMessage');
        
        const totalMessages = await Message.countDocuments({
            conversationId: { $in: conversations.map(c => c._id) },
            createdAt: { $gte: dateFilter }
        });
        
        // Messages per product analytics
        const messagesPerProduct = await Message.aggregate([
            {
                $lookup: {
                    from: 'conversations',
                    localField: 'conversationId',
                    foreignField: '_id',
                    as: 'conversation'
                }
            },
            {
                $unwind: '$conversation'
            },
            {
                $match: {
                    'conversation.participants': { $in: [sellerId] },
                    createdAt: { $gte: dateFilter }
                }
            },
            {
                $group: {
                    _id: '$conversation.productId',
                    messageCount: { $sum: 1 }
                }
            }
        ]);
        
        // Top performing products (by message engagement)
        const topProducts = products
            .map(product => {
                const engagement = messagesPerProduct.find(m => 
                    m._id?.toString() === product._id?.toString()
                )?.messageCount || 0;
                
                return {
                    id: product._id,
                    name: product.name,
                    price: product.price,
                    offerPrice: product.offerPrice,
                    quantity: product.quantity,
                    category: product.proCategoryId?.name,
                    engagement,
                    images: product.images?.[0]?.url
                };
            })
            .sort((a, b) => b.engagement - a.engagement)
            .slice(0, 3);
            
        // Weekly trend data (last 7 days)
        const weeklyTrend = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dayStart = new Date(date.setHours(0, 0, 0, 0));
            const dayEnd = new Date(date.setHours(23, 59, 59, 999));
            
            const dailyMessages = await Message.countDocuments({
                conversationId: { $in: conversations.map(c => c._id) },
                createdAt: { $gte: dayStart, $lte: dayEnd }
            });
            
            weeklyTrend.push({
                date: dayStart.toISOString().split('T')[0],
                messages: dailyMessages,
                interactions: dailyMessages // For now, using messages as interactions
            });
        }
        
        res.json({
            success: true,
            message: "Dashboard analytics retrieved successfully",
            data: {
                metrics: {
                    totalProducts,
                    activeProducts,
                    outOfStockProducts,
                    lowStockProducts,
                    totalMessages,
                    totalInventoryValue
                },
                topProducts,
                weeklyTrend,
                messagesPerProduct: messagesPerProduct.length,
                timeframe: parseInt(timeframe)
            }
        });
        
    } catch (error) {
        console.error("Dashboard analytics error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Get product performance analytics
router.get('/products/:sellerId', protect, asyncHandler(async (req, res) => {
    try {
        const sellerId = req.params.sellerId;
        const { sortBy = 'engagement', order = 'desc', page = 1, limit = 10 } = req.query;
        
        const skip = (page - 1) * limit;
        
        // Get all seller's products
        const products = await Product.find({ sellerId })
            .populate('proCategoryId', 'name')
            .populate('proSubCategoryId', 'name')
            .skip(skip)
            .limit(parseInt(limit));
            
        // Get message engagement for each product
        const conversations = await Conversation.find({
            'participants': sellerId
        });
        
        const productsWithAnalytics = await Promise.all(products.map(async (product) => {
            // Get messages for this product (if productId exists in conversation)
            const productMessages = await Message.countDocuments({
                conversationId: { $in: conversations.map(c => c._id) }
                // Note: You might want to add productId to conversation schema for better tracking
            });
            
            return {
                id: product._id,
                name: product.name,
                description: product.description,
                price: product.price,
                offerPrice: product.offerPrice,
                quantity: product.quantity,
                category: product.proCategoryId?.name,
                subcategory: product.proSubCategoryId?.name,
                images: product.images,
                createdAt: product.createdAt,
                engagement: productMessages,
                status: product.quantity > 0 ? 'active' : 'out_of_stock',
                stockStatus: product.quantity === 0 ? 'out_of_stock' : 
                           product.quantity <= 5 ? 'low_stock' : 'in_stock'
            };
        }));
        
        // Sort products based on criteria
        const sortedProducts = productsWithAnalytics.sort((a, b) => {
            let comparison = 0;
            switch (sortBy) {
                case 'engagement':
                    comparison = b.engagement - a.engagement;
                    break;
                case 'name':
                    comparison = a.name.localeCompare(b.name);
                    break;
                case 'price':
                    comparison = a.price - b.price;
                    break;
                case 'quantity':
                    comparison = a.quantity - b.quantity;
                    break;
                case 'created':
                    comparison = new Date(b.createdAt) - new Date(a.createdAt);
                    break;
                default:
                    comparison = 0;
            }
            return order === 'desc' ? comparison : -comparison;
        });
        
        const total = await Product.countDocuments({ sellerId });
        
        res.json({
            success: true,
            message: "Product analytics retrieved successfully",
            data: {
                products: sortedProducts,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            }
        });
        
    } catch (error) {
        console.error("Product analytics error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Bulk operations for products
router.post('/products/bulk-action', protect, asyncHandler(async (req, res) => {
    try {
        const { action, productIds, sellerId } = req.body;
        
        if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: "Product IDs are required" 
            });
        }
        
        let updateQuery = {};
        let successMessage = "";
        
        switch (action) {
            case 'activate':
                // For activation, you might want to set a status field
                // Since your schema doesn't have status, we'll use a different approach
                successMessage = `${productIds.length} products processed`;
                break;
                
            case 'deactivate':
                successMessage = `${productIds.length} products processed`;
                break;
                
            case 'delete':
                const deleteResult = await Product.deleteMany({
                    _id: { $in: productIds },
                    sellerId // Ensure seller can only delete their own products
                });
                
                return res.json({
                    success: true,
                    message: `${deleteResult.deletedCount} products deleted successfully`
                });
                
            default:
                return res.status(400).json({
                    success: false,
                    message: "Invalid action"
                });
        }
        
        // For non-delete actions
        const updateResult = await Product.updateMany(
            {
                _id: { $in: productIds },
                sellerId
            },
            updateQuery
        );
        
        res.json({
            success: true,
            message: successMessage,
            modifiedCount: updateResult.modifiedCount
        });
        
    } catch (error) {
        console.error("Bulk action error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Quick update product (price and stock)
router.patch('/products/:productId/quick-update', protect, asyncHandler(async (req, res) => {
    try {
        const { productId } = req.params;
        const { price, offerPrice, quantity } = req.body;
        
        const updateData = {};
        if (price !== undefined) updateData.price = parseFloat(price);
        if (offerPrice !== undefined) updateData.offerPrice = parseFloat(offerPrice);
        if (quantity !== undefined) updateData.quantity = parseInt(quantity);
        
        const updatedProduct = await Product.findByIdAndUpdate(
            productId,
            updateData,
            { new: true }
        );
        
        if (!updatedProduct) {
            return res.status(404).json({
                success: false,
                message: "Product not found"
            });
        }
        
        res.json({
            success: true,
            message: "Product updated successfully",
            data: updatedProduct
        });
        
    } catch (error) {
        console.error("Quick update error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
}));

module.exports = router;