// routes/enhancedProductFeed.js - Enhanced with new sections
const express = require('express');
const router = express.Router();
const Product = require('../model/product');
const Category = require('../model/category');
const AnalyticsEvent = require('../model/analytics');
const SponsoredProduct = require('../model/sponsoredProduct');
const asyncHandler = require('express-async-handler');
const safeSerialize = (data) => JSON.parse(JSON.stringify(data));
// Cache for frequently accessed data
const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 300 }); // 5-minute cache
const { analyticsLimiter } = require('../middleware/rateLimmiter');
const {
    extractIPAddress,
    validateAnalyticsEvent,
    sanitizeMetadata,
    formatErrorResponse,
    formatSuccessResponse
} = require('../utils/analyticsHelper');

/**
 * @route   GET /api/feed/complete
 * @desc    Get complete feed with all sections in random order
 * @access  Public
 */



router.get('/complete', asyncHandler(async (req, res) => {
  const {
    userId = null,
    analytics = 'true',
    includeMixed = 'true',
    page = 1,
  } = req.query;

  const useAnalytics = analytics === 'true';
  const includeMixedSponsored = includeMixed === 'true';
  const pageNum = parseInt(page);
  const cacheKey = `complete_feed_${userId || 'guest'}_${useAnalytics}_${includeMixedSponsored}_${pageNum}`;

  // 1️⃣ Check cache first
  const cachedData = cache.get(cacheKey);
  if (cachedData) {
    return res.json({
      success: true,
      message: 'Complete feed retrieved successfully (cached)',
      data: cachedData,
    });
  }

  try {
    // 2️⃣ Fetch only lightweight sections first (instant load)
    const [
      sponsoredProducts,
      recentlyAdded,
      categoriesWithProducts
    ] = await Promise.all([
      getSponsoredSection(3, false), // minimal number, skip analytics
      getRecentlyAddedSection(6, false, pageNum), // skip analytics
      getCategoriesWithTopProducts(4, null, pageNum) // skip analytics
    ]);

    const initialSections = [
      {
        sectionId: 'sponsored',
        title: 'Sponsored Products',
        type: 'sponsored',
        products: sponsoredProducts,
        showMore: sponsoredProducts.length >= 3,
      },
      {
        sectionId: 'recently_added',
        title: 'Recently Added',
        type: 'recent',
        products: recentlyAdded,
        showMore: recentlyAdded.length >= 6,
      }
    ];

    if (categoriesWithProducts.categories) {
      categoriesWithProducts.categories.forEach((catData) => {
        initialSections.push({
          sectionId: `category_${catData.category._id}`,
          title: catData.category.name,
          type: 'category',
          categoryId: catData.category._id,
          products: catData.products.map((product) => {
            delete product.address;
            return product;
          }),
          showMore: catData.products.length >= 4,
        });
      });
    }

    // 3️⃣ Send initial response immediately (fast!)
    res.json({
      success: true,
      message: 'Feed retrieved quickly. Analytics loading in background...',
      data: {
        sections: initialSections,
        metadata: {
          totalSections: initialSections.length,
          hasMixedSponsored: includeMixedSponsored,
          generatedAt: new Date(),
          userId: userId || 'guest',
          page: pageNum,
        },
      }
    });

    // 4️⃣ Enrich remaining sections with analytics in the background
    if (useAnalytics) {
      (async () => {
        try {
          const [
            todaysPicks,
            recommended,
            trending
          ] = await Promise.all([
            getTodaysPicksSection(5, true),
            userId ? getRecommendedProducts(userId, 5, true) : getRandomProducts(5),
            getTrendingProducts(5, true)
          ]);

          // Combine all sections
          const allSections = [
            ...initialSections,
            {
              sectionId: 'todays_picks',
              title: "Today's Picks",
              type: 'curated',
              products: todaysPicks,
              showMore: todaysPicks.length >= 5,
            },
            {
              sectionId: 'recommended',
              title: 'Just For You',
              type: 'personalized',
              products: recommended,
              showMore: recommended.length >= 5,
            },
            {
              sectionId: 'trending',
              title: 'Trending Now',
              type: 'trending',
              products: trending,
              showMore: trending.length >= 5,
            }
          ];

          // Shuffle sections for variety
          const shuffledSections = shuffleArray([...allSections]);

          // Mix sponsored products if requested
          if (includeMixedSponsored && sponsoredProducts.length > 0) {
            shuffledSections.forEach((section) => {
              if (section.type !== 'sponsored' && section.products.length > 0) {
                const sponsoredToMix = sponsoredProducts
                  .sort(() => 0.5 - Math.random())
                  .slice(0, Math.random() > 0.5 ? 2 : 1);

                sponsoredToMix.forEach((sponsoredProduct) => {
                  const randomIndex = Math.floor(Math.random() * (section.products.length + 1));
                  section.products.splice(randomIndex, 0, {
                    ...sponsoredProduct,
                    isSponsored: true,
                    originalSection: section.sectionId,
                  });
                });
              }
            });
          }

          // Cache the fully enriched feed
          cache.set(cacheKey, safeSerialize({
            sections: shuffledSections,
            metadata: {
              totalSections: shuffledSections.length,
              hasMixedSponsored: includeMixedSponsored,
              generatedAt: new Date(),
              userId: userId || 'guest',
              page: pageNum,
            }
          }));

        } catch (error) {
          console.error('Background feed enrichment error:', error);
        }
      })();
    }

  } catch (error) {
    console.error('Error retrieving feed:', error);
    res.json({
      success: true,
      message: 'Error retrieving feed, showing lightweight data',
      data: {
        sections: [],
        metadata: {
          totalSections: 0,
          hasMixedSponsored: false,
          userId: userId || 'guest',
          page: pageNum
        }
      }
    });
  }
}));

