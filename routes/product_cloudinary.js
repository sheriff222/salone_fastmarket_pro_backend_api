// routes/product_cloudinary.js - Updated product routes with Cloudinary
const express = require('express');
const router = express.Router();
const Product = require('../model/product');
const asyncHandler = require('express-async-handler');
const { uploadProductImages, handleMulterError } = require('../middleware/uploadMiddleware.js');
const { 
    uploadProductImage, 
    deleteFromCloudinary, 
    extractPublicId 
} = require('../utils/cloudinaryUpload');

// Create new product with Cloudinary upload
router.post('/', asyncHandler(async (req, res) => {
    // Handle both 'images' array and 'image1-5' fields
    const upload = uploadProductImages.fields([
        { name: 'image1', maxCount: 1 },
        { name: 'image2', maxCount: 1 },
        { name: 'image3', maxCount: 1 },
        { name: 'image4', maxCount: 1 },
        { name: 'image5', maxCount: 1 },
        { name: 'images', maxCount: 10 }
    ]);

    upload(req, res, async function (err) {
        if (err) {
            return handleMulterError(err, req, res, () => {});
        }

        try {
            console.log('📥 Received product data:', req.body);
            console.log('📷 Received files:', req.files ? Object.keys(req.files) : 'none');

            const { 
                name, 
                description, 
                quantity, 
                price, 
                offerPrice, 
                proCategoryId, 
                proSubCategoryId, 
                proBrandId, 
                proVariantTypeId, 
                proVariantId, 
                sellerName, 
                sellerId 
            } = req.body;

            // Validate required fields
            if (!name || !quantity || !price || !proCategoryId || !proSubCategoryId) {
                return res.status(400).json({ 
                    success: false, 
                    message: "Required fields: name, quantity, price, proCategoryId, proSubCategoryId" 
                });
            }

            const imageUrls = [];

            // Upload images to Cloudinary
            if (req.files) {
                // Handle 'images' array format (Flutter)
                if (req.files['images']) {
                    console.log(`📤 Uploading ${req.files['images'].length} images to Cloudinary...`);
                    
                    for (let i = 0; i < req.files['images'].length; i++) {
                        const file = req.files['images'][i];
                        try {
                            const uploadResult = await uploadProductImage(
                                file.buffer, 
                                file.originalname
                            );
                            
                            imageUrls.push({ 
                                image: i + 1, 
                                url: uploadResult.url,
                                publicId: uploadResult.publicId
                            });
                            console.log(`✅ Uploaded image ${i + 1}: ${uploadResult.url}`);
                        } catch (uploadError) {
                            console.error(`❌ Failed to upload image ${i + 1}:`, uploadError);
                            // Continue with other images
                        }
                    }
                }

                // Handle individual image fields (image1-5)
                if (imageUrls.length === 0) {
                    const fields = ['image1', 'image2', 'image3', 'image4', 'image5'];
                    
                    for (let i = 0; i < fields.length; i++) {
                        const field = fields[i];
                        if (req.files[field] && req.files[field][0]) {
                            const file = req.files[field][0];
                            try {
                                const uploadResult = await uploadProductImage(
                                    file.buffer, 
                                    file.originalname
                                );
                                
                                imageUrls.push({ 
                                    image: i + 1, 
                                    url: uploadResult.url,
                                    publicId: uploadResult.publicId
                                });
                                console.log(`✅ Uploaded ${field}: ${uploadResult.url}`);
                            } catch (uploadError) {
                                console.error(`❌ Failed to upload ${field}:`, uploadError);
                            }
                        }
                    }
                }
            }

            console.log(`🖼️ Total images uploaded: ${imageUrls.length}`);

            // Create product with Cloudinary URLs
            const newProduct = new Product({
                name: name.trim(),
                description: description ? description.trim() : '',
                quantity: parseInt(quantity),
                price: parseFloat(price),
                offerPrice: offerPrice ? parseFloat(offerPrice) : undefined,
                proCategoryId,
                proSubCategoryId,
                proBrandId: proBrandId || undefined,
                proVariantTypeId: proVariantTypeId || undefined,
                proVariantId: proVariantId || undefined,
                sellerName: sellerName || 'Default Seller',
                sellerId: sellerId || '507f1f77bcf86cd799439011',
                images: imageUrls
            });

            const savedProduct = await newProduct.save();
            console.log('🎉 Product saved successfully:', savedProduct._id);

            res.status(201).json({ 
                success: true, 
                message: "Product created successfully with Cloudinary images.", 
                data: {
                    id: savedProduct._id,
                    name: savedProduct.name,
                    images: savedProduct.images
                }
            });

        } catch (error) {
            console.error("❌ Error creating product:", error);
            res.status(500).json({ 
                success: false, 
                message: error.message 
            });
        }
    });
}));

