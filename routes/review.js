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
  
  const totalReviews = await Review.countDocuments({ 
    productId: req.params.productId 
  });
  
  const allReviews = await Review.find({ productId: req.params.productId });
  const avgRating = totalReviews > 0 
    ? allReviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews
    : 0;
  
  const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  allReviews.forEach(r => {
    if (r.rating >= 1 && r.rating <= 5) {
      ratingDistribution[r.rating]++;
    }
  });
  
  res.json({ 
    success: true, 
    data: { 
      reviews, 
      avgRating: Math.round(avgRating * 10) / 10,
      totalReviews,
      ratingDistribution
    },
    hasMore: skip + reviews.length < totalReviews,
    currentPage: parseInt(page),
    totalPages: Math.ceil(totalReviews / parseInt(limit))
  });
}));

// Add/Update review
router.post('/', asyncHandler(async (req, res) => {
  const { userId, productId, rating, comment, buyerName } = req.body;
  
  if (!userId || !productId || !rating || !comment || !buyerName) {
    return res.status(400).json({ 
      success: false, 
      message: "All fields required: userId, productId, rating, comment, buyerName" 
    });
  }
  
  if (typeof rating !== 'number' || rating < 1 || rating > 5) {
    return res.status(400).json({ 
      success: false, 
      message: "Rating must be between 1 and 5" 
    });
  }
  
  const existingReview = await Review.findOne({ userId, productId });
  
  if (existingReview) {
    existingReview.rating = rating;
    existingReview.comment = comment.trim();
    existingReview.buyerName = buyerName.trim();
    await existingReview.save();
    
    // Track review update
    await trackReviewEvent(userId, productId, 'review_updated', { rating });
    
    res.json({ 
      success: true, 
      message: "Review updated successfully",
      data: existingReview
    });
  } else {
    const review = new Review({ 
      userId, 
      productId, 
      rating, 
      comment: comment.trim(), 
      buyerName: buyerName.trim() 
    });
    await review.save();
    
    // Track new review
    await trackReviewEvent(userId, productId, 'review_added', { rating });
    
    res.json({ 
      success: true, 
      message: "Review added successfully",
      data: review
    });
  }
}));

// Delete review with analytics
router.delete('/:reviewId', asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.reviewId);
  
  if (!review) {
    return res.status(404).json({ 
      success: false, 
      message: "Review not found" 
    });
  }
  
  // Track deletion
  await trackReviewEvent(
    review.userId, 
    review.productId, 
    'review_deleted', 
    { rating: review.rating }
  );
  
  await Review.findByIdAndDelete(req.params.reviewId);
  
  res.json({ 
    success: true, 
    message: "Review deleted successfully" 
  });
}));

// Get user's review
router.get('/user/:userId/product/:productId', asyncHandler(async (req, res) => {
  const review = await Review.findOne({ 
    userId: req.params.userId, 
    productId: req.params.productId 
  });
  
  res.json({ 
    success: true, 
    data: review
  });
}));

// Helper: Track review events
async function trackReviewEvent(userId, productId, action, metadata) {
  try {
    await AnalyticsEvent.create({
      userId,
      productId,
      action,
      metadata: {
        ...metadata,
        source: 'review'
      },
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Review analytics error:', error);
  }
}
// Delete review


// Get similar products
router.get('/similar/:productId', asyncHandler(async (req, res) => {
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;
    
    try {
        const product = await Product.findById(req.params.productId);
        if (!product) {
            return res.status(404).json({ 
                success: false, 
                message: "Product not found",
                data: []
            });
        }
        
        // Get products from same subcategory first, then category
        let similarProducts = await Product.find({
            _id: { $ne: req.params.productId },
            proSubCategoryId: product.proSubCategoryId,
            quantity: { $gt: 0 } // Only in-stock products
        }).skip(skip).limit(parseInt(limit)).sort({ createdAt: -1 });
        
        // If not enough from subcategory, fill with category products
        if (similarProducts.length < parseInt(limit)) {
            const remainingLimit = parseInt(limit) - similarProducts.length;
            const categoryProducts = await Product.find({
                _id: { $ne: req.params.productId, $nin: similarProducts.map(p => p._id) },
                proCategoryId: product.proCategoryId,
                quantity: { $gt: 0 }
            }).skip(Math.max(0, skip - similarProducts.length)).limit(remainingLimit).sort({ createdAt: -1 });
            
            similarProducts = [...similarProducts, ...categoryProducts];
        }
        
        // Count total similar products for hasMore calculation
        const totalSubcategoryProducts = await Product.countDocuments({
            _id: { $ne: req.params.productId },
            proSubCategoryId: product.proSubCategoryId,
            quantity: { $gt: 0 }
        });
        
        const totalCategoryProducts = await Product.countDocuments({
            _id: { $ne: req.params.productId },
            proCategoryId: product.proCategoryId,
            quantity: { $gt: 0 }
        });
        
        const totalSimilarProducts = Math.max(totalSubcategoryProducts, totalCategoryProducts);
        const hasMore = skip + similarProducts.length < totalSimilarProducts;
        
        // Add average ratings for each product
        const productsWithRatings = await Promise.all(
            similarProducts.map(async (prod) => {
                try {
                    const reviews = await Review.find({ productId: prod._id });
                    const avgRating = reviews.length > 0 
                        ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
                        : 0;
                    
                    const productObj = prod.toObject();
                    productObj.avgRating = Math.round(avgRating * 10) / 10;
                    productObj.reviewCount = reviews.length;
                    return productObj;
                } catch (error) {
                    console.error(`Error calculating rating for product ${prod._id}:`, error);
                    const productObj = prod.toObject();
                    productObj.avgRating = 0;
                    productObj.reviewCount = 0;
                    return productObj;
                }
            })
        );
        
        res.json({ 
            success: true, 
            data: productsWithRatings,
            hasMore,
            total: totalSimilarProducts,
            currentPage: parseInt(page),
            totalPages: Math.ceil(totalSimilarProducts / parseInt(limit))
        });
        
    } catch (error) {
        console.error('Error fetching similar products:', error);
        res.status(500).json({ 
            success: false, 
            message: "Failed to fetch similar products",
            data: [],
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
}));

// Get review statistics for a product (separate endpoint for just stats)
router.get('/stats/:productId', asyncHandler(async (req, res) => {
    try {
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
            if (review.rating >= 1 && review.rating <= 5) {
                ratingDistribution[review.rating]++;
            }
        });
        
        res.json({
            success: true,
            data: {
                avgRating: Math.round(avgRating * 10) / 10,
                totalReviews: reviews.length,
                ratingDistribution
            }
        });
        
    } catch (error) {
        console.error('Error fetching review stats:', error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch review statistics",
            data: {
                avgRating: 0,
                totalReviews: 0,
                ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
            },
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
}));

module.exports = router;