/**
 * @route   GET /api/feed/section/:sectionName
 * @desc    Get specific sections including new ones
 * @access  Public
 */
router.get('/section/:sectionName', asyncHandler(async (req, res) => {
    const { sectionName } = req.params;
    const { limit = 2, userId = null, analytics = 'true', page = 1 } = req.query;

    const limitNum = parseInt(limit);
    const useAnalytics = analytics === 'true';
    const pageNum = parseInt(page);

    try {
        const cacheKey = `section_${sectionName}_${limitNum}_${userId || 'guest'}_${useAnalytics}_${pageNum}`;
        
        // Check cache first
        const cachedData = cache.get(cacheKey);
        if (cachedData) {
            return res.json({
                success: true,
                message: `${sectionName} section retrieved successfully (cached)`,
                data: cachedData
            });
        }

        let products = [];

        switch (sectionName) {
            case 'sponsored':
                products = await getSponsoredSection(limitNum, useAnalytics);
                break;
            case 'todays_picks':
                products = await getTodaysPicksSection(limitNum, useAnalytics);
                break;
            case 'recently_added':
                products = await getRecentlyAddedSection(limitNum, useAnalytics, pageNum);
                break;
            case 'recommended':
                products = await getRecommendedProducts(userId, limitNum, useAnalytics);
                break;
            case 'trending':
                products = await getTrendingProducts(limitNum, useAnalytics);
                break;
            case 'recent':
                if (!userId) {
                    return res.status(400).json({
                        success: false,
                        message: "User ID required for recent items"
                    });
                }
                products = await getRecentlyViewedProducts(userId, limitNum, pageNum);
                break;
            default:
                return res.status(400).json({
                    success: false,
                    message: "Invalid section name"
                });
        }

        // Cache the result
        cache.set(cacheKey, products);

        res.json({
            success: true,
            message: `${sectionName} section retrieved successfully`,
            data: products
        });

    } catch (error) {
        console.error(`Error retrieving ${sectionName} section:`, error);
        res.status(500).json({
            success: false,
            message: `Error retrieving ${sectionName} products`,
            error: error.message
        });
    }
}));

/**
 * @route   GET /api/feed/categories
 * @desc    Get categories with their top products
 * @access  Public
 */
