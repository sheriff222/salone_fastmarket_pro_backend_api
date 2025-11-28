// routes/enhancedProductFeed.js - Enhanced with new sections
const express = require('express');
const router = express.Router();
const Product = require('../model/product');
const Category = require('../model/category');
const AnalyticsEvent = require('../model/analytics');
const SponsoredProduct = require('../model/sponsoredProduct');
const asyncHandler = require('express-async-handler');
// Cache for frequently accessed data
const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 120 }); // 5-minute cache
const compression = require('compression');
const instantCache = new NodeCache({ stdTTL: 300 });
const feedCache = new NodeCache({ stdTTL: 60 });
const categoryCache = new NodeCache({ stdTTL: 120 });

feedCache.on('expired', (key, value) => {
  console.log(`🧹 Expired cache key: ${key}`);
});


const { analyticsLimiter } = require('../middleware/rateLimmiter');
const {
    extractIPAddress,
    validateAnalyticsEvent,
    sanitizeMetadata,
    formatErrorResponse,
    formatSuccessResponse
} = require('../utils/analyticsHelper');


const safeSerialize = (data) => JSON.parse(JSON.stringify(data));

/**
 * @route   GET /api/feed/complete
 * @desc    Get complete feed with all sections in random order
 * @access  Public
 */

router.use(compression({
  level: 6, // Good balance of speed vs compression
  threshold: 1024, // Only compress responses > 1KB
}));

/**
 * @route   GET /api/feed/instant
 * @desc    Ultra-fast initial feed - returns ONLY 6 products
 * @access  Public
 */
router.get('/instant', asyncHandler(async (req, res) => {
  const startTime = Date.now();
  
  // CACHE KEY - rotates every 5 minutes for "freshness" feel
  const cacheSlot = Math.floor(Date.now() / 300000); // 5-min slots
  const cacheKey = `instant_feed_${cacheSlot}`;

  // CHECK CACHE FIRST
  const cached = instantCache.get(cacheKey);
  if (cached) {
    console.log(`⚡ INSTANT CACHE HIT - ${Date.now() - startTime}ms`);
    return res.json(cached);
  }

  try {
    // FETCH ONLY 6 PRODUCTS - Absolute minimum fields
    const products = await Product.find({ quantity: { $gt: 0 } })
      .select('name price offerPrice images.url') // ONLY essential fields
      .sort({ createdAt: -1 }) // Recent first
      .limit(6)
      .lean();

    // MINIMAL RESPONSE
    const response = {
      success: true,
      data: {
        products: products.map(p => ({
          _id: p._id,
          sId: p._id, // Compatibility
          name: p.name,
          price: p.price,
          offerPrice: p.offerPrice,
          images: p.images?.slice(0, 1) || [], // ONLY first image
        })),
        loadTimeMs: Date.now() - startTime
      }
    };

    // CACHE FOR 5 MINUTES
    instantCache.set(cacheKey, response);

    console.log(`✅ INSTANT FEED SERVED - ${Date.now() - startTime}ms`);
    res.json(response);

  } catch (error) {
    console.error('❌ Instant feed error:', error);
    // FALLBACK - Return empty but fast
    res.json({
      success: true,
      data: { products: [], loadTimeMs: Date.now() - startTime }
    });
  }
}));

/**
 * @route   GET /api/feed/complete
 * @desc    Full feed with smart caching and analytics-based randomization
 * @access  Public
 */
/**
 * @route   GET /api/feed/complete
 * @desc    Full feed with smart caching and analytics-based randomization
 * @access  Public
 */
