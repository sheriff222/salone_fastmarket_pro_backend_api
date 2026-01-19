const express = require('express');
const router = express.Router();
const Product = require('../model/product');
const User = require('../model/user');

function generateHTMLWithOG(ogData) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    
    <!-- Open Graph Meta Tags -->
    <meta property="og:type" content="${ogData.type || 'website'}" />
    <meta property="og:url" content="${ogData.url}" />
    <meta property="og:title" content="${ogData.title}" />
    <meta property="og:description" content="${ogData.description}" />
    <meta property="og:image" content="${ogData.image}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:site_name" content="Salone Fast Market" />
    
    <!-- Twitter Card Meta Tags -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${ogData.title}" />
    <meta name="twitter:description" content="${ogData.description}" />
    <meta name="twitter:image" content="${ogData.image}" />
    
    <!-- WhatsApp Specific (ensures image shows) -->
    <meta property="og:image:secure_url" content="${ogData.image}" />
    <meta property="og:image:type" content="image/jpeg" />
    
    <title>${ogData.title}</title>
    
    <!-- Redirect to Flutter app after OG tags are read -->
    <script>
      setTimeout(function() { 
        window.location.href = '${ogData.appUrl}'; 
      }, 500);
    </script>
</head>
<body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;background:linear-gradient(135deg, #2E7D32 0%, #4CAF50 100%);color:white;">
    <div style="text-align:center;padding:40px;">
        <img src="https://www.salonefastmarket.com/assets/images/logo.png" width="100" alt="Logo">
        <h1 style="margin-top:20px;">${ogData.title}</h1>
        <p style="opacity:0.9;">Redirecting to app...</p>
    </div>
</body>
</html>`;
}

// ✅ PRODUCT ROUTE - Fixed
router.get('/product/:slugWithId', async (req, res) => {
  try {
    const productId = req.params.slugWithId; // Just use the ID directly
    
    console.log(`📦 Fetching product: ${productId}`);
    
    const product = await Product.findById(productId)
      .populate('proCategoryId', 'name')
      .populate('proSubCategoryId', 'name')
      .populate('sellerId', 'fullName businessInfo')
      .lean();
    
    if (!product) {
      return res.status(404).send('<html><body><h1>Product Not Found</h1></body></html>');
    }
    
    // ✅ Get product image - handles your schema
    const productImage = product.images?.[0]?.url 
      || product.url 
      || product.image 
      || 'https://www.salonefastmarket.com/assets/images/logo.png';
    
    const price = product.offerPrice && product.offerPrice < product.price
      ? `Le ${product.offerPrice} (Was Le ${product.price})`
      : `Le ${product.price}`;
    
    const sellerName = product.sellerId?.businessInfo?.businessName 
      || product.sellerId?.fullName 
      || product.sellerName 
      || 'Salone Fast Market';
    
    const ogData = {
      type: 'product',
      url: `https://salonefastmarket.com/product/${req.params.slugWithId}`,
      appUrl: `https://salonefastmarket.com/app/product/${productId}`,
      title: `${product.name} - ${sellerName}`,
      description: `${price} - ${product.description?.substring(0, 150) || 'Available on Salone Fast Market'}`,
      image: productImage,
    };
    
    console.log('✅ Product OG Image:', productImage);
    res.send(generateHTMLWithOG(ogData));
    
  } catch (error) {
    console.error('❌ Error serving product page:', error);
    res.status(500).send('<html><body><h1>Error</h1></body></html>');
  }
});

// ✅ STORE ROUTE - Fixed
router.get('/store/:slugWithId', async (req, res) => {
  try {
    const sellerId = req.params.slugWithId; // Just use the ID directly
    
    console.log(`🏪 Fetching store: ${sellerId}`);
    
    const seller = await User.findById(sellerId).select('fullName businessInfo').lean();
    
    if (!seller) {
      return res.status(404).send('<html><body><h1>Store Not Found</h1></body></html>');
    }
    
    const businessName = seller.businessInfo?.businessName || seller.fullName || 'Store';
    const description = seller.businessInfo?.businessDescription || 'Quality products, great service!';
    
    // ✅ Get store logo/image
    const storeImage = seller.businessInfo?.logo 
      || seller.profileImage 
      || 'https://www.salonefastmarket.com/assets/images/logo.png';
    
    const productCount = await Product.countDocuments({ sellerId: sellerId });
    
    const ogData = {
      type: 'website',
      url: `https://salonefastmarket.com/store/${req.params.slugWithId}`,
      appUrl: `https://salonefastmarket.com/app/store/${sellerId}`,
      title: `${businessName} - Salone Fast Market`,
      description: `${description} - ${productCount} products available`,
      image: storeImage,
    };
    
    console.log('✅ Store OG Image:', storeImage);
    res.send(generateHTMLWithOG(ogData));
    
  } catch (error) {
    console.error('❌ Error serving store page:', error);
    res.status(500).send('<html><body><h1>Error</h1></body></html>');
  }
});

module.exports = router;