router.get('/categories', asyncHandler(async (req, res) => {
    const { limit = 4, userId = null, includeProducts = 'false', page = 1 } = req.query;
    
    const limitNum = parseInt(limit);
    const shouldIncludeProducts = includeProducts === 'true';
    const pageNum = parseInt(page);

    try {
        const cacheKey = `categories_products_${limitNum}_${userId || 'guest'}_${pageNum}`;
        
        const cachedData = cache.get(cacheKey);
        if (cachedData) {
            return res.json({
                success: true,
                message: "Categories with products retrieved successfully (cached)",
                data: cachedData
            });
        }

        if (!shouldIncludeProducts) {
            const categories = await Category.find().limit(5);
            return res.json({
                success: true,
                message: "Categories retrieved successfully",
                data: { categories }
            });
        }

        // Get categories with products
        const categoriesWithProducts = await getCategoriesWithTopProducts(limitNum, userId, pageNum);

        cache.set(cacheKey, categoriesWithProducts);

        res.json({
            success: true,
            message: "Categories with products retrieved successfully",
            data: categoriesWithProducts
        });

    } catch (error) {
        console.error('Error retrieving categories with products:', error);
        res.status(500).json({
            success: false,
            message: "Error retrieving categories",
            error: error.message
        });
    }
}));

/**
 * @route   GET /products/category/:categoryId
 * @desc    Get products by category with pagination
 * @access  Public
 */
router.get('/products/category/:categoryId', asyncHandler(async (req, res) => {
    const { categoryId } = req.params;
    const { page = 1, limit = 6, userId = null } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    try {
        // Get products by category with analytics-based sorting if userId provided
        let sortCriteria = { createdAt: -1 }; // Default sort by newest

        if (userId) {
            // If user provided, try to get analytics-based sorting
            const userPreferences = await getUserCategoryPreferences(userId, categoryId);
            if (userPreferences.length > 0) {
                // Sort by user interaction history
                sortCriteria = { updatedAt: -1, createdAt: -1 };
            }
        }

        const [products, totalCount] = await Promise.all([
            Product.find({ 
                proCategoryId: categoryId,
                quantity: { $gt: 0 } 
            })
            .populate('proCategoryId', 'name')
            .populate('proSubCategoryId', 'name')
            .populate('sellerId', 'fullName')
            .sort(sortCriteria)
            .skip(skip)
            .limit(limitNum)
            .lean(),
            
            Product.countDocuments({ 
                proCategoryId: categoryId,
                quantity: { $gt: 0 } 
            })
        ]);

        const enrichedProducts = await enrichProductsWithAnalytics(products);

        res.json({
            success: true,
            message: "Category products retrieved successfully",
            data: enrichedProducts,
            pagination: {
                currentPage: pageNum,
                totalPages: Math.ceil(totalCount / limitNum),
                totalProducts: totalCount,
                hasMore: pageNum * limitNum < totalCount
            }
        });

    } catch (error) {
        console.error('Error retrieving category products:', error);
        res.status(500).json({
            success: false,
            message: "Error retrieving category products",
            error: error.message
        });
    }
}));

// NEW HELPER FUNCTIONS FOR ADDITIONAL SECTIONS

// ... (other imports and routes remain unchanged)

