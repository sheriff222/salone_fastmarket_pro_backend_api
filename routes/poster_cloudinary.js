// routes/poster_cloudinary.js - Updated poster routes with Cloudinary
const express = require('express');
const router = express.Router();
const { Poster, PosterAnalytics } = require('../model/poster');
const Product = require('../model/product');
const User = require('../model/user');
const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const { uploadPosterImages, handleMulterError } = require('../middleware/uploadMiddleware.js');
const { 
    uploadPosterImage, 
    deleteFromCloudinary, 
    deleteMultipleFromCloudinary,
    extractPublicId 
} = require('../utils/cloudinaryUpload');

// For backward compatibility
const ExistingPoster = mongoose.model('ExistingPoster', new mongoose.Schema({}, { 
    strict: false, 
    collection: 'posters'
}));

// Get active posters for mobile app
router.get('/active', asyncHandler(async (req, res) => {
    try {
        const { userId } = req.query;
        const now = new Date();
        
        let activePosters = await Poster.find({
            isActive: true,
            startDate: { $lte: now },
            endDate: { $gte: now }
        })
        .populate('targetProductId', 'name price offerPrice images description') // ✅ ADDED description
        .populate('targetSellerId', 'fullName businessInfo')
        .sort({ priority: -1, createdAt: -1 });

        // ✅ Format posters with product description
        const formattedPosters = activePosters.map(poster => {
            const posterObj = poster.toObject();
            
            // Add product description to poster if available
            if (posterObj.targetProductId && posterObj.targetProductId.description) {
                posterObj.productDescription = posterObj.targetProductId.description;
            } else {
                posterObj.productDescription = posterObj.description || 'No description available';
            }
            
            return posterObj;
        });

        // Fallback to existing data if needed
        if (formattedPosters.length === 0) {
            const existingPosters = await ExistingPoster.find({});
            const fallbackPosters = existingPosters.map((poster, index) => ({
                _id: poster._id,
                title: poster.posterName || poster.title,
                description: poster.description || 'Featured Product',
                productDescription: poster.description || 'No description available',
                type: 'product',
                images: [{
                    _id: new mongoose.Types.ObjectId(),
                    url: poster.imageUrl,
                    filename: poster.imageUrl ? poster.imageUrl.split('/').pop() : '',
                    order: 0,
                    alt: poster.posterName || poster.title || 'Poster Image'
                }],
                priority: poster.priority || index,
                viewCount: poster.viewCount || 0,
                clickCount: poster.clickCount || 0
            }));

            return res.json({ 
                success: true, 
                message: "Active posters retrieved successfully.", 
                data: fallbackPosters
            });
        }

        res.json({ 
            success: true, 
            message: "Active posters retrieved successfully.", 
            data: formattedPosters
        });
    } catch (error) {
        console.error('Error fetching active posters:', error);
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Track poster click
router.post('/:id/click', asyncHandler(async (req, res) => {
    try {
        const posterId = req.params.id;
        const { userId, imageIndex, source } = req.body;

        let poster = await Poster.findById(posterId);
        let isNewModel = true;

        if (!poster) {
            poster = await ExistingPoster.findById(posterId);
            isNewModel = false;
        }

        if (!poster) {
            return res.status(404).json({
                success: false,
                message: "Poster not found"
            });
        }

        if (isNewModel) {
            await poster.incrementClickCount();
            
            const analyticsRecord = new PosterAnalytics({
                posterId,
                event: 'click',
                userId: userId || null,
                sessionId: req.headers['x-session-id'] || null,
                userAgent: req.get('User-Agent'),
                ipAddress: req.ip,
                metadata: {
                    imageIndex: imageIndex || 0,
                    source: source || 'mobile_app',
                    timestamp: new Date()
                }
            });
            await analyticsRecord.save();
        } else {
            try {
                await ExistingPoster.updateOne(
                    { _id: posterId }, 
                    { $inc: { clickCount: 1 } }
                );
            } catch (e) {
                console.log('Could not increment click count:', e.message);
            }
        }

        res.json({
            success: true,
            message: "Click tracked successfully"
        });
    } catch (error) {
        console.error('Error tracking click:', error);
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Track poster view
router.post('/:id/view', asyncHandler(async (req, res) => {
    try {
        const posterId = req.params.id;
        const { userId, source } = req.body;

        let poster = await Poster.findById(posterId);
        let isNewModel = true;

        if (!poster) {
            poster = await ExistingPoster.findById(posterId);
            isNewModel = false;
        }

        if (!poster) {
            return res.status(404).json({
                success: false,
                message: "Poster not found"
            });
        }

        if (isNewModel) {
            await poster.incrementViewCount();
            
            const analyticsRecord = new PosterAnalytics({
                posterId,
                event: 'view',
                userId: userId || null,
                sessionId: req.headers['x-session-id'] || null,
                userAgent: req.get('User-Agent'),
                ipAddress: req.ip,
                metadata: {
                    source: source || 'mobile_app',
                    timestamp: new Date()
                }
            });
            await analyticsRecord.save();
        } else {
            try {
                await ExistingPoster.updateOne(
                    { _id: posterId }, 
                    { $inc: { viewCount: 1 } }
                );
            } catch (e) {
                console.log('Could not increment view count:', e.message);
            }
        }

        res.json({
            success: true,
            message: "View tracked successfully"
        });
    } catch (error) {
        console.error('Error tracking view:', error);
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Get all posters (admin)
router.get('/admin/all', asyncHandler(async (req, res) => {
    try {
        const { page = 1, limit = 12, status = 'all', type = 'all' } = req.query;
        
        let query = {};
        const now = new Date();
        
        if (status === 'active') {
            query = {
                isActive: true,
                startDate: { $lte: now },
                endDate: { $gte: now }
            };
        } else if (status === 'inactive') {
            query.isActive = false;
        } else if (status === 'scheduled') {
            query.startDate = { $gt: now };
        } else if (status === 'expired') {
            query.endDate = { $lt: now };
        }
        
        if (type !== 'all') {
            query.type = type;
        }

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);

        const [posters, total] = await Promise.all([
            Poster.find(query)
                .populate('targetProductId', 'name price offerPrice images description') // ✅ ADDED description
                .populate('targetSellerId', 'fullName businessInfo')
                .populate('createdBy', 'fullName')
                .sort({ priority: -1, createdAt: -1 })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum),
            Poster.countDocuments(query)
        ]);

        // ✅ Format with product description
        const formattedPosters = posters.map(poster => {
            const posterObj = poster.toObject();
            
            if (posterObj.targetProductId && posterObj.targetProductId.description) {
                posterObj.productDescription = posterObj.targetProductId.description;
            } else {
                posterObj.productDescription = posterObj.description || 'No description available';
            }
            
            return posterObj;
        });

        res.json({ 
            success: true, 
            message: "Posters retrieved successfully.", 
            data: {
                posters: formattedPosters,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    pages: Math.ceil(total / limitNum)
                }
            }
        });
    } catch (error) {
        console.error('Error fetching admin posters:', error);
        res.status(500).json({ success: false, message: error.message });
    }
}));
// Create new poster with Cloudinary
router.post('/admin/create', uploadPosterImages.array('images', 5), asyncHandler(async (req, res) => {
    try {
        const {
            title,
            description,
            type,
            targetProductId,
            targetSellerId,
            startDate,
            endDate,
            priority,
            createdBy
        } = req.body;

        if (!title || !type || !createdBy) {
            return res.status(400).json({
                success: false,
                message: "Title, type, and createdBy are required"
            });
        }

        if (type === 'product' && !targetProductId) {
            return res.status(400).json({
                success: false,
                message: "Product ID is required for product posters"
            });
        }

        if (type === 'seller' && !targetSellerId) {
            return res.status(400).json({
                success: false,
                message: "Seller ID is required for seller posters"
            });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                message: "At least one image is required"
            });
        }

        if (type === 'product') {
            const product = await Product.findById(targetProductId);
            if (!product) {
                return res.status(404).json({
                    success: false,
                    message: "Target product not found"
                });
            }
        }

        if (type === 'seller') {
            const seller = await User.findById(targetSellerId);
            if (!seller || seller.accountType !== 'seller') {
                return res.status(404).json({
                    success: false,
                    message: "Target seller not found"
                });
            }
        }

        console.log(`Uploading ${req.files.length} poster images to Cloudinary...`);
        const images = [];
        
        for (let i = 0; i < req.files.length; i++) {
            const file = req.files[i];
            try {
                const uploadResult = await uploadPosterImage(
                    file.buffer,
                    file.originalname,
                    i
                );
                
                images.push({
                    url: uploadResult.url,
                    filename: uploadResult.filename,
                    publicId: uploadResult.publicId,
                    order: i,
                    alt: `${title} - Image ${i + 1}`
                });
                console.log(`Uploaded poster image ${i + 1}: ${uploadResult.url}`);
            } catch (uploadError) {
                console.error(`Failed to upload image ${i + 1}:`, uploadError);
                for (const img of images) {
                    try {
                        await deleteFromCloudinary(img.publicId);
                    } catch (cleanupError) {
                        console.error('Cleanup error:', cleanupError);
                    }
                }
                return res.status(500).json({
                    success: false,
                    message: `Failed to upload image ${i + 1}: ${uploadError.message}`
                });
            }
        }

        const poster = new Poster({
            title,
            description,
            type,
            targetProductId: type === 'product' ? targetProductId : undefined,
            targetSellerId: type === 'seller' ? targetSellerId : undefined,
            images,
            startDate: new Date(startDate || Date.now()),
            endDate: new Date(endDate || Date.now() + 30 * 24 * 60 * 60 * 1000),
            priority: parseInt(priority) || 0,
            isActive: true,
            createdBy
        });

        await poster.save();

        await poster.populate([
            { path: 'targetProductId', select: 'name price offerPrice images description' }, // ✅ ADDED description
            { path: 'targetSellerId', select: 'fullName businessInfo' },
            { path: 'createdBy', select: 'fullName' }
        ]);

        res.status(201).json({
            success: true,
            message: "Poster created successfully",
            data: poster
        });
    } catch (error) {
        console.error('Error creating poster:', error);
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Update poster with Cloudinary
router.put('/admin/:id', uploadPosterImages.array('images', 5), asyncHandler(async (req, res) => {
    try {
        const posterId = req.params.id;
        const {
            title,
            description,
            type,
            targetProductId,
            targetSellerId,
            startDate,
            endDate,
            priority,
            isActive,
            keepExistingImages
        } = req.body;

        const poster = await Poster.findById(posterId);
        if (!poster) {
            return res.status(404).json({
                success: false,
                message: "Poster not found"
            });
        }

        // Update basic fields
        if (title) poster.title = title;
        if (description !== undefined) poster.description = description;
        if (type) poster.type = type;
        if (startDate) poster.startDate = new Date(startDate);
        if (endDate) poster.endDate = new Date(endDate);
        if (priority !== undefined) poster.priority = parseInt(priority);
        if (isActive !== undefined) poster.isActive = isActive === 'true' || isActive === true;

        // Update targets
        if (type === 'product') {
            if (targetProductId) {
                const product = await Product.findById(targetProductId);
                if (!product) {
                    return res.status(404).json({
                        success: false,
                        message: "Target product not found"
                    });
                }
                poster.targetProductId = targetProductId;
            }
            poster.targetSellerId = undefined;
        } else if (type === 'seller') {
            if (targetSellerId) {
                const seller = await User.findById(targetSellerId);
                if (!seller || seller.accountType !== 'seller') {
                    return res.status(404).json({
                        success: false,
                        message: "Target seller not found"
                    });
                }
                poster.targetSellerId = targetSellerId;
            }
            poster.targetProductId = undefined;
        }

        // Handle images
        if (req.files && req.files.length > 0) {
            const shouldKeep = keepExistingImages === 'true';
            
            if (!shouldKeep && poster.images && poster.images.length > 0) {
                // Delete old images from Cloudinary
                console.log('Deleting old poster images from Cloudinary...');
                const publicIds = poster.images
                    .map(img => img.publicId || extractPublicId(img.url))
                    .filter(Boolean);
                
                if (publicIds.length > 0) {
                    try {
                        await deleteMultipleFromCloudinary(publicIds);
                    } catch (delError) {
                        console.error('Could not delete old images:', delError.message);
                    }
                }
                poster.images = [];
            }

            // Upload new images
            for (let i = 0; i < req.files.length; i++) {
                const file = req.files[i];
                try {
                    const uploadResult = await uploadPosterImage(
                        file.buffer,
                        file.originalname,
                        poster.images.length + i
                    );
                    
                    poster.images.push({
                        url: uploadResult.url,
                        filename: uploadResult.filename,
                        publicId: uploadResult.publicId,
                        order: poster.images.length,
                        alt: `${title || poster.title} - Image ${poster.images.length + 1}`
                    });
                } catch (uploadError) {
                    console.error(`Failed to upload image ${i + 1}:`, uploadError);
                    // Optional: clean up new uploads on error
                }
            }
        }

        await poster.save();

        await poster.populate([
            { path: 'targetProductId', select: 'name price images' },
            { path: 'targetSellerId', select: 'fullName businessInfo' },
            { path: 'createdBy', select: 'fullName' }
        ]);

        res.json({
            success: true,
            message: "Poster updated successfully",
            data: poster
        });
    } catch (error) {
        console.error('Error updating poster:', error);
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Delete poster (also deletes images from Cloudinary)
router.delete('/admin/:id', asyncHandler(async (req, res) => {
    try {
        const posterId = req.params.id;
        const poster = await Poster.findById(posterId);
        
        if (!poster) {
            return res.status(404).json({
                success: false,
                message: "Poster not found"
            });
        }

        // Delete images from Cloudinary
        if (poster.images && poster.images.length > 0) {
            console.log(`Deleting ${poster.images.length} poster images from Cloudinary...`);
            const publicIds = poster.images
                .map(img => img.publicId || extractPublicId(img.url))
                .filter(Boolean);
            
            if (publicIds.length > 0) {
                try {
                    await deleteMultipleFromCloudinary(publicIds);
                    console.log('Images deleted from Cloudinary');
                } catch (delError) {
                    console.error('Could not delete images:', delError.message);
                }
            }
        }

        // Delete analytics data
        await PosterAnalytics.deleteMany({ posterId: poster._id });

        // Delete poster
        await Poster.findByIdAndDelete(posterId);
        
        res.json({
            success: true,
            message: "Poster and images deleted successfully"
        });
    } catch (error) {
        console.error('Error deleting poster:', error);
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Search products for poster linking
router.get('/admin/search-products', asyncHandler(async (req, res) => {
    try {
        const { search, page = 1, limit = 20 } = req.query;
        
        let query = { quantity: { $gt: 0 } };
        if (search && search.trim()) {
            query.$or = [
                { name: { $regex: search.trim(), $options: 'i' } },
                { description: { $regex: search.trim(), $options: 'i' } }
            ];
        }

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);

        const [products, total] = await Promise.all([
            Product.find(query)
                .select('name price offerPrice images description proCategoryId sellerName') // ✅ ADDED description
                .populate('proCategoryId', 'name')
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum)
                .sort({ createdAt: -1 }),
            Product.countDocuments(query)
        ]);

        res.json({ 
            success: true, 
            message: "Products retrieved successfully.", 
            data: {
                products,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    pages: Math.ceil(total / limitNum)
                }
            }
        });
    } catch (error) {
        console.error('Error searching products:', error);
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Search sellers for poster linking
router.get('/admin/search-sellers', asyncHandler(async (req, res) => {
    try {
        const { search, page = 1, limit = 20 } = req.query;
        
        let query = { accountType: 'seller' };
        if (search && search.trim()) {
            query.$or = [
                { fullName: { $regex: search.trim(), $options: 'i' } },
                { 'businessInfo.businessName': { $regex: search.trim(), $options: 'i' } }
            ];
        }

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);

        const [sellers, total] = await Promise.all([
            User.find(query)
                .select('fullName businessInfo phoneNumber')
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum)
                .sort({ createdAt: -1 }),
            User.countDocuments(query)
        ]);

        res.json({ 
            success: true, 
            message: "Sellers retrieved successfully.", 
            data: {
                sellers,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    pages: Math.ceil(total / limitNum)
                }
            }
        });
    } catch (error) {
        console.error('Error searching sellers:', error);
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Get single poster details
router.get('/:id', asyncHandler(async (req, res) => {
    try {
        const poster = await Poster.findById(req.params.id)
            .populate('targetProductId', 'name price offerPrice images description quantity proCategoryId') // ✅ ADDED description
            .populate('targetSellerId', 'fullName businessInfo')
            .populate('createdBy', 'fullName');

        if (!poster) {
            return res.status(404).json({
                success: false,
                message: "Poster not found"
            });
        }

        // ✅ Format with product description
        const posterObj = poster.toObject();
        
        if (posterObj.targetProductId && posterObj.targetProductId.description) {
            posterObj.productDescription = posterObj.targetProductId.description;
        } else {
            posterObj.productDescription = posterObj.description || 'No description available';
        }

        res.json({
            success: true,
            message: "Poster retrieved successfully",
            data: posterObj
        });
    } catch (error) {
        console.error('Error fetching poster:', error);
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Get poster analytics
router.get('/admin/analytics/:id', asyncHandler(async (req, res) => {
    try {
        const posterId = req.params.id;
        const { period = '7d' } = req.query;
        
        let dateRange;
        switch (period) {
            case '7d':
                dateRange = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                break;
            case '30d':
                dateRange = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                break;
            default:
                dateRange = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        }

        // Get poster details
        const poster = await Poster.findById(posterId)
            .populate('targetProductId', 'name')
            .populate('targetSellerId', 'fullName');

        if (!poster) {
            return res.status(404).json({
                success: false,
                message: "Poster not found"
            });
        }

        // Get analytics data
        const analyticsData = await PosterAnalytics.aggregate([
            {
                $match: {
                    posterId: new mongoose.Types.ObjectId(posterId),
                    createdAt: { $gte: dateRange }
                }
            },
            {
                $group: {
                    _id: {
                        event: '$event',
                        date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }
                    },
                    count: { $sum: 1 }
                }
            },
            {
                $sort: { '_id.date': 1 }
            }
        ]);

        // Process data for charts
        const dailyStats = {};
        analyticsData.forEach(item => {
            const date = item._id.date;
            if (!dailyStats[date]) {
                dailyStats[date] = { views: 0, clicks: 0 };
            }
            dailyStats[date][item._id.event + 's'] = item.count;
        });

        // Calculate totals and CTR
        const totalViews = poster.viewCount || 0;
        const totalClicks = poster.clickCount || 0;
        const ctr = totalViews > 0 ? ((totalClicks / totalViews) * 100).toFixed(2) : 0;

        res.json({
            success: true,
            message: "Analytics retrieved successfully",
            data: {
                poster: {
                    id: poster._id,
                    title: poster.title,
                    type: poster.type
                },
                summary: {
                    totalViews,
                    totalClicks,
                    clickThroughRate: ctr
                },
                dailyStats,
                period
            }
        });
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
}));

// Health check endpoint
router.get('/admin/health', asyncHandler(async (req, res) => {
    try {
        const now = new Date();
        
        const [
            totalPosters,
            activePosters,
            productPosters,
            sellerPosters,
            scheduledPosters,
            expiredPosters,
            recentAnalytics
        ] = await Promise.all([
            Poster.countDocuments(),
            Poster.countDocuments({ 
                isActive: true,
                startDate: { $lte: now },
                endDate: { $gte: now }
            }),
            Poster.countDocuments({ type: 'product' }),
            Poster.countDocuments({ type: 'seller' }),
            Poster.countDocuments({ 
                isActive: true,
                startDate: { $gt: now }
            }),
            Poster.countDocuments({ 
                endDate: { $lt: now }
            }),
            PosterAnalytics.countDocuments({
                createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
            })
        ]);

        res.json({
            success: true,
            message: "Health check completed",
            data: {
                totalPosters,
                activePosters,
                scheduledPosters,
                expiredPosters,
                productPosters,
                sellerPosters,
                recentAnalytics,
                timestamp: new Date()
            }
        });
    } catch (error) {
        console.error('Health check error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
}));

// Debug endpoint for development
router.get('/debug/raw', asyncHandler(async (req, res) => {
    try {
        const [newPosters, existingPosters] = await Promise.all([
            Poster.find({}).limit(3),
            ExistingPoster.find({}).limit(3)
        ]);
        
        res.json({
            success: true,
            message: "Debug poster data",
            data: {
                newModel: {
                    count: newPosters.length,
                    posters: newPosters
                },
                existingModel: {
                    count: existingPosters.length,
                    posters: existingPosters
                }
            }
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
}));

// Migration utility - move existing posters to new model
router.post('/admin/migrate', asyncHandler(async (req, res) => {
    try {
        console.log('Starting poster migration...');
        
        // Get all existing posters
        const existingPosters = await ExistingPoster.find({});
        console.log(`Found ${existingPosters.length} existing posters to migrate`);
        
        let migratedCount = 0;
        let skippedCount = 0;
        const errors = [];
        
        for (const existingPoster of existingPosters) {
            try {
                // Check if already migrated by checking if a poster with similar title exists
                const posterTitle = existingPoster.posterName || existingPoster.title || `Migrated Poster ${existingPoster._id}`;
                const alreadyMigrated = await Poster.findOne({ 
                    title: { $regex: new RegExp(posterTitle, 'i') }
                });
                
                if (alreadyMigrated) {
                    skippedCount++;
                    continue;
                }
                
                // Create new poster from existing data
                const newPoster = new Poster({
                    title: posterTitle,
                    description: existingPoster.description || 'Migrated from existing poster data',
                    type: 'product', // Default type for existing posters
                    images: existingPoster.imageUrl ? [{
                        url: existingPoster.imageUrl,
                        filename: existingPoster.imageUrl.split('/').pop() || `migrated-${existingPoster._id}`,
                        order: 0,
                        alt: posterTitle
                    }] : [],
                    startDate: existingPoster.createdAt || new Date(),
                    endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
                    priority: existingPoster.priority || 0,
                    isActive: true,
                    viewCount: existingPoster.viewCount || 0,
                    clickCount: existingPoster.clickCount || 0,
                    createdBy: '60f1b2b4c8d4f12345678901', // Default admin ID - CHANGE THIS
                    createdAt: existingPoster.createdAt || new Date(),
                    updatedAt: existingPoster.updatedAt || new Date()
                });
                
                await newPoster.save();
                migratedCount++;
                console.log(`Migrated poster: ${posterTitle}`);
                
            } catch (error) {
                console.error(`Error migrating poster ${existingPoster._id}:`, error.message);
                errors.push({
                    posterId: existingPoster._id,
                    error: error.message
                });
            }
        }
        
        console.log(`Migration completed: ${migratedCount} migrated, ${skippedCount} skipped, ${errors.length} errors`);
        
        res.json({
            success: true,
            message: "Poster migration completed",
            data: {
                totalFound: existingPosters.length,
                migrated: migratedCount,
                skipped: skippedCount,
                errors: errors.length,
                errorDetails: errors
            }
        });
        
    } catch (error) {
        console.error('Migration error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
}));

// Export/backup posters
router.get('/admin/export', asyncHandler(async (req, res) => {
    try {
        const { format = 'json' } = req.query;
        
        const posters = await Poster.find({})
            .populate('targetProductId', 'name price')
            .populate('targetSellerId', 'fullName businessInfo')
            .populate('createdBy', 'fullName')
            .sort({ createdAt: -1 });

        if (format === 'csv') {
            // Simple CSV export
            const csvHeader = 'ID,Title,Type,Status,Priority,Views,Clicks,Created,Updated\n';
            const csvRows = posters.map(poster => {
                const status = poster.isActive ? 'Active' : 'Inactive';
                return [
                    poster._id,
                    `"${poster.title.replace(/"/g, '""')}"`,
                    poster.type,
                    status,
                    poster.priority,
                    poster.viewCount || 0,
                    poster.clickCount || 0,
                    poster.createdAt.toISOString(),
                    poster.updatedAt.toISOString()
                ].join(',');
            }).join('\n');
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="posters-export-${new Date().toISOString().split('T')[0]}.csv"`);
            res.send(csvHeader + csvRows);
        } else {
            // JSON export
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="posters-export-${new Date().toISOString().split('T')[0]}.json"`);
            res.json({
                exported: new Date().toISOString(),
                count: posters.length,
                posters: posters
            });
        }
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
}));

// Import posters (for backup restoration)
router.post('/admin/import', uploadPosterImages.single('importFile'), asyncHandler(async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "Import file is required"
            });
        }

        const fileContent = req.file.buffer.toString('utf8');
        let importData;
        
        try {
            importData = JSON.parse(fileContent);
        } catch (parseError) {
            return res.status(400).json({
                success: false,
                message: "Invalid JSON file format"
            });
        }

        if (!importData.posters || !Array.isArray(importData.posters)) {
            return res.status(400).json({
                success: false,
                message: "Invalid import data structure"
            });
        }

        let importedCount = 0;
        let skippedCount = 0;
        const errors = [];

        for (const posterData of importData.posters) {
            try {
                // Check if poster already exists
                const existingPoster = await Poster.findById(posterData._id);
                if (existingPoster) {
                    skippedCount++;
                    continue;
                }

                // Remove populated fields and create new poster
                const cleanPosterData = { ...posterData };
                delete cleanPosterData._id;
                delete cleanPosterData.__v;
                delete cleanPosterData.createdAt;
                delete cleanPosterData.updatedAt;
                
                // Handle populated references
                if (typeof cleanPosterData.targetProductId === 'object' && cleanPosterData.targetProductId) {
                    cleanPosterData.targetProductId = cleanPosterData.targetProductId._id || cleanPosterData.targetProductId;
                }
                if (typeof cleanPosterData.targetSellerId === 'object' && cleanPosterData.targetSellerId) {
                    cleanPosterData.targetSellerId = cleanPosterData.targetSellerId._id || cleanPosterData.targetSellerId;
                }
                if (typeof cleanPosterData.createdBy === 'object' && cleanPosterData.createdBy) {
                    cleanPosterData.createdBy = cleanPosterData.createdBy._id || cleanPosterData.createdBy;
                }

                const newPoster = new Poster(cleanPosterData);
                await newPoster.save();
                importedCount++;
                
            } catch (error) {
                console.error(`Error importing poster:`, error.message);
                errors.push({
                    poster: posterData.title || posterData._id,
                    error: error.message
                });
            }
        }

        res.json({
            success: true,
            message: "Import completed",
            data: {
                totalAttempted: importData.posters.length,
                imported: importedCount,
                skipped: skippedCount,
                errors: errors.length,
                errorDetails: errors
            }
        });

    } catch (error) {
        console.error('Import error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
}));

// Get poster statistics
router.get('/admin/stats', asyncHandler(async (req, res) => {
    try {
        const { period = '30d' } = req.query;
        
        let dateRange;
        switch (period) {
            case '7d':
                dateRange = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                break;
            case '30d':
                dateRange = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                break;
            case '90d':
                dateRange = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
                break;
            default:
                dateRange = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        }

        const [
            totalStats,
            periodStats,
            topPerformers,
            recentActivity
        ] = await Promise.all([
            Poster.aggregate([
                {
                    $group: {
                        _id: null,
                        totalPosters: { $sum: 1 },
                        totalViews: { $sum: '$viewCount' },
                        totalClicks: { $sum: '$clickCount' },
                        activePosters: {
                            $sum: {
                                $cond: [
                                    { $eq: ['$isActive', true] },
                                    1,
                                    0
                                ]
                            }
                        }
                    }
                }
            ]),
            Poster.aggregate([
                {
                    $match: {
                        createdAt: { $gte: dateRange }
                    }
                },
                {
                    $group: {
                        _id: null,
                        newPosters: { $sum: 1 },
                        newViews: { $sum: '$viewCount' },
                        newClicks: { $sum: '$clickCount' }
                    }
                }
            ]),
            Poster.find({})
                .select('title viewCount clickCount type')
                .sort({ viewCount: -1 })
                .limit(10),
            PosterAnalytics.aggregate([
                {
                    $match: {
                        createdAt: { $gte: dateRange }
                    }
                },
                {
                    $group: {
                        _id: {
                            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                            event: '$event'
                        },
                        count: { $sum: 1 }
                    }
                },
                {
                    $sort: { '_id.date': -1 }
                },
                {
                    $limit: 50
                }
            ])
        ]);

        const stats = totalStats[0] || { totalPosters: 0, totalViews: 0, totalClicks: 0, activePosters: 0 };
        const periodData = periodStats[0] || { newPosters: 0, newViews: 0, newClicks: 0 };

        // Calculate CTR
        const overallCTR = stats.totalViews > 0 ? ((stats.totalClicks / stats.totalViews) * 100).toFixed(2) : 0;

        res.json({
            success: true,
            message: "Statistics retrieved successfully",
            data: {
                overview: {
                    ...stats,
                    overallCTR: `${overallCTR}%`
                },
                period: {
                    ...periodData,
                    period,
                    dateRange: dateRange.toISOString()
                },
                topPerformers: topPerformers.map(poster => ({
                    id: poster._id,
                    title: poster.title,
                    type: poster.type,
                    views: poster.viewCount || 0,
                    clicks: poster.clickCount || 0,
                    ctr: poster.viewCount > 0 ? ((poster.clickCount || 0) / poster.viewCount * 100).toFixed(2) : 0
                })),
                recentActivity
            }
        });

    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
}));

module.exports = router;