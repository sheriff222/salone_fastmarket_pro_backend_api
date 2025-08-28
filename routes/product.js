// routes/product.js
const express = require('express');
const router = express.Router();
const Product = require('../model/product');
const multer = require('multer');
const { uploadProduct } = require('../uploadFile');
const asyncHandler = require('express-async-handler');

// Create new product - Updated to handle both Flutter (images array) and existing (image1-5) formats
router.post('/', asyncHandler(async (req, res) => {
    try {
        // Use your existing uploadProduct configuration but also handle 'images' field
        const multerMiddleware = uploadProduct.fields([
            { name: 'image1', maxCount: 1 },
            { name: 'image2', maxCount: 1 },
            { name: 'image3', maxCount: 1 },
            { name: 'image4', maxCount: 1 },
            { name: 'image5', maxCount: 1 },
            { name: 'images', maxCount: 10 }  // Add support for Flutter's 'images' field
        ]);

        multerMiddleware(req, res, async function (err) {
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    err.message = 'File size is too large. Maximum filesize is 5MB per image.';
                }
                console.log(`Add product: ${err}`);
                return res.json({ success: false, message: err.message });
            } else if (err) {
                console.log(`Add product: ${err}`);
                return res.json({ success: false, message: err.message });
            }

            console.log('📥 Received product data:', req.body);
            console.log('📷 Received files:', req.files);

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

            // Check required fields - make sellerName and sellerId optional for now
            if (!name || !quantity || !price || !proCategoryId || !proSubCategoryId) {
                return res.status(400).json({ 
                    success: false, 
                    message: "Required fields are missing. Please provide: name, quantity, price, proCategoryId, proSubCategoryId" 
                });
            }

            const imageUrls = [];

            // Handle Flutter's 'images' array format
            if (req.files && req.files['images']) {
                req.files['images'].forEach((file, index) => {
                    const imageUrl = `http://localhost:3000/image/products/${file.filename}`;
                    imageUrls.push({ image: index + 1, url: imageUrl });
                });
            }

            // Handle existing image1-5 format (fallback)
            if (imageUrls.length === 0) {
                const fields = ['image1', 'image2', 'image3', 'image4', 'image5'];
                fields.forEach((field, index) => {
                    if (req.files[field] && req.files[field].length > 0) {
                        const file = req.files[field][0];
                        const imageUrl = `http://localhost:3000/image/products/${file.filename}`;
                        imageUrls.push({ image: index + 1, url: imageUrl });
                    }
                });
            }

            console.log('🖼️ Processed images:', imageUrls);

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
                sellerName: sellerName || 'Default Seller', // Provide default if missing
                sellerId: sellerId || '507f1f77bcf86cd799439011', // Provide default ObjectId if missing
                images: imageUrls
            });

            const savedProduct = await newProduct.save();
            console.log('🎉 Product saved successfully:', savedProduct._id);

            res.status(201).json({ 
                success: true, 
                message: "Product created successfully.", 
                data: {
                    id: savedProduct._id,
                    name: savedProduct.name
                }
            });
        });
    } catch (error) {
        console.error("Error creating product:", error);
        res.status(500).json({ success: false, message: error.message });
    }
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
        res.json({ success: true, message: "Products retrieved successfully.", data: products });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Get a product by ID
router.get('/:id', asyncHandler(async (req, res) => {
    try {
        const productID = req.params.id;
        const product = await Product.findById(productID)
            .populate('proCategoryId', '_id name')
            .populate('proSubCategoryId', '_id name')
            .populate('proBrandId', '_id name')
            .populate('proVariantTypeId', '_id type')
            .populate('proVariantId', '_id name')
            .populate('sellerId', '_id fullName');
        if (!product) {
            return res.status(404).json({ success: false, message: "Product not found." });
        }
        res.json({ success: true, message: "Product retrieved successfully.", data: product });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Update a product
router.put('/:id', asyncHandler(async (req, res) => {
    const productId = req.params.id;
    try {
        uploadProduct.fields([
            { name: 'image1', maxCount: 1 },
            { name: 'image2', maxCount: 1 },
            { name: 'image3', maxCount: 1 },
            { name: 'image4', maxCount: 1 },
            { name: 'image5', maxCount: 1 },
            { name: 'images', maxCount: 10 }  // Also support Flutter format for updates
        ])(req, res, async function (err) {
            if (err) {
                console.log(`Update product: ${err}`);
                return res.status(500).json({ success: false, message: err.message });
            }

            const { name, description, quantity, price, offerPrice, proCategoryId, proSubCategoryId, proBrandId, proVariantTypeId, proVariantId, sellerName, sellerId } = req.body;

            const productToUpdate = await Product.findById(productId);
            if (!productToUpdate) {
                return res.status(404).json({ success: false, message: "Product not found." });
            }

            productToUpdate.name = name || productToUpdate.name;
            productToUpdate.description = description || productToUpdate.description;
            productToUpdate.quantity = quantity ? parseInt(quantity) : productToUpdate.quantity;
            productToUpdate.price = price ? parseFloat(price) : productToUpdate.price;
            productToUpdate.offerPrice = offerPrice ? parseFloat(offerPrice) : productToUpdate.offerPrice;
            productToUpdate.proCategoryId = proCategoryId || productToUpdate.proCategoryId;
            productToUpdate.proSubCategoryId = proSubCategoryId || productToUpdate.proSubCategoryId;
            productToUpdate.proBrandId = proBrandId || productToUpdate.proBrandId;
            productToUpdate.proVariantTypeId = proVariantTypeId || productToUpdate.proVariantTypeId;
            productToUpdate.proVariantId = proVariantId || productToUpdate.proVariantId;
            productToUpdate.sellerName = sellerName || productToUpdate.sellerName;
            productToUpdate.sellerId = sellerId || productToUpdate.sellerId;

            // Handle Flutter's 'images' array format for updates
            if (req.files && req.files['images']) {
                req.files['images'].forEach((file, index) => {
                    const imageUrl = `http://localhost:3000/image/products/${file.filename}`;
                    let imageEntry = productToUpdate.images.find(img => img.image === (index + 1));
                    if (imageEntry) {
                        imageEntry.url = imageUrl;
                    } else {
                        productToUpdate.images.push({ image: index + 1, url: imageUrl });
                    }
                });
            }

            // Handle existing image1-5 format (fallback)
            const fields = ['image1', 'image2', 'image3', 'image4', 'image5'];
            fields.forEach((field, index) => {
                if (req.files[field] && req.files[field].length > 0) {
                    const file = req.files[field][0];
                    const imageUrl = `http://localhost:3000/image/products/${file.filename}`;
                    let imageEntry = productToUpdate.images.find(img => img.image === (index + 1));
                    if (imageEntry) {
                        imageEntry.url = imageUrl;
                    } else {
                        productToUpdate.images.push({ image: index + 1, url: imageUrl });
                    }
                }
            });

            await productToUpdate.save();
            res.json({ success: true, message: "Product updated successfully." });
        });
    } catch (error) {
        console.error("Error updating product:", error);
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Delete a product
router.delete('/:id', asyncHandler(async (req, res) => {
    const productID = req.params.id;
    try {
        const product = await Product.findByIdAndDelete(productID);
        if (!product) {
            return res.status(404).json({ success: false, message: "Product not found." });
        }
        res.json({ success: true, message: "Product deleted successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}));

module.exports = router;