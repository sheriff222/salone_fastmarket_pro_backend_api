// routes/category_cloudinary.js - Updated category routes with Cloudinary
const express = require('express');
const router = express.Router();
const Category = require('../model/category');
const SubCategory = require('../model/subCategory');
const Product = require('../model/product');
const asyncHandler = require('express-async-handler');
const { uploadCategoryImage, handleMulterError } = require('../middleware/uploadMiddleware.js');
const { 
    uploadCategoryImage: uploadToCloudinary, 
    deleteFromCloudinary, 
    extractPublicId 
} = require('../utils/cloudinaryUpload');

// Get all categories
router.get('/', asyncHandler(async (req, res) => {
    try {
        const categories = await Category.find();
        res.json({ 
            success: true, 
            message: "Categories retrieved successfully.", 
            data: categories 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Get category by ID
router.get('/:id', asyncHandler(async (req, res) => {
    try {
        const category = await Category.findById(req.params.id);
        if (!category) {
            return res.status(404).json({ 
                success: false, 
                message: "Category not found." 
            });
        }
        res.json({ 
            success: true, 
            message: "Category retrieved successfully.", 
            data: category 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Create category with Cloudinary upload
router.post('/', asyncHandler(async (req, res) => {
    // Support both URL-based (bulk) and file upload creation
    if (req.body.imageUrl && req.body.name) {
        // Bulk creation with URL
        const { name, imageUrl } = req.body;
        
        if (!name) {
            return res.status(400).json({ 
                success: false, 
                message: "Name is required." 
            });
        }

        try {
            const newCategory = new Category({
                name: name,
                image: imageUrl
            });
            await newCategory.save();
            
            return res.json({ 
                success: true, 
                message: "Category created successfully.", 
                data: newCategory 
            });
        } catch (error) {
            console.error("Error creating category:", error);
            return res.status(500).json({ 
                success: false, 
                message: error.message 
            });
        }
    }

    // File upload creation
    uploadCategoryImage.single('img')(req, res, async function (err) {
        if (err) {
            return handleMulterError(err, req, res, () => {});
        }

        const { name } = req.body;
        
        if (!name) {
            return res.status(400).json({ 
                success: false, 
                message: "Name is required." 
            });
        }

        if (!req.file) {
            return res.status(400).json({ 
                success: false, 
                message: "Image file is required." 
            });
        }

        try {
            console.log('📤 Uploading category image to Cloudinary...');
            
            // Upload to Cloudinary
            const uploadResult = await uploadToCloudinary(
                req.file.buffer, 
                req.file.originalname
            );

            console.log('✅ Category image uploaded:', uploadResult.url);

            // Create category with Cloudinary URL
            const newCategory = new Category({
                name: name,
                image: uploadResult.url,
                publicId: uploadResult.publicId
            });
            
            await newCategory.save();
            
            res.json({ 
                success: true, 
                message: "Category created successfully with Cloudinary image.", 
                data: newCategory 
            });

        } catch (error) {
            console.error("Error creating category:", error);
            res.status(500).json({ 
                success: false, 
                message: error.message 
            });
        }
    });
}));

// Update category with Cloudinary
router.put('/:id', asyncHandler(async (req, res) => {
    const categoryID = req.params.id;

    // Support URL-based updates (bulk)
    if (req.body.imageUrl && req.body.name) {
        const { name, imageUrl } = req.body;

        if (!name || !imageUrl) {
            return res.status(400).json({ 
                success: false, 
                message: "Name and image are required." 
            });
        }

        try {
            const updatedCategory = await Category.findByIdAndUpdate(
                categoryID, 
                { name: name, image: imageUrl }, 
                { new: true }
            );
            
            if (!updatedCategory) {
                return res.status(404).json({ 
                    success: false, 
                    message: "Category not found." 
                });
            }
            
            return res.json({ 
                success: true, 
                message: "Category updated successfully.", 
                data: updatedCategory 
            });
        } catch (error) {
            return res.status(500).json({ 
                success: false, 
                message: error.message 
            });
        }
    }

    // File upload update
    uploadCategoryImage.single('img')(req, res, async function (err) {
        if (err) {
            return handleMulterError(err, req, res, () => {});
        }

        const { name } = req.body;
        let image = req.body.image; // Existing image URL if no new file

        try {
            const category = await Category.findById(categoryID);
            
            if (!category) {
                return res.status(404).json({ 
                    success: false, 
                    message: "Category not found." 
                });
            }

            // If new file is uploaded
            if (req.file) {
                console.log('📤 Uploading new category image to Cloudinary...');
                
                // Delete old image from Cloudinary if it exists
                if (category.publicId || category.image) {
                    const oldPublicId = category.publicId || extractPublicId(category.image);
                    if (oldPublicId) {
                        try {
                            await deleteFromCloudinary(oldPublicId);
                            console.log('🗑️ Old category image deleted from Cloudinary');
                        } catch (delError) {
                            console.error('⚠️ Could not delete old image:', delError.message);
                        }
                    }
                }

                // Upload new image
                const uploadResult = await uploadToCloudinary(
                    req.file.buffer, 
                    req.file.originalname
                );
                
                image = uploadResult.url;
                category.publicId = uploadResult.publicId;
                console.log('✅ New category image uploaded:', image);
            }

            if (!name || !image) {
                return res.status(400).json({ 
                    success: false, 
                    message: "Name and image are required." 
                });
            }

            category.name = name;
            category.image = image;
            await category.save();

            res.json({ 
                success: true, 
                message: "Category updated successfully.", 
                data: category 
            });

        } catch (error) {
            console.error("Error updating category:", error);
            res.status(500).json({ 
                success: false, 
                message: error.message 
            });
        }
    });
}));

// Delete category (also deletes image from Cloudinary)
router.delete('/:id', asyncHandler(async (req, res) => {
    try {
        const categoryID = req.params.id;

        // Check if any subcategories reference this category
        const subcategories = await SubCategory.find({ categoryId: categoryID });
        if (subcategories.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: "Cannot delete category. Subcategories are referencing it." 
            });
        }

        // Check if any products reference this category
        const products = await Product.find({ proCategoryId: categoryID });
        if (products.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: "Cannot delete category. Products are referencing it." 
            });
        }

        const category = await Category.findById(categoryID);
        if (!category) {
            return res.status(404).json({ 
                success: false, 
                message: "Category not found." 
            });
        }

        // Delete image from Cloudinary
        if (category.publicId || category.image) {
            const publicId = category.publicId || extractPublicId(category.image);
            if (publicId) {
                try {
                    await deleteFromCloudinary(publicId);
                    console.log('🗑️ Category image deleted from Cloudinary');
                } catch (delError) {
                    console.error('⚠️ Could not delete image:', delError.message);
                }
            }
        }

        // Delete category from database
        await Category.findByIdAndDelete(categoryID);
        
        res.json({ 
            success: true, 
            message: "Category and image deleted successfully." 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
}));

module.exports = router;