router.get('/complete', asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const { userId = null, page = 1, categoriesLimit = 5 } = req.query;
  const pageNum = parseInt(page);
  const categoryLimit = parseInt(categoriesLimit);

  // SMART CACHE KEY - Different for logged-in users
  const cacheSlot = Math.floor(Date.now() / 300000); // 5-min rotation
  const userSegment = userId ? 'logged_in' : 'guest';
  const cacheKey = `feed_${userSegment}_${pageNum}_${categoryLimit}_${cacheSlot}`;

  // CHECK CACHE
  const cached = instantCache.get(cacheKey);
  if (cached) {
    console.log(`⚡ COMPLETE FEED CACHE HIT - ${Date.now() - startTime}ms`);
    return res.json(cached);
  }

  try {
    // PARALLEL FETCH - All sections at once
    const [sponsoredProducts, recentProducts, allCategories] = await Promise.all([
      // 1. SPONSORED (if any)
      SponsoredProduct.find({
        isActive: true,
        status: 'active',
        startDate: { $lte: new Date() },
        endDate: { $gte: new Date() },
      })
        .populate({
          path: 'productId',
          select: 'name price offerPrice images quantity proCategoryId sellerId',
          match: { quantity: { $gt: 0 } },
        })
        .sort({ priority: -1 })
        .limit(6)
        .lean(),

      // 2. RECENT PRODUCTS - Get 30 to randomize from
      Product.find({ quantity: { $gt: 0 } })
        .select('name price offerPrice images quantity proCategoryId sellerId createdAt')
        .sort({ createdAt: -1 })
        .limit(30)
        .lean(),

      // 3. ALL CATEGORIES (not just 3!)
      Category.find().lean()
    ]);

    // BUILD SECTIONS
    const sections = [];

    // SECTION 1: Sponsored (if exists)
    const validSponsored = sponsoredProducts
      .filter(s => s.productId)
      .map(s => s.productId);

    if (validSponsored.length > 0) {
      sections.push({
        sectionId: 'sponsored',
        title: 'Sponsored Products',
        type: 'sponsored',
        products: validSponsored.slice(0, 6),
        showMore: false,
      });
    }

    // SECTION 2: Recently Added (randomized from pool)
    const shuffledRecent = shuffleArray(recentProducts).slice(0, 10);
    sections.push({
      sectionId: 'recently_added',
      title: 'Recently Added',
      type: 'recent',
      products: shuffledRecent,
      showMore: true,
    });

    // SECTION 3-N: Category sections (parallel fetch)
    // Shuffle categories for variety on each cache refresh
    const shuffledCategories = shuffleArray(allCategories);
    const topCategories = shuffledCategories.slice(0, categoryLimit);

    const categoryPromises = topCategories.map(async (category) => {
      try {
        // Fetch products for this category
        const products = await Product.find({
          proCategoryId: category._id,
          quantity: { $gt: 0 }
        })
          .select('name price offerPrice images quantity proCategoryId sellerId')
          .populate('proCategoryId', 'name')
          .populate('sellerId', 'fullName')
          .limit(12) // Get 12 to randomize
          .lean();

        if (products.length === 0) {
          console.log(`⚠️ No products found for category: ${category.name}`);
          return null;
        }

        // Count total for "showMore"
        const totalCount = await Product.countDocuments({
          proCategoryId: category._id,
          quantity: { $gt: 0 }
        });

        console.log(`✅ Category "${category.name}": ${products.length} products (${totalCount} total)`);

        return {
          sectionId: `category_${category._id}`,
          title: category.name,
          type: 'category',
          categoryId: category._id.toString(),
          products: shuffleArray(products).slice(0, 6),
          showMore: totalCount > 6,
          totalProducts: totalCount
        };
      } catch (error) {
        console.error(`❌ Error fetching category ${category.name}:`, error);
        return null;
      }
    });

    const categorySections = (await Promise.all(categoryPromises)).filter(Boolean);
    sections.push(...categorySections);

    console.log(`📦 Total sections created: ${sections.length} (${categorySections.length} categories)`);

    // RESPONSE
    const response = {
      success: true,
      message: 'Complete feed retrieved',
      data: {
        sections,
        metadata: {
          totalSections: sections.length,
          categorySections: categorySections.length,
          generatedAt: new Date().toISOString(),
          userId: userId || 'guest',
          page: pageNum,
          loadTimeMs: Date.now() - startTime
        }
      }
    };

    // CACHE FOR 5 MINUTES
    instantCache.set(cacheKey, response);

    console.log(`✅ COMPLETE FEED - ${Date.now() - startTime}ms - ${sections.length} sections`);
    res.json(response);

  } catch (error) {
    console.error('❌ Complete feed error:', error);
    res.status(500).json({
      success: false,
      message: 'Error loading feed',
      error: error.message
    });
  }
}));

