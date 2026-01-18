// backend/routes/api.js or add to your existing routes file
const express = require('express');
const router = express.Router();
const Product = require('../model/product'); // Adjust path to your model
const User = require('../model/user'); // Adjust path to your model

// ============================================================================
// PRODUCT ENDPOINTS
// ============================================================================

/**
 * GET /api/products/:productId
 * Get single product by ID (for deep links)
 */
router.get('/api/products/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    
    console.log(`📦 Fetching product: ${productId}`);
    
    const product = await Product.findById(productId)
      .populate('sellerId', 'name email businessInfo createdAt')
      .populate('proSubCategoryId', 'name')
      .populate('categoryId', 'name')
      .lean();
    
    if (!product) {
      console.log(`⚠️ Product not found: ${productId}`);
      return res.status(404).json({ 
        success: false,
        message: 'Product not found' 
      });
    }
    
    console.log(`✅ Product found: ${product.name}`);
    
    res.json({
      success: true,
      ...product
    });
  } catch (error) {
    console.error('❌ Error fetching product:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: error.message 
    });
  }
});

/**
 * GET /api/products/seller/:sellerId
 * Get all products by seller ID
 */
router.get('/api/products/seller/:sellerId', async (req, res) => {
  try {
    const { sellerId } = req.params;
    
    const products = await Product.find({ 
      sellerId: sellerId,
      isDeleted: { $ne: true } 
    })
      .populate('proCategoryId', 'name')      // ✅ KEEP
      .populate('proSubCategoryId', 'name')   // ✅ KEEP  
      .populate('proBrandId', 'name')
      .populate('sellerId', 'fullName email businessInfo createdAt') // ✅ ADD createdAt
      .sort({ createdAt: -1 })
      .lean();
    
    console.log(`✅ Found ${products.length} products for seller ${sellerId}`);
    
    res.json(products);  // Just return array
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});
// ============================================================================
// USER/SELLER ENDPOINTS
// ============================================================================

/**
 * GET /api/users/:userId
 * Get user/seller info by ID (for deep links)
 */
router.get('/api/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    console.log(`👤 Fetching user: ${userId}`);
    
    const user = await User.findById(userId)
      .select('name email phoneNumber businessInfo createdAt accountType')
      .lean();
    
    if (!user) {
      console.log(`⚠️ User not found: ${userId}`);
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }
    
    console.log(`✅ User found: ${user.name}`);
    
    res.json({
      success: true,
      ...user
    });
  } catch (error) {
    console.error('❌ Error fetching user:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: error.message 
    });
  }
});

/**
 * GET /api/sellers/:sellerId/stats
 * Get seller statistics (product count, sales, etc.)
 */
router.get('/api/sellers/:sellerId/stats', async (req, res) => {
  try {
    const { sellerId } = req.params;
    
    console.log(`📊 Fetching seller stats: ${sellerId}`);
    
    // Count total products
    const totalProducts = await Product.countDocuments({ 
      sellerId: sellerId,
      isDeleted: { $ne: true } 
    });
    
    // Count products by status
    const activeProducts = await Product.countDocuments({ 
      sellerId: sellerId,
      isDeleted: { $ne: true },
      quantity: { $gt: 0 }
    });
    
    const outOfStockProducts = await Product.countDocuments({ 
      sellerId: sellerId,
      isDeleted: { $ne: true },
      quantity: { $lte: 0 }
    });
    
    // If you have orders/sales model, calculate these:
    // const Order = require('../models/Order');
    // const totalSales = await Order.countDocuments({ sellerId });
    // const totalRevenue = await Order.aggregate([
    //   { $match: { sellerId: mongoose.Types.ObjectId(sellerId), status: 'completed' } },
    //   { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    // ]);
    
    const stats = {
      success: true,
      totalProducts,
      activeProducts,
      outOfStockProducts,
      totalSales: 0, // Implement with your Order model
      totalRevenue: 0, // Implement with your Order model
    };
    
    console.log(`✅ Seller stats:`, stats);
    
    res.json(stats);
  } catch (error) {
    console.error('❌ Error fetching seller stats:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: error.message,
      totalProducts: 0,
      totalSales: 0,
      totalRevenue: 0
    });
  }
});

// ============================================================================
// HEALTH CHECK
// ============================================================================

/**
 * GET /api/health
 * API health check endpoint
 */
router.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'API is running',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;