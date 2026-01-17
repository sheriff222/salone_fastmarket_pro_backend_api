// backend/routes/shareRoutes.js
const express = require('express');
const router = express.Router();
const Product = require('../models/Product'); // Adjust to your model path
const User = require('../models/User'); // Adjust to your model path

// Helper function to generate HTML with Open Graph
function generateHTMLWithOG(ogData) {
  return `<!DOCTYPE html>
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
    
    <!-- Twitter -->
    <meta property="twitter:card" content="summary_large_image" />
    <meta property="twitter:title" content="${ogData.title}" />
    <meta property="twitter:description" content="${ogData.description}" />
    <meta property="twitter:image" content="${ogData.image}" />
    
    <!-- WhatsApp -->
    <meta property="og:site_name" content="Salone Fast Market" />
    
    <title>${ogData.title}</title>
    
    <script>
        // Redirect to Flutter app
        setTimeout(function() {
            window.location.href = 'https://salonefastmarket.com/app';
        }, 1000);
    </script>
    
    <style>
        body {
            font-family: sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #2E7D32 0%, #4CAF50 100%);
            color: white;
        }
        .container { text-align: center; padding: 40px; }
        .logo { width: 100px; margin-bottom: 20px; }
        h1 { font-size: 24px; margin-bottom: 10px; }
    </style>
</head>
<body>
    <div class="container">
        <img src="https://www.salonefastmarket.com/assets/images/logo.png" alt="Logo" class="logo">
        <h1>${ogData.title}</h1>
        <p>Redirecting to app...</p>
    </div>
</body>
</html>`;
}

// ============================================================================
// PRODUCT ROUTE
// ============================================================================
router.get('/product/:slugWithId', async (req, res) => {
  try {
    const { slugWithId } = req.params;
    const parts = slugWithId.split('-');
    const productId = parts[parts.length - 1];
    
    console.log(`📦 Fetching product: ${productId}`);
    
    const product = await Product.findById(productId)
      .populate('sellerId', 'name businessInfo')
      .lean();
    
    if (!product) {
      return res.status(404).send(`
<!DOCTYPE html>
<html><head><title>Product Not Found</title></head>
<body>
    <h1>Product Not Found</h1>
    <p>This product may have been removed.</p>
    <a href="https://salonefastmarket.com/app">Browse Products</a>
</body></html>
      `);
    }
    
    const productImage = product.images && product.images.length > 0
      ? product.images[0].url
      : 'https://www.salonefastmarket.com/assets/images/logo.png';
    
    const price = product.offerPrice && product.offerPrice < product.price
      ? `Le ${product.offerPrice} (Was Le ${product.price})`
      : `Le ${product.price}`;
    
    const sellerName = product.sellerId?.businessInfo?.businessName 
      || product.sellerId?.name 
      || 'Salone Fast Market';
    
    const description = product.description
      ? `${price} - ${product.description.substring(0, 150)}...`
      : `${price} - Available on Salone Fast Market`;
    
    const ogData = {
      type: 'product',
      url: `https://salonefastmarket.com/product/${slugWithId}`,
      title: `${product.name} - ${sellerName}`,
      description: description,
      image: productImage,
    };
    
    res.send(generateHTMLWithOG(ogData));
    
  } catch (error) {
    console.error('❌ Error serving product page:', error);
    res.status(500).send('Error loading product');
  }
});

// ============================================================================
// STORE ROUTE
// ============================================================================
router.get('/store/:slugWithId', async (req, res) => {
  try {
    const { slugWithId } = req.params;
    const parts = slugWithId.split('-');
    const sellerId = parts[parts.length - 1];
    
    console.log(`🏪 Fetching store: ${sellerId}`);
    
    const seller = await User.findById(sellerId)
      .select('name email businessInfo createdAt')
      .lean();
    
    if (!seller) {
      return res.status(404).send(`
<!DOCTYPE html>
<html><head><title>Store Not Found</title></head>
<body>
    <h1>Store Not Found</h1>
    <p>This store may have been closed.</p>
    <a href="https://salonefastmarket.com/app">Browse Stores</a>
</body></html>
      `);
    }
    
    const businessName = seller.businessInfo?.businessName || seller.name || 'Store';
    const description = seller.businessInfo?.businessDescription 
      || 'Quality products, great service!';
    
    const productCount = await Product.countDocuments({ 
      sellerId: sellerId,
      isDeleted: { $ne: true } 
    });
    
    const ogData = {
      type: 'website',
      url: `https://salonefastmarket.com/store/${slugWithId}`,
      title: `${businessName} - Salone Fast Market`,
      description: `${description} - ${productCount} products available`,
      image: 'https://www.salonefastmarket.com/assets/images/logo.png',
    };
    
    res.send(generateHTMLWithOG(ogData));
    
  } catch (error) {
    console.error('❌ Error serving store page:', error);
    res.status(500).send('Error loading store');
  }
});

module.exports = router;