/**
 * @route   GET /api/feed/section/:sectionType/all
 * @desc    Load more products for a section (pagination)
 * @access  Public
 */
router.get('/section/:sectionType/all', asyncHandler(async (req, res) => {
  const { sectionType } = req.params;
  const { categoryId = null, page = 1, limit = 10 } = req.query;

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const skip = (pageNum - 1) * limitNum;

  try {
    let query = { quantity: { $gt: 0 } };
    
    // Category filter
    if (sectionType === 'category' && categoryId) {
      query.proCategoryId = categoryId;
    }

    // PARALLEL - Fetch products and count
    const [products, totalCount] = await Promise.all([
      Product.find(query)
        .select('name price offerPrice images quantity proCategoryId sellerId')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      
      Product.countDocuments(query)
    ]);

    const totalPages = Math.ceil(totalCount / limitNum);
    const hasMore = pageNum < totalPages;

    res.json({
      success: true,
      data: products,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalProducts: totalCount,
        hasMore,
        limit: limitNum
      }
    });

  } catch (error) {
    console.error('❌ Section pagination error:', error);
    res.status(500).json({
      success: false,
      message: 'Error loading section',
      error: error.message
    });
  }
}));

/**
 * @route   POST /api/feed/track
 * @desc    Track analytics (non-blocking, fire-and-forget)
 * @access  Public
 */
router.post('/track', (req, res) => {
  // INSTANT RESPONSE - Don't wait for DB write
  res.status(200).json({ success: true, message: 'Tracked' });

  // SAVE IN BACKGROUND
  const { productId, action, userId = null, metadata = {} } = req.body;
  
  setImmediate(async () => {
    try {
      await AnalyticsEvent.create({
        productId,
        action,
        userId,
        metadata,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        timestamp: new Date()
      });
    } catch (error) {
      console.error('⚠️ Analytics save failed (non-critical):', error.message);
    }
  });
});

// UTILITY: Fast array shuffle (Fisher-Yates)
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}


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

async function getCategoriesWithProductsFast(productsPerCategory, maxCategories) {
  // Check cache first
  const cacheKey = `categories_${productsPerCategory}_${maxCategories}`;
  const cached = categoryCache.get(cacheKey);
  if (cached) return cached;

  try {
    // Get top categories - RANDOMIZED
    const allCategories = await Category.find().lean();
    
    // ✅ SHUFFLE CATEGORIES for variety
    const shuffledCategories = allCategories.sort(() => Math.random() - 0.5);
    const categories = shuffledCategories.slice(0, maxCategories);

    // Parallel fetch products for each category
    const categoryPromises = categories.map(async (category) => {
      // ✅ GET MORE PRODUCTS THAN NEEDED (for randomization)
      const fetchLimit = productsPerCategory * 2;
      
      const [allProducts, totalCount] = await Promise.all([
        Product.find({ 
          proCategoryId: category._id,
          quantity: { $gt: 0 }
        })
          .select('name price offerPrice images quantity proCategoryId sellerId')
          .populate('proCategoryId', 'name')
          .populate('sellerId', 'fullName')
          .limit(fetchLimit) // Get more for randomization
          .lean(),
        
        Product.countDocuments({ 
          proCategoryId: category._id,
          quantity: { $gt: 0 }
        })
      ]);

      // ✅ SHUFFLE PRODUCTS and take only what we need
      const shuffledProducts = allProducts.sort(() => Math.random() - 0.5);
      const products = shuffledProducts.slice(0, productsPerCategory);

      return {
        category,
        products,
        hasMore: totalCount > productsPerCategory, // ✅ TRUE if more exist
        totalCount
      };
    });

    const categoriesWithProducts = await Promise.all(categoryPromises);
    
    // Filter out empty categories
    const validCategories = categoriesWithProducts.filter(c => c.products.length > 0);

    // Cache for 2 minutes
    categoryCache.set(cacheKey, validCategories);

    return validCategories;

  } catch (error) {
    console.error('❌ Categories fetch error:', error);
    return [];
  }
}

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