async function getSponsoredSection(limit, useAnalytics) {
  try {
    // Use lean() to avoid Mongoose document serialization issues
    const activeSponsored = await SponsoredProduct.find({
      isActive: true,
      status: 'active',
      startDate: { $lte: new Date() },
      endDate: { $gte: new Date() },
      $expr: { $lt: ['$totalSpent', '$budget'] },
    })
      .populate({
        path: 'productId',
        select: 'name price images quantity proCategoryId proSubCategoryId sellerId',
        populate: [
          { path: 'proCategoryId', select: 'name' },
          { path: 'proSubCategoryId', select: 'name' },
          { path: 'sellerId', select: 'fullName' },
        ],
      })
      .sort({ priority: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    // Filter out invalid documents (e.g., missing productId or invalid product data)
    const validSponsored = activeSponsored.filter((sponsored) => {
      if (!sponsored.productId) {
        console.warn(`Sponsored product ${sponsored._id} has no valid productId`);
        return false;
      }
      if (!sponsored.productId.quantity || sponsored.productId.quantity <= 0) {
        console.warn(`Product ${sponsored.productId._id} is out of stock`);
        return false;
      }
      return true;
    });

    // Extract products and enrich with analytics
    const products = validSponsored.map((sponsored) => ({
      ...sponsored.productId,
      isSponsored: true,
      sponsorshipType: sponsored.sponsorshipType,
    }));

    // Enrich with analytics if needed
    const enrichedProducts = useAnalytics
      ? await enrichProductsWithAnalytics(products)
      : products;

    return enrichedProducts;
  } catch (error) {
    console.error('Error getting sponsored section:', error);
    return [];
  }
}

async function getRecentlyAddedSection(limit, useAnalytics, page = 1) {
  try {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const skip = (page - 1) * limit;

    // Base query for products added in the last week
    const baseQuery = {
      createdAt: { $gte: oneWeekAgo },
      quantity: { $gt: 0 },
    };

    let products = [];

    if (useAnalytics) {
      // Get recently added products with their view counts
      const recentWithAnalytics = await Product.aggregate([
        { $match: baseQuery },
        {
          $lookup: {
            from: 'analytics_events',
            let: { productId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ['$productId', '$$productId'] },
                  action: 'view',
                },
              },
              { $count: 'viewCount' },
            ],
            as: 'analytics',
          },
        },
        {
          $addFields: {
            viewCount: {
              $ifNull: [{ $arrayElemAt: ['$analytics.viewCount', 0] }, 0],
            },
          },
        },
        {
          $sort: {
            viewCount: -1, // Sort by view count first
            createdAt: -1, // Then by creation date
          },
        },
        { $skip: skip },
        { $limit: limit },
      ]);

      // Populate the aggregated results
      products = await Product.populate(recentWithAnalytics, [
        { path: 'proCategoryId', select: 'name' },
        { path: 'proSubCategoryId', select: 'name' },
        { path: 'sellerId', select: 'fullName' },
      ]);
    } else {
      // Simple query without analytics
      products = await Product.find(baseQuery)
        .populate('proCategoryId', 'name')
        .populate('proSubCategoryId', 'name')
        .populate('sellerId', 'fullName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .select('-__v -address'); // Explicitly exclude address field
    }

    // Filter out invalid products
    const validProducts = products.filter((product) => {
      if (!product.name || !product.price || !product.quantity || !product.sellerName) {
        console.warn(`Product ${product._id} has missing required fields`);
        return false;
      }
      // Remove address field if present
      delete product.address;
      return true;
    });

    // Enrich with analytics if needed
    const enrichedProducts = useAnalytics
      ? await enrichProductsWithAnalytics(validProducts)
      : validProducts;

    // Serialize safely for caching
    return safeSerialize(
      enrichedProducts.map((product) => ({
        ...product,
        isRecentlyAdded: true,
        daysOld: Math.floor(
          (Date.now() - new Date(product.createdAt).getTime()) / (1000 * 60 * 60 * 24)
        ),
      }))
    );
  } catch (error) {
    console.error('Error getting recently added section:', error);
    return [];
  }
}