// Get all products
router.get('/', asyncHandler(async (req, res) => {
    try {
        const products = await Product.find()
            .populate('proCategoryId', '_id name')
            .populate('proSubCategoryId', '_id name')
            .populate('proBrandId', '_id name')
            .populate('proVariantTypeId', '_id type')
            .populate('proVariantId', '_id name')
            .populate('sellerId', '_id fullName');
        
        res.json({ 
            success: true, 
            message: "Products retrieved successfully.", 
            data: products 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Get product by ID
router.get('/:id', asyncHandler(async (req, res) => {
    try {
        const product = await Product.findById(req.params.id)
            .populate('proCategoryId', '_id name')
            .populate('proSubCategoryId', '_id name')
            .populate('proBrandId', '_id name')
            .populate('proVariantTypeId', '_id type')
            .populate('proVariantId', '_id name')
            .populate('sellerId', '_id fullName');
        
        if (!product) {
            return res.status(404).json({ 
                success: false, 
                message: "Product not found." 
            });
        }
        
        res.json({ 
            success: true, 
            message: "Product retrieved successfully.", 
            data: product 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Update product with Cloudinary
router.put('/:id', asyncHandler(async (req, res) => {
    const upload = uploadProductImages.fields([
        { name: 'image1', maxCount: 1 },
        { name: 'image2', maxCount: 1 },
        { name: 'image3', maxCount: 1 },
        { name: 'image4', maxCount: 1 },
        { name: 'image5', maxCount: 1 },
        { name: 'images', maxCount: 10 }
    ]);

    upload(req, res, async function (err) {
        if (err) {
            return handleMulterError(err, req, res, () => {});
        }

        try {
            const productId = req.params.id;
            const product = await Product.findById(productId);
            
            if (!product) {
                return res.status(404).json({ 
                    success: false, 
                    message: "Product not found." 
                });
            }

            // Update basic fields
            const { 
                name, 
                description, 
                quantity, 
                price, 
                offerPrice, 
                proCategoryId, 
                proSubCategoryId, 
                proBrandId, 
                proVariantTypeId, 
                proVariantId, 
                sellerName, 
                sellerId,
                replaceImages  // Optional flag to replace all images
            } = req.body;

            if (name) product.name = name;
            if (description !== undefined) product.description = description;
            if (quantity !== undefined) product.quantity = parseInt(quantity);
            if (price !== undefined) product.price = parseFloat(price);
            if (offerPrice !== undefined) product.offerPrice = parseFloat(offerPrice);
            if (proCategoryId) product.proCategoryId = proCategoryId;
            if (proSubCategoryId) product.proSubCategoryId = proSubCategoryId;
            if (proBrandId) product.proBrandId = proBrandId;
            if (proVariantTypeId) product.proVariantTypeId = proVariantTypeId;
            if (proVariantId) product.proVariantId = proVariantId;
            if (sellerName) product.sellerName = sellerName;
            if (sellerId) product.sellerId = sellerId;

            // Handle image updates
            if (req.files && Object.keys(req.files).length > 0) {
                const shouldReplaceAll = replaceImages === 'true' || replaceImages === true;
                
                // If replacing all images, delete old ones from Cloudinary
                if (shouldReplaceAll && product.images && product.images.length > 0) {
                    console.log('🗑️ Deleting old images from Cloudinary...');
                    for (const img of product.images) {
                        if (img.publicId || img.url) {
                            const publicId = img.publicId || extractPublicId(img.url);
                            if (publicId) {
                                try {
                                    await deleteFromCloudinary(publicId);
                                    console.log(`✅ Deleted: ${publicId}`);
                                } catch (delError) {
                                    console.error(`⚠️ Could not delete ${publicId}:`, delError.message);
                                }
                            }
                        }
                    }
                    product.images = []; // Clear images array
                }

                // Upload new images
                if (req.files['images']) {
                    for (let i = 0; i < req.files['images'].length; i++) {
                        const file = req.files['images'][i];
                        try {
                            const uploadResult = await uploadProductImage(
                                file.buffer, 
                                file.originalname
                            );
                            
                            product.images.push({ 
                                image: product.images.length + 1, 
                                url: uploadResult.url,
                                publicId: uploadResult.publicId
                            });
                        } catch (uploadError) {
                            console.error(`Failed to upload image ${i + 1}:`, uploadError);
                        }
                    }
                }

                // Handle individual image fields
                const fields = ['image1', 'image2', 'image3', 'image4', 'image5'];
                for (let i = 0; i < fields.length; i++) {
                    const field = fields[i];
                    if (req.files[field] && req.files[field][0]) {
                        const file = req.files[field][0];
                        try {
                            const uploadResult = await uploadProductImage(
                                file.buffer, 
                                file.originalname
                            );
                            
                            // Find existing image at this position or add new
                            let imageEntry = product.images.find(img => img.image === (i + 1));
                            if (imageEntry) {
                                // Delete old image from Cloudinary
                                const oldPublicId = imageEntry.publicId || extractPublicId(imageEntry.url);
                                if (oldPublicId) {
                                    try {
                                        await deleteFromCloudinary(oldPublicId);
                                    } catch (delError) {
                                        console.error(`Could not delete old image:`, delError.message);
                                    }
                                }
                                imageEntry.url = uploadResult.url;
                                imageEntry.publicId = uploadResult.publicId;
                            } else {
                                product.images.push({ 
                                    image: i + 1, 
                                    url: uploadResult.url,
                                    publicId: uploadResult.publicId
                                });
                            }
                        } catch (uploadError) {
                            console.error(`Failed to upload ${field}:`, uploadError);
                        }
                    }
                }
            }

            await product.save();
            
            res.json({ 
                success: true, 
                message: "Product updated successfully with Cloudinary images." 
            });

        } catch (error) {
            console.error("Error updating product:", error);
            res.status(500).json({ 
                success: false, 
                message: error.message 
            });
        }
    });
}));

// Delete product (also deletes images from Cloudinary)
router.delete('/:id', asyncHandler(async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        
        if (!product) {
            return res.status(404).json({ 
                success: false, 
                message: "Product not found." 
            });
        }

        // Delete all images from Cloudinary
        if (product.images && product.images.length > 0) {
            console.log(`Deleting ${product.images.length} images from Cloudinary...`);
            
            for (const img of product.images) {
                if (img.publicId || img.url) {
                    const publicId = img.publicId || extractPublicId(img.url);
                    if (publicId) {
                        try {
                            await deleteFromCloudinary(publicId);
                            console.log(`Deleted image: ${publicId}`);
                        } catch (delError) {
                            console.error(`Could not delete image ${publicId}:`, delError.message);
                        }
                    }
                }
            }
        }

        // Delete product from database
        await Product.findByIdAndDelete(req.params.id);
        
        res.json({ 
            success: true, 
            message: "Product and images deleted successfully." 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
}));

module.exports = router;