const express = require('express');
const router = express.Router();
const Product = require('../model/product'); // Adjust path to your model
const User = require('../model/user'); // Adjust path to your model

// Helper function to generate HTML with Open Graph metadata
function generateHTMLWithOG(ogData) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    
    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="${ogData.type || 'website'}" />
    <meta property="og:url" content="${ogData.url}" />
    <meta property="og:title" content="${ogData.title}" />
    <meta property="og:description" content="${ogData.description}" />
    <meta property="og:image" content="${ogData.image}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    
    <!-- Twitter -->
    <meta property="twitter:card" content="summary_large_image" />
    <meta property="twitter:url" content="${ogData.url}" />
    <meta property="twitter:title" content="${ogData.title}" />
    <meta property="twitter:description" content="${ogData.description}" />
    <meta property="twitter:image" content="${ogData.image}" />
    
    <!-- WhatsApp -->
    <meta property="og:site_name" content="Salone Fast Market" />
    
    <title>${ogData.title}</title>
    
    <!-- Redirect to Flutter web app after metadata is loaded -->
    <script>
        // Give social media crawlers time to read metadata
        setTimeout(function() {
            window.location.href = 'https://salonefastmarket.com/app';
        }, 1000);
    </script>
    
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #2E7D32 0%, #4CAF50 100%);
        }
        .container {
            text-align: center;
            color: white;
            padding: 40px;
        }
        .logo {
            width: 100px;
            height: 100px;
            margin-bottom: 20px;
        }
        h1 {
            font-size: 24px;
            margin-bottom: 10px;
        }
        p {
            font-size: 16px;
            opacity: 0.9;
        }
        .spinner {
            margin: 20px auto;
            width: 40px;
            height: 40px;
            border: 4px solid rgba(255,255,255,0.3);
            border-top-color: white;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="container">
        <img src="https://www.salonefastmarket.com/assets/images/logo.png" alt="Logo" class="logo">
        <h1>${ogData.title}</h1>
        <p>Redirecting to app...</p>
        <div class="spinner"></div>
    </div>
</body>
</html>
  `;
}

// ============================================================================
// PRODUCT ROUTE
// ============================================================================
router.get('/product/:slugWithId', async (req, res) => {
  try {
    const { slugWithId } = req.params;
    
    // Extract product ID from slug-id format
    const parts = slugWithId.split('-');
    const productId = parts[parts.length - 1];
    
    console.log(`📦 Fetching product: ${productId}`);
    
    // Fetch product from database
    const product = await Product.findById(productId)
      .populate('sellerId', 'name businessInfo')
      .populate('subcategoryId', 'name')
      .lean();
    
    if (!product) {
      console.log(`⚠️ Product not found: ${productId}`);
      return res.status(404).send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Product Not Found</title>
</head>
<body>
    <h1>Product Not Found</h1>
    <p>This product may have been removed or is no longer available.</p>
    <a href="https://salonefastmarket.com/app">Browse Products</a>
</body>
</html>
      `);
    }
    
    // Get product image (first image or fallback to logo)
    const productImage = product.images && product.images.length > 0
      ? product.images[0].url
      : 'https://www.salonefastmarket.com/assets/images/logo.png';
    
    // Get price text
    const price = product.offerPrice && product.offerPrice < product.price
      ? `Le ${product.offerPrice} (Was Le ${product.price})`
      : `Le ${product.price}`;
    
    // Get seller name
    const sellerName = product.sellerId?.businessInfo?.businessName 
      || product.sellerId?.name 
      || 'Salone Fast Market';
    
    // Build description
    const description = product.description
      ? `${price} - ${product.description.substring(0, 150)}...`
      : `${price} - Available on Salone Fast Market`;
    
    // Generate Open Graph data
    const ogData = {
      type: 'product',
      url: `https://salonefastmarket.com/product/${slugWithId}`,
      title: `${product.name} - ${sellerName}`,
      description: description,
      image: productImage,
    };
    
    console.log(`✅ Serving product page: ${product.name}`);
    
    // Return HTML with Open Graph metadata
    res.send(generateHTMLWithOG(ogData));
    
  } catch (error) {
    console.error('❌ Error serving product page:', error);
    res.status(500).send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Error</title>
</head>
<body>
    <h1>Error Loading Product</h1>
    <p>An error occurred while loading this product.</p>
    <a href="https://salonefastmarket.com/app">Return to Home</a>
</body>
</html>
    `);
  }
});

// ============================================================================
// STORE ROUTE
// ============================================================================
router.get('/store/:slugWithId', async (req, res) => {
  try {
    const { slugWithId } = req.params;
    
    // Extract seller ID from slug format
    const parts = slugWithId.split('-');
    const sellerId = parts[parts.length - 1];
    
    console.log(`🏪 Fetching store: ${sellerId}`);
    
    // Fetch seller from database
    const seller = await User.findById(sellerId)
      .select('name email businessInfo createdAt')
      .lean();
    
    if (!seller) {
      console.log(`⚠️ Store not found: ${sellerId}`);
      return res.status(404).send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Store Not Found</title>
</head>
<body>
    <h1>Store Not Found</h1>
    <p>This store may have been closed or is no longer available.</p>
    <a href="https://salonefastmarket.com/app">Browse Stores</a>
</body>
</html>
      `);
    }
    
    // Get business name
    const businessName = seller.businessInfo?.businessName || seller.name || 'Store';
    
    // Get business description
    const description = seller.businessInfo?.businessDescription 
      || 'Quality products, great service!'
      || 'Shop the best products on Salone Fast Market';
    
    // Count products for this seller
    const productCount = await Product.countDocuments({ 
      sellerId: sellerId,
      isDeleted: { $ne: true } 
    });
    
    // Get store image (use logo as fallback)
    const storeImage = 'https://www.salonefastmarket.com/assets/images/logo.png';
    
    // Generate Open Graph data
    const ogData = {
      type: 'website',
      url: `https://salonefastmarket.com/store/${slugWithId}`,
      title: `${businessName} - Salone Fast Market`,
      description: `${description} - ${productCount} products available`,
      image: storeImage,
    };
    
    console.log(`✅ Serving store page: ${businessName}`);
    
    // Return HTML with Open Graph metadata
    res.send(generateHTMLWithOG(ogData));
    
  } catch (error) {
    console.error('❌ Error serving store page:', error);
    res.status(500).send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Error</title>
</head>
<body>
    <h1>Error Loading Store</h1>
    <p>An error occurred while loading this store.</p>
    <a href="https://salonefastmarket.com/app">Return to Home</a>
</body>
</html>
    `);
  }
});

module.exports = router;