async function getTodaysPicksSection(limit, useAnalytics) {
    try {
        // Algorithm: Random selection weighted by view count + rating
        const last30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        
        let topViewedProducts = [];
        
        if (useAnalytics) {
            // Get products with highest view count in last 30 days
            topViewedProducts = await AnalyticsEvent.aggregate([
                {
                    $match: {
                        action: 'view',
                        timestamp: { $gte: last30Days }
                    }
                },
                {
                    $group: {
                        _id: '$productId',
                        viewCount: { $sum: 1 }
                    }
                },
                { $sort: { viewCount: -1 } },
                { $limit: limit * 3 } // Get more for randomization
            ]);
        }

        let query = { quantity: { $gt: 0 } };
        
        if (topViewedProducts.length > 0) {
            const productIds = topViewedProducts.map(item => item._id);
            query._id = { $in: productIds };
        }

        const products = await Product.find(query)
            .populate('proCategoryId', 'name')
            .populate('proSubCategoryId', 'name')
            .populate('sellerId', 'fullName')
            .limit(limit * 2)
            .lean();

        // Random selection with slight bias towards higher viewed products
        const shuffled = products.sort(() => 0.5 - Math.random());
        const selected = shuffled.slice(0, limit);

        const enrichedProducts = await enrichProductsWithAnalytics(selected);

        return enrichedProducts.map(product => ({
            ...product,
            isTodaysPick: true,
            pickReason: 'Popular choice'
        }));

    } catch (error) {
        console.error('Error getting today\'s picks:', error);
        // Fallback to random products
        return await getRandomProducts(limit);
    }
}

async function getRecentlyAddedSection(limit, useAnalytics, page = 1) {
    try {
        const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const skip = (page - 1) * limit;

        // Base query for products added in the last week
        const baseQuery = {
            createdAt: { $gte: oneWeekAgo },
            quantity: { $gt: 0 }
        };

        let products = [];

        if (useAnalytics) {
            // Get recently added products with their view counts
            const recentWithAnalytics = await Product.aggregate([
                { $match: baseQuery },
                {
                    $lookup: {
                        from: 'analytics_events',
                        let: { productId: '$_id' },
                        pipeline: [
                            {
                                $match: {
                                    $expr: { $eq: ['$productId', '$$productId'] },
                                    action: 'view'
                                }
                            },
                            { $count: 'viewCount' }
                        ],
                        as: 'analytics'
                    }
                },
                {
                    $addFields: {
                        viewCount: { 
                            $ifNull: [{ $arrayElemAt: ['$analytics.viewCount', 0] }, 0] 
                        }
                    }
                },
                {
                    $sort: { 
                        viewCount: -1,  // Sort by view count first
                        createdAt: -1   // Then by creation date
                    }
                },
                { $skip: skip },
                { $limit: limit }
            ]);

            // Populate the aggregated results
            products = await Product.populate(recentWithAnalytics, [
                { path: 'proCategoryId', select: 'name' },
                { path: 'proSubCategoryId', select: 'name' },
                { path: 'sellerId', select: 'fullName' }
            ]);

        } else {
            // Simple query without analytics
            products = await Product.find(baseQuery)
                .populate('proCategoryId', 'name')
                .populate('proSubCategoryId', 'name')
                .populate('sellerId', 'fullName')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean();
        }

        const enrichedProducts = await enrichProductsWithAnalytics(products);

        return enrichedProducts.map(product => ({
            ...product,
            isRecentlyAdded: true,
            daysOld: Math.floor((Date.now() - new Date(product.createdAt).getTime()) / (1000 * 60 * 60 * 24))
        }));

    } catch (error) {
        console.error('Error getting recently added section:', error);
        return [];
    }
}

// EXISTING HELPER FUNCTIONS (UPDATED)

async function getRecommendedProducts(userId, limit, useAnalytics) {
    if (!useAnalytics || !userId) {
        // Return random products if no analytics
        return await getRandomProducts(limit);
    }

    // Analytics-based recommendations
    const userPreferences = await getUserAnalytics(userId);
    const preferredCategories = Object.keys(userPreferences.categories || {})
        .sort((a, b) => userPreferences.categories[b] - userPreferences.categories[a])
        .slice(0, 3);

    let query = { quantity: { $gt: 0 } };
    if (preferredCategories.length > 0) {
        query.proCategoryId = { $in: preferredCategories };
    }

    const products = await Product.find(query)
        .populate('proCategoryId', 'name')
        .populate('proSubCategoryId', 'name')
        .populate('sellerId', 'fullName')
        .sort({ updatedAt: -1, offerPrice: 1 })
        .limit(limit * 2)
        .lean();

    // Shuffle for randomness as requested
    const shuffled = products.sort(() => 0.5 - Math.random());
    return await enrichProductsWithAnalytics(shuffled.slice(0, limit));
}

