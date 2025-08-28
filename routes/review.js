const express = require('express');
const router = express.Router();
const Review = require('../model/review');
const Product = require('../model/product');
const asyncHandler = require('express-async-handler');

// Get reviews for a product with pagination
router.get('/product/:productId', asyncHandler(async (req, res) => {
    const { page = 1, limit = 5 } = req.query;
    const skip = (page - 1) * limit;
    
    const reviews = await Review.find({ productId: req.params.productId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));
    
    const totalReviews = await Review.countDocuments({ productId: req.params.productId });
    const hasMore = skip + reviews.length < totalReviews;
    
    // Calculate average rating
    const avgRating = totalReviews > 0 
        ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
        : 0;
    
    // Calculate rating distribution
    const ratingDistribution = await Review.aggregate([
        { $match: { productId: req.params.productId } },
        { $group: { _id: '$rating', count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
    ]);
    
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    ratingDistribution.forEach(item => {
        distribution[item._id] = item.count;
    });
    
    res.json({ 
        success: true, 
        data: { 
            reviews, 
            avgRating: Math.round(avgRating * 10) / 10,
            totalReviews,
            ratingDistribution: distribution
        },
        hasMore
    });
}));

// Add/Update review
router.post('/', asyncHandler(async (req, res) => {
    const { userId, productId, rating, comment, buyerName } = req.body;
    
    if (!userId || !productId || !rating || !comment || !buyerName) {
        return res.status(400).json({ success: false, message: "All fields required" });
    }
    
    if (rating < 1 || rating > 5) {
        return res.status(400).json({ success: false, message: "Rating must be between 1 and 5" });
    }
    
    if (comment.length < 10 || comment.length > 500) {
        return res.status(400).json({ success: false, message: "Comment must be between 10 and 500 characters" });
    }
    
    const existingReview = await Review.findOne({ userId, productId });
    
    if (existingReview) {
        // Update existing review
        existingReview.rating = rating;
        existingReview.comment = comment;
        existingReview.buyerName = buyerName;
        await existingReview.save();
        res.json({ success: true, message: "Review updated successfully" });
    } else {
        // Create new review
        const review = new Review({ userId, productId, rating, comment, buyerName });
        await review.save();
        res.json({ success: true, message: "Review added successfully" });
    }
}));

// Get user's review for a product
router.get('/user/:userId/product/:productId', asyncHandler(async (req, res) => {
    const review = await Review.findOne({ 
        userId: req.params.userId, 
        productId: req.params.productId 
    });
    res.json({ success: true, data: review });
}));

// Delete review
router.delete('/:reviewId', asyncHandler(async (req, res) => {
    const review = await Review.findById(req.params.reviewId);
    
    if (!review) {
        return res.status(404).json({ success: false, message: "Review not found" });
    }
    
    await Review.findByIdAndDelete(req.params.reviewId);
    res.json({ success: true, message: "Review deleted successfully" });
}));

// Get similar products
router.get('/similar/:productId', asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.productId);
    if (!product) {
        return res.status(404).json({ success: false, message: "Product not found" });
    }
    
    // Get products from same subcategory first, then category
    let similarProducts = await Product.find({
        _id: { $ne: req.params.productId },
        proSubCategoryId: product.proSubCategoryId,
        quantity: { $gt: 0 } // Only in-stock products
    }).limit(10).sort({ createdAt: -1 });
    
    // If not enough from subcategory, fill with category products
    if (similarProducts.length < 10) {
        const categoryProducts = await Product.find({
            _id: { $ne: req.params.productId, $nin: similarProducts.map(p => p._id) },
            proCategoryId: product.proCategoryId,
            quantity: { $gt: 0 }
        }).limit(10 - similarProducts.length).sort({ createdAt: -1 });
        
        similarProducts = [...similarProducts, ...categoryProducts];
    }
    
    // Add average ratings for each product
    for (let prod of similarProducts) {
        const reviews = await Review.find({ productId: prod._id });
        const avgRating = reviews.length > 0 
            ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
            : 0;
        prod._doc.avgRating = Math.round(avgRating * 10) / 10;
        prod._doc.reviewCount = reviews.length;
    }
    
    res.json({ success: true, data: similarProducts });
}));

// Get review statistics for a product
router.get('/stats/:productId', asyncHandler(async (req, res) => {
    const reviews = await Review.find({ productId: req.params.productId });
    
    if (reviews.length === 0) {
        return res.json({
            success: true,
            data: {
                avgRating: 0,
                totalReviews: 0,
                ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
            }
        });
    }
    
    const avgRating = reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length;
    
    const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    reviews.forEach(review => {
        ratingDistribution[review.rating]++;
    });
    
    res.json({
        success: true,
        data: {
            avgRating: Math.round(avgRating * 10) / 10,
            totalReviews: reviews.length,
            ratingDistribution
        }
    });
}));

module.exports = router;