// routes/sponsoredProducts.js
const express = require('express');
const router = express.Router();
const SponsoredProduct = require('../model/sponsoredProduct');
const Product = require('../model/product');
const asyncHandler = require('express-async-handler');
const { protect } = require('../middleware/auth');

// Sierra Leone districts and regions for targeting
const SIERRA_LEONE_LOCATIONS = {
    districts: [
        'Western Area Urban', 'Western Area Rural', 'Bo', 'Bonthe', 'Moyamba', 'Pujehun',
        'Bombali', 'Falaba', 'Kambara', 'Karene', 'Koinadugu', 'Port Loko', 'Tonkolili',
        'Kailahun', 'Kenema', 'Kono'
    ],
    regions: ['Western Area', 'Northern Province', 'Southern Province', 'Eastern Province']
};

/**
 * @route   POST /api/sponsored
 * @desc    Create new sponsored product
 * @access  Admin
 */
router.post('/', asyncHandler(async (req, res) => {
    const {
        productId,
        sponsorshipType = 'basic',
        startDate,
        endDate,
        budget,
        dailyCost,
        priority = 5,
        targetAudience = {},
        displaySettings = {},
        notes
    } = req.body;

    // Validation
    if (!productId || !startDate || !endDate || !budget || !dailyCost) {
        return res.status(400).json({
            success: false,
            message: "Required fields: productId, startDate, endDate, budget, dailyCost"
        });
    }

    // Check if product exists
    const product = await Product.findById(productId);
    if (!product) {
        return res.status(404).json({
            success: false,
            message: "Product not found"
        });
    }

    // Check for existing active sponsorship
    const existingSponsorship = await SponsoredProduct.findOne({
        productId,
        status: { $in: ['active', 'scheduled'] },
        isActive: true
    });

    if (existingSponsorship) {
        return res.status(400).json({
            success: false,
            message: "Product already has an active sponsorship"
        });
    }

    // Validate dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (start >= end) {
        return res.status(400).json({
            success: false,
            message: "End date must be after start date"
        });
    }

    const sponsoredProduct = new SponsoredProduct({
        productId,
        sponsorshipType,
        startDate: start,
        endDate: end,
        budget: parseFloat(budget),
        dailyCost: parseFloat(dailyCost),
        priority: parseInt(priority),
        targetAudience: {
            ageRange: targetAudience.ageRange || { min: 18, max: 65 },
            location: {
                districts: targetAudience.location?.districts || SIERRA_LEONE_LOCATIONS.districts,
                regions: targetAudience.location?.regions || SIERRA_LEONE_LOCATIONS.regions
            },
            interests: targetAudience.interests || [],
            deviceTypes: targetAudience.deviceTypes || ['mobile', 'tablet', 'desktop']
        },
        displaySettings: {
            showInFeed: displaySettings.showInFeed !== false,
            showInSearch: displaySettings.showInSearch !== false,
            showInCategory: displaySettings.showInCategory !== false,
            boostInRanking: displaySettings.boostInRanking !== false
        },
        createdBy: '507f1f77bcf86cd799439011', // Default admin ID - update as needed
        notes
    });

    await sponsoredProduct.save();

    res.status(201).json({
        success: true,
        message: "Sponsored product created successfully",
        data: await SponsoredProduct.findById(sponsoredProduct._id).populate('productId')
    });
}));

/**
 * @route   GET /api/sponsored
 * @desc    Get all sponsored products with filtering
 * @access  Admin
 */