async function getTrendingProducts(limit, useAnalytics) {
    if (!useAnalytics) {
        // Return random products if no analytics
        return await getRandomProducts(limit);
    }

    // Analytics-based trending
    const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const trendingProductIds = await AnalyticsEvent.aggregate([
        {
            $match: {
                action: { $in: ['view', 'add_to_cart', 'purchase'] },
                timestamp: { $gte: last7Days }
            }
        },
        {
            $group: {
                _id: '$productId',
                score: {
                    $sum: {
                        $switch: {
                            branches: [
                                { case: { $eq: ['$action', 'view'] }, then: 1 },
                                { case: { $eq: ['$action', 'add_to_cart'] }, then: 3 },
                                { case: { $eq: ['$action', 'purchase'] }, then: 5 }
                            ],
                            default: 0
                        }
                    }
                }
            }
        },
        { $sort: { score: -1 } },
        { $limit: limit * 2 }
    ]);

    const productIds = trendingProductIds.map(item => item._id);
    
    if (productIds.length === 0) {
        // Fallback to recent products
        return await getRandomProducts(limit);
    }

    const products = await Product.find({ 
        _id: { $in: productIds },
        quantity: { $gt: 0 }
    })
    .populate('proCategoryId', 'name')
    .populate('proSubCategoryId', 'name')
    .populate('sellerId', 'fullName')
    .lean();

    // Shuffle while maintaining some trending order
    const shuffled = products.sort(() => 0.5 - Math.random());
    return await enrichProductsWithAnalytics(shuffled.slice(0, limit));
}

async function getRecentlyViewedProducts(userId, limit, page) {
    const skip = (page - 1) * limit;

    const recentEvents = await AnalyticsEvent.find({
        userId,
        action: 'view'
    })
    .sort({ timestamp: -1 })
    .skip(skip)
    .limit(limit * 2) // Get more to handle duplicates
    .lean();

    // Get unique product IDs
    const uniqueProductIds = [...new Set(recentEvents.map(event => event.productId))];
    const productIds = uniqueProductIds.slice(0, limit);

    if (productIds.length === 0) {
        return [];
    }

    const products = await Product.find({ 
        _id: { $in: productIds },
        quantity: { $gt: 0 }
    })
    .populate('proCategoryId', 'name')
    .populate('proSubCategoryId', 'name')
    .populate('sellerId', 'fullName')
    .lean();

    // Sort by recent view order
    const sortedProducts = productIds.map(id => 
        products.find(p => p._id.toString() === id.toString())
    ).filter(Boolean);

    return await enrichProductsWithAnalytics(sortedProducts);
}

async function getCategoriesWithTopProducts(limit, userId, page = 1) {
    const categories = await Category.find().limit(5).lean();
    const categoriesWithProducts = [];

    for (const category of categories) {
        let sortCriteria = { createdAt: -1 };
        
        if (userId) {
            const userCategoryInteractions = await AnalyticsEvent.countDocuments({
                userId,
                action: 'view'
            });
            
            if (userCategoryInteractions > 0) {
                sortCriteria = { updatedAt: -1, createdAt: -1 };
            }
        }

        const products = await Product.find({
            proCategoryId: category._id,
            quantity: { $gt: 0 }
        })
        .populate('proCategoryId', 'name')
        .populate('proSubCategoryId', 'name')
        .populate('sellerId', 'fullName')
        .sort(sortCriteria)
        .limit(limit * 2)
        .lean();

        if (products.length > 0) {
            // Shuffle products for randomness
            const shuffled = products.sort(() => 0.5 - Math.random());
            const enrichedProducts = await enrichProductsWithAnalytics(shuffled.slice(0, limit));
            
            categoriesWithProducts.push({
                category,
                products: enrichedProducts
            });
        }
    }

    return { categories: categoriesWithProducts };
}

// UTILITY FUNCTIONS

async function getRandomProducts(limit) {
    const products = await Product.find({ quantity: { $gt: 0 } })
        .populate('proCategoryId', 'name')
        .populate('proSubCategoryId', 'name')
        .populate('sellerId', 'fullName')
        .limit(limit * 2)
        .lean();
    
    const shuffled = products.sort(() => 0.5 - Math.random());
    return await enrichProductsWithAnalytics(shuffled.slice(0, limit));
}

function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

async function getUserAnalytics(userId) {
    const last30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const analytics = await AnalyticsEvent.aggregate([
        {
            $match: {
                userId,
                timestamp: { $gte: last30Days }
            }
        },
        {
            $lookup: {
                from: 'products',
                localField: 'productId',
                foreignField: '_id',
                as: 'product'
            }
        },
        {
            $unwind: '$product'
        },
        {
            $group: {
                _id: '$product.proCategoryId',
                interactions: { $sum: 1 }
            }
        }
    ]);

    const categories = {};
    analytics.forEach(item => {
        categories[item._id] = item.interactions;
    });

    return { categories };
}

async function getUserCategoryPreferences(userId, categoryId) {
    const last30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    return await AnalyticsEvent.find({
        userId,
        timestamp: { $gte: last30Days }
    })
    .populate({
        path: 'productId',
        match: { proCategoryId: categoryId }
    })
    .lean();
}

async function enrichProductsWithAnalytics(products) {
    const enriched = await Promise.all(products.map(async (product) => {
        const [viewCount, avgRating, reviewCount] = await Promise.all([
            getProductViewCount(product._id),
            getProductRating(product._id),
            getProductReviewCount(product._id)
        ]);

        return {
            ...product,
            analytics: {
                viewCount,
                avgRating: avgRating || 0,
                reviewCount: reviewCount || 0
            },
            discountPercentage: product.offerPrice && product.price 
                ? Math.round(((product.price - product.offerPrice) / product.price) * 100)
                : 0
        };
    }));

    return enriched;
}

async function getProductViewCount(productId) {
    const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return await AnalyticsEvent.countDocuments({
        productId,
        action: 'view',
        timestamp: { $gte: last7Days }
    });
}

async function getProductRating(productId) {
    // Placeholder - replace with actual review system
    return Math.random() * 5;
}

async function getProductReviewCount(productId) {
    // Placeholder - replace with actual review system
    return Math.floor(Math.random() * 50);
}



/**
 * @route   POST /api/feed/track
 * @desc    Track analytics events (views, clicks, favorites, etc.)
 * @access  Public (no auth required)
 */
router.post('/track', analyticsLimiter, asyncHandler(async (req, res) => {
    try {
        const {
            productId,
            action,
            userId = null,
            metadata = {}
        } = req.body;

        // Validate event data
        const validation = validateAnalyticsEvent({ productId, action, metadata });
        if (!validation.valid) {
            console.warn('⚠️ Invalid analytics event:', validation.errors);
            return res.status(400).json(
                formatErrorResponse('Invalid analytics event', validation.errors)
            );
        }

        // Sanitize metadata to prevent injection
        const sanitizedMetadata = sanitizeMetadata(metadata);

        // Extract IP and user agent
        const ipAddress = extractIPAddress(req);
        const userAgent = req.headers['user-agent'] || 'unknown';

        // Create analytics event
        const analyticsEvent = new AnalyticsEvent({
            productId,
            action,
            userId: userId || null, // null for guest users
            metadata: sanitizedMetadata,
            ipAddress,
            userAgent,
            timestamp: new Date()
        });

        // Save to database (fire-and-forget with error handling)
        analyticsEvent.save()
            .then(() => {
                console.log(`✅ Analytics tracked: ${action} for product ${productId}`);
            })
            .catch((error) => {
                // Don't fail the request if analytics save fails
                console.error('❌ Analytics save error (non-critical):', error.message);
            });

        // Immediate success response (don't wait for DB save)
        res.status(200).json(
            formatSuccessResponse('Event tracked successfully', {
                eventId: analyticsEvent._id,
                action,
                timestamp: analyticsEvent.timestamp
            })
        );

    } catch (error) {
        console.error('❌ Analytics tracking error:', error);
        
        // Return success even on error (silent fail for analytics)
        // This prevents analytics failures from breaking user experience
        res.status(200).json(
            formatSuccessResponse('Event received', {
                note: 'Event processing in background'
            })
        );
    }
}));