router.get('/', asyncHandler(async (req, res) => {
    const {
        status,
        sponsorshipType,
        isActive,
        page = 1,
        limit = 20,
        sortBy = 'createdAt',
        sortOrder = 'desc',
        includeExpired = 'false'
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build query
    const query = {};
    
    if (status) query.status = status;
    if (sponsorshipType) query.sponsorshipType = sponsorshipType;
    if (isActive !== undefined) query.isActive = isActive === 'true';
    
    // Handle expired products
    if (includeExpired === 'false') {
        query.endDate = { $gte: new Date() };
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const [sponsoredProducts, totalCount] = await Promise.all([
        SponsoredProduct.find(query)
            .populate('productId', 'name price images quantity')
            .populate('createdBy', 'fullName')
            .sort(sortOptions)
            .skip(skip)
            .limit(limitNum),
        SponsoredProduct.countDocuments(query)
    ]);

    res.json({
        success: true,
        message: "Sponsored products retrieved successfully",
        data: {
            sponsoredProducts,
            pagination: {
                currentPage: pageNum,
                totalPages: Math.ceil(totalCount / limitNum),
                totalItems: totalCount,
                hasMore: pageNum * limitNum < totalCount
            }
        }
    });
}));

/**
 * @route   GET /api/sponsored/active
 * @desc    Get currently active sponsored products for frontend display
 * @access  Public
 */
router.get('/active', asyncHandler(async (req, res) => {
    const { limit = 50, priority = 5 } = req.query;

    const activeSponsored = await SponsoredProduct.getActiveSponsored({ 
        limit: parseInt(limit) 
    });

    res.json({
        success: true,
        message: "Active sponsored products retrieved",
        data: activeSponsored
    });
}));

/**
 * @route   GET /api/sponsored/:id
 * @desc    Get sponsored product by ID
 * @access  Admin
 */
router.get('/:id', asyncHandler(async (req, res) => {
    const sponsoredProduct = await SponsoredProduct.findById(req.params.id)
        .populate('productId')
        .populate('createdBy', 'fullName');

    if (!sponsoredProduct) {
        return res.status(404).json({
            success: false,
            message: "Sponsored product not found"
        });
    }

    res.json({
        success: true,
        message: "Sponsored product retrieved successfully",
        data: sponsoredProduct
    });
}));

/**
 * @route   PUT /api/sponsored/:id
 * @desc    Update sponsored product
 * @access  Admin
 */
router.put('/:id', asyncHandler(async (req, res) => {
    const updates = req.body;
    
    // Remove fields that shouldn't be updated directly
    delete updates._id;
    delete updates.createdAt;
    delete updates.analytics;

    const sponsoredProduct = await SponsoredProduct.findByIdAndUpdate(
        req.params.id,
        { $set: updates },
        { new: true, runValidators: true }
    ).populate('productId');

    if (!sponsoredProduct) {
        return res.status(404).json({
            success: false,
            message: "Sponsored product not found"
        });
    }

    res.json({
        success: true,
        message: "Sponsored product updated successfully",
        data: sponsoredProduct
    });
}));

/**
 * @route   PUT /api/sponsored/:id/status
 * @desc    Update sponsored product status
 * @access  Admin
 */
router.put('/:id/status', asyncHandler(async (req, res) => {
    const { status, isActive } = req.body;

    if (!status && isActive === undefined) {
        return res.status(400).json({
            success: false,
            message: "Status or isActive field required"
        });
    }

    const updateData = {};
    if (status) updateData.status = status;
    if (isActive !== undefined) updateData.isActive = isActive;

    const sponsoredProduct = await SponsoredProduct.findByIdAndUpdate(
        req.params.id,
        { $set: updateData },
        { new: true }
    ).populate('productId');

    if (!sponsoredProduct) {
        return res.status(404).json({
            success: false,
            message: "Sponsored product not found"
        });
    }

    res.json({
        success: true,
        message: "Status updated successfully",
        data: sponsoredProduct
    });
}));

/**
 * @route   POST /api/sponsored/bulk
 * @desc    Create multiple sponsored products
 * @access  Admin
 */
router.post('/bulk', asyncHandler(async (req, res) => {
    const { productIds, sponsorshipData } = req.body;

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
        return res.status(400).json({
            success: false,
            message: "Product IDs array is required"
        });
    }

    const results = {
        created: [],
        failed: [],
        existing: []
    };

    for (const productId of productIds) {
        try {
            // Check if product exists
            const product = await Product.findById(productId);
            if (!product) {
                results.failed.push({ productId, reason: "Product not found" });
                continue;
            }

            // Check for existing sponsorship
            const existing = await SponsoredProduct.findOne({
                productId,
                status: { $in: ['active', 'scheduled'] },
                isActive: true
            });

            if (existing) {
                results.existing.push({ productId, reason: "Already sponsored" });
                continue;
            }

            // Create sponsored product
            const sponsoredProduct = new SponsoredProduct({
                productId,
                ...sponsorshipData,
                createdBy: '507f1f77bcf86cd799439011' // Default admin ID
            });

            await sponsoredProduct.save();
            results.created.push(productId);

        } catch (error) {
            results.failed.push({ productId, reason: error.message });
        }
    }

    res.json({
        success: true,
        message: `Bulk operation completed. Created: ${results.created.length}, Failed: ${results.failed.length}, Existing: ${results.existing.length}`,
        data: results
    });
}));

/**
 * @route   PUT /api/sponsored/bulk/status
 * @desc    Update multiple sponsored products status
 * @access  Admin
 */
router.put('/bulk/status', asyncHandler(async (req, res) => {
    const { sponsoredIds, status, isActive } = req.body;

    if (!sponsoredIds || !Array.isArray(sponsoredIds)) {
        return res.status(400).json({
            success: false,
            message: "Sponsored IDs array is required"
        });
    }

    const updateData = {};
    if (status) updateData.status = status;
    if (isActive !== undefined) updateData.isActive = isActive;

    const result = await SponsoredProduct.updateMany(
        { _id: { $in: sponsoredIds } },
        { $set: updateData }
    );

    res.json({
        success: true,
        message: `Updated ${result.modifiedCount} sponsored products`,
        data: { modifiedCount: result.modifiedCount }
    });
}));

/**
 * @route   POST /api/sponsored/:id/track
 * @desc    Track sponsored product interactions
 * @access  Public
 */
router.post('/:id/track', asyncHandler(async (req, res) => {
    const { action, value = 1, metadata = {} } = req.body;
    
    if (!['view', 'click', 'conversion'].includes(action)) {
        return res.status(400).json({
            success: false,
            message: "Invalid action. Use: view, click, or conversion"
        });
    }

    const sponsoredProduct = await SponsoredProduct.findById(req.params.id);
    
    if (!sponsoredProduct) {
        return res.status(404).json({
            success: false,
            message: "Sponsored product not found"
        });
    }

    // Update analytics
    sponsoredProduct.updateAnalytics(action, value);

    // Update daily stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let dailyStat = sponsoredProduct.analytics.dailyStats.find(
        stat => stat.date.getTime() === today.getTime()
    );
    
    if (!dailyStat) {
        dailyStat = {
            date: today,
            views: 0,
            clicks: 0,
            conversions: 0,
            spent: 0
        };
        sponsoredProduct.analytics.dailyStats.push(dailyStat);
    }
    
    dailyStat[action === 'conversion' ? 'conversions' : action + 's'] += value;
    
    // Update spent amount for clicks
    if (action === 'click') {
        dailyStat.spent += sponsoredProduct.dailyCost;
        sponsoredProduct.totalSpent += sponsoredProduct.dailyCost;
    }

    await sponsoredProduct.save();

    res.json({
        success: true,
        message: "Interaction tracked successfully"
    });
}));

/**
 * @route   GET /api/sponsored/analytics/summary
 * @desc    Get sponsored products analytics summary
 * @access  Admin
 */
router.get('/analytics/summary', asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    const matchConditions = {};
    if (startDate || endDate) {
        matchConditions.createdAt = {};
        if (startDate) matchConditions.createdAt.$gte = new Date(startDate);
        if (endDate) matchConditions.createdAt.$lte = new Date(endDate);
    }

    const summary = await SponsoredProduct.aggregate([
        { $match: matchConditions },
        {
            $group: {
                _id: null,
                totalCampaigns: { $sum: 1 },
                activeCampaigns: {
                    $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
                },
                totalBudget: { $sum: '$budget' },
                totalSpent: { $sum: '$totalSpent' },
                totalViews: { $sum: '$analytics.totalViews' },
                totalClicks: { $sum: '$analytics.totalClicks' },
                totalConversions: { $sum: '$analytics.totalConversions' },
                avgCTR: { $avg: '$analytics.ctr' },
                avgConversionRate: { $avg: '$analytics.conversionRate' },
                avgROI: { $avg: '$analytics.roi' }
            }
        }
    ]);

    const result = summary[0] || {
        totalCampaigns: 0,
        activeCampaigns: 0,
        totalBudget: 0,
        totalSpent: 0,
        totalViews: 0,
        totalClicks: 0,
        totalConversions: 0,
        avgCTR: 0,
        avgConversionRate: 0,
        avgROI: 0
    };

    res.json({
        success: true,
        message: "Analytics summary retrieved successfully",
        data: result
    });
}));

/**
 * @route   DELETE /api/sponsored/:id
 * @desc    Delete sponsored product
 * @access  Admin
 */
router.delete('/:id', asyncHandler(async (req, res) => {
    const sponsoredProduct = await SponsoredProduct.findByIdAndDelete(req.params.id);

    if (!sponsoredProduct) {
        return res.status(404).json({
            success: false,
            message: "Sponsored product not found"
        });
    }

    res.json({
        success: true,
        message: "Sponsored product deleted successfully"
    });
}));

// Export Sierra Leone locations for use in frontend
router.get('/locations/sierra-leone', asyncHandler(async (req, res) => {
    res.json({
        success: true,
        message: "Sierra Leone locations retrieved",
        data: SIERRA_LEONE_LOCATIONS
    });
}));

module.exports = router;