/**
 * @route   GET /api/feed/analytics/product/:productId
 * @desc    Get analytics summary for a specific product
 * @access  Public
 */
router.get('/analytics/product/:productId', asyncHandler(async (req, res) => {
    try {
        const { productId } = req.params;
        const { days = 30 } = req.query;

        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - parseInt(days));

        // Aggregate analytics for the product
        const analytics = await AnalyticsEvent.aggregate([
            {
                $match: {
                    productId: mongoose.Types.ObjectId(productId),
                    timestamp: { $gte: daysAgo }
                }
            },
            {
                $group: {
                    _id: '$action',
                    count: { $sum: 1 }
                }
            }
        ]);

        // Format results
        const summary = {
            productId,
            period: `${days} days`,
            analytics: {}
        };

        analytics.forEach(item => {
            summary.analytics[item._id] = item.count;
        });

        // Calculate total interactions
        summary.totalInteractions = analytics.reduce((sum, item) => sum + item.count, 0);

        res.json(
            formatSuccessResponse('Product analytics retrieved', summary)
        );

    } catch (error) {
        console.error('❌ Product analytics error:', error);
        res.status(500).json(
            formatErrorResponse('Failed to retrieve analytics', [error.message])
        );
    }
}));

/**
 * @route   GET /api/feed/analytics/trending
 * @desc    Get trending products based on analytics
 * @access  Public
 */
router.get('/analytics/trending', asyncHandler(async (req, res) => {
    try {
        const { limit = 10, days = 7 } = req.query;

        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - parseInt(days));

        // Get top products by interaction count
        const trending = await AnalyticsEvent.aggregate([
            {
                $match: {
                    timestamp: { $gte: daysAgo },
                    action: { $in: ['view', 'click', 'favorite'] }
                }
            },
            {
                $group: {
                    _id: '$productId',
                    score: {
                        $sum: {
                            $switch: {
                                branches: [
                                    { case: { $eq: ['$action', 'view'] }, then: 1 },
                                    { case: { $eq: ['$action', 'click'] }, then: 3 },
                                    { case: { $eq: ['$action', 'favorite'] }, then: 5 }
                                ],
                                default: 1
                            }
                        }
                    },
                    views: {
                        $sum: { $cond: [{ $eq: ['$action', 'view'] }, 1, 0] }
                    },
                    clicks: {
                        $sum: { $cond: [{ $eq: ['$action', 'click'] }, 1, 0] }
                    },
                    favorites: {
                        $sum: { $cond: [{ $eq: ['$action', 'favorite'] }, 1, 0] }
                    }
                }
            },
            { $sort: { score: -1 } },
            { $limit: parseInt(limit) }
        ]);

        // Populate product details
        const productIds = trending.map(t => t._id);
        const products = await Product.find({ _id: { $in: productIds } })
            .populate('proCategoryId', 'name')
            .populate('sellerId', 'fullName')
            .lean();

        // Merge analytics with product data
        const trendingProducts = trending.map(trend => {
            const product = products.find(p => p._id.toString() === trend._id.toString());
            return {
                ...product,
                analytics: {
                    score: trend.score,
                    views: trend.views,
                    clicks: trend.clicks,
                    favorites: trend.favorites
                }
            };
        }).filter(p => p._id); // Filter out missing products

        res.json(
            formatSuccessResponse('Trending products retrieved', {
                products: trendingProducts,
                period: `${days} days`
            })
        );

    } catch (error) {
        console.error('❌ Trending analytics error:', error);
        res.status(500).json(
            formatErrorResponse('Failed to retrieve trending products', [error.message])
        );
    }
}));
module.exports = router;