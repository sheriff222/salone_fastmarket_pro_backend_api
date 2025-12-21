// Create a new file: routes/bulkUpload.js
const express = require('express');
const router = express.Router();
const Category = require('../model/category');
const SubCategory = require('../model/subCategory');
const Brand = require('../model/brand');
const VariantType = require('../model/variantType');
const Variant = require('../model/variant');
const asyncHandler = require('express-async-handler');

// Bulk upload categories
router.post('/categories', asyncHandler(async (req, res) => {
    try {
        const { categories } = req.body;
        
        if (!Array.isArray(categories)) {
            return res.status(400).json({ 
                success: false, 
                message: "Categories must be an array" 
            });
        }

        const results = [];
        const errors = [];

        for (let i = 0; i < categories.length; i++) {
            try {
                const { name, imageUrl } = categories[i];
                
                if (!name || !imageUrl) {
                    errors.push({
                        index: i,
                        error: "Name and imageUrl are required",
                        data: categories[i]
                    });
                    continue;
                }

                const newCategory = new Category({
                    name: name,
                    image: imageUrl
                });

                const savedCategory = await newCategory.save();
                results.push({
                    index: i,
                    success: true,
                    data: savedCategory
                });

                console.log(`✅ Created category: ${name}`);

            } catch (error) {
                errors.push({
                    index: i,
                    error: error.message,
                    data: categories[i]
                });
                console.log(`❌ Failed to create category at index ${i}: ${error.message}`);
            }
        }

        res.json({
            success: true,
            message: `Bulk upload completed. ${results.length} categories created, ${errors.length} errors.`,
            data: {
                successful: results,
                errors: errors,
                summary: {
                    total: categories.length,
                    successful: results.length,
                    failed: errors.length
                }
            }
        });

    } catch (error) {
        console.error('Bulk category upload error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
}));

// Bulk upload subcategories
router.post('/subcategories', asyncHandler(async (req, res) => {
    try {
        const { subcategories } = req.body;
        
        if (!Array.isArray(subcategories)) {
            return res.status(400).json({ 
                success: false, 
                message: "Subcategories must be an array" 
            });
        }

        const results = [];
        const errors = [];

        for (let i = 0; i < subcategories.length; i++) {
            try {
                const { name, categoryId } = subcategories[i];
                
                if (!name || !categoryId) {
                    errors.push({
                        index: i,
                        error: "Name and categoryId are required",
                        data: subcategories[i]
                    });
                    continue;
                }

                const newSubCategory = new SubCategory({
                    name: name,
                    categoryId: categoryId
                });

                const savedSubCategory = await newSubCategory.save();
                results.push({
                    index: i,
                    success: true,
                    data: savedSubCategory
                });

                console.log(`✅ Created subcategory: ${name}`);

            } catch (error) {
                errors.push({
                    index: i,
                    error: error.message,
                    data: subcategories[i]
                });
                console.log(`❌ Failed to create subcategory at index ${i}: ${error.message}`);
            }
        }

        res.json({
            success: true,
            message: `Bulk upload completed. ${results.length} subcategories created, ${errors.length} errors.`,
            data: {
                successful: results,
                errors: errors,
                summary: {
                    total: subcategories.length,
                    successful: results.length,
                    failed: errors.length
                }
            }
        });

    } catch (error) {
        console.error('Bulk subcategory upload error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
}));

// Bulk upload brands
router.post('/brands', asyncHandler(async (req, res) => {
    try {
        const { brands } = req.body;
        
        if (!Array.isArray(brands)) {
            return res.status(400).json({ 
                success: false, 
                message: "Brands must be an array" 
            });
        }

        const results = [];
        const errors = [];

        for (let i = 0; i < brands.length; i++) {
            try {
                const { name, subcategoryId } = brands[i];
                
                if (!name || !subcategoryId) {
                    errors.push({
                        index: i,
                        error: "Name and subcategoryId are required",
                        data: brands[i]
                    });
                    continue;
                }

                const newBrand = new Brand({
                    name: name,
                    subcategoryId: subcategoryId
                });

                const savedBrand = await newBrand.save();
                results.push({
                    index: i,
                    success: true,
                    data: savedBrand
                });

                console.log(`✅ Created brand: ${name}`);

            } catch (error) {
                errors.push({
                    index: i,
                    error: error.message,
                    data: brands[i]
                });
                console.log(`❌ Failed to create brand at index ${i}: ${error.message}`);
            }
        }

        res.json({
            success: true,
            message: `Bulk upload completed. ${results.length} brands created, ${errors.length} errors.`,
            data: {
                successful: results,
                errors: errors,
                summary: {
                    total: brands.length,
                    successful: results.length,
                    failed: errors.length
                }
            }
        });

    } catch (error) {
        console.error('Bulk brand upload error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
}));

// Bulk upload variant types
router.post('/varianttypes', asyncHandler(async (req, res) => {
    try {
        const { variantTypes } = req.body;
        
        if (!Array.isArray(variantTypes)) {
            return res.status(400).json({ 
                success: false, 
                message: "VariantTypes must be an array" 
            });
        }

        const results = [];
        const errors = [];

        for (let i = 0; i < variantTypes.length; i++) {
            try {
                const { name, type } = variantTypes[i];
                
                if (!name || !type) {
                    errors.push({
                        index: i,
                        error: "Name and type are required",
                        data: variantTypes[i]
                    });
                    continue;
                }

                const newVariantType = new VariantType({
                    name: name,
                    type: type
                });

                const savedVariantType = await newVariantType.save();
                results.push({
                    index: i,
                    success: true,
                    data: savedVariantType
                });

                console.log(`✅ Created variant type: ${name} (${type})`);

            } catch (error) {
                errors.push({
                    index: i,
                    error: error.message,
                    data: variantTypes[i]
                });
                console.log(`❌ Failed to create variant type at index ${i}: ${error.message}`);
            }
        }

        res.json({
            success: true,
            message: `Bulk upload completed. ${results.length} variant types created, ${errors.length} errors.`,
            data: {
                successful: results,
                errors: errors,
                summary: {
                    total: variantTypes.length,
                    successful: results.length,
                    failed: errors.length
                }
            }
        });

    } catch (error) {
        console.error('Bulk variant type upload error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
}));

// Bulk upload variants
router.post('/variants', asyncHandler(async (req, res) => {
    try {
        const { variants } = req.body;
        
        if (!Array.isArray(variants)) {
            return res.status(400).json({ 
                success: false, 
                message: "Variants must be an array" 
            });
        }

        const results = [];
        const errors = [];

        for (let i = 0; i < variants.length; i++) {
            try {
                const { name, variantTypeId } = variants[i];
                
                if (!name || !variantTypeId) {
                    errors.push({
                        index: i,
                        error: "Name and variantTypeId are required",
                        data: variants[i]
                    });
                    continue;
                }

                const newVariant = new Variant({
                    name: name,
                    variantTypeId: variantTypeId
                });

                const savedVariant = await newVariant.save();
                results.push({
                    index: i,
                    success: true,
                    data: savedVariant
                });

                console.log(`✅ Created variant: ${name}`);

            } catch (error) {
                errors.push({
                    index: i,
                    error: error.message,
                    data: variants[i]
                });
                console.log(`❌ Failed to create variant at index ${i}: ${error.message}`);
            }
        }

        res.json({
            success: true,
            message: `Bulk upload completed. ${results.length} variants created, ${errors.length} errors.`,
            data: {
                successful: results,
                errors: errors,
                summary: {
                    total: variants.length,
                    successful: results.length,
                    failed: errors.length
                }
            }
        });

    } catch (error) {
        console.error('Bulk variant upload error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
}));

// Complete bulk upload - all data in one request
router.post('/complete', asyncHandler(async (req, res) => {
    try {
        const { categories, subcategories, brands, variantTypes, variants } = req.body;
        const results = {
            categories: [],
            subcategories: [],
            brands: [],
            variantTypes: [],
            variants: [],
            errors: []
        };

        // Step 1: Create Categories
        if (categories && Array.isArray(categories)) {
            console.log('🚀 Creating categories...');
            for (let i = 0; i < categories.length; i++) {
                try {
                    const { name, imageUrl } = categories[i];
                    const newCategory = new Category({ name, image: imageUrl });
                    const savedCategory = await newCategory.save();
                    results.categories.push(savedCategory);
                    console.log(`✅ Created category: ${name}`);
                } catch (error) {
                    results.errors.push({
                        type: 'category',
                        index: i,
                        error: error.message,
                        data: categories[i]
                    });
                }
            }
        }

        // Step 2: Create SubCategories
        if (subcategories && Array.isArray(subcategories)) {
            console.log('🚀 Creating subcategories...');
            for (let i = 0; i < subcategories.length; i++) {
                try {
                    const { name, categoryName } = subcategories[i];
                    // Find category by name
                    const category = results.categories.find(cat => cat.name === categoryName);
                    if (!category) {
                        results.errors.push({
                            type: 'subcategory',
                            index: i,
                            error: `Category '${categoryName}' not found`,
                            data: subcategories[i]
                        });
                        continue;
                    }
                    
                    const newSubCategory = new SubCategory({ 
                        name, 
                        categoryId: category._id 
                    });
                    const savedSubCategory = await newSubCategory.save();
                    results.subcategories.push(savedSubCategory);
                    console.log(`✅ Created subcategory: ${name}`);
                } catch (error) {
                    results.errors.push({
                        type: 'subcategory',
                        index: i,
                        error: error.message,
                        data: subcategories[i]
                    });
                }
            }
        }

        // Step 3: Create Brands
        if (brands && Array.isArray(brands)) {
            console.log('🚀 Creating brands...');
            for (let i = 0; i < brands.length; i++) {
                try {
                    const { name, subcategoryName } = brands[i];
                    // Find subcategory by name
                    const subcategory = results.subcategories.find(sub => sub.name === subcategoryName);
                    if (!subcategory) {
                        results.errors.push({
                            type: 'brand',
                            index: i,
                            error: `Subcategory '${subcategoryName}' not found`,
                            data: brands[i]
                        });
                        continue;
                    }
                    
                    const newBrand = new Brand({ 
                        name, 
                        subcategoryId: subcategory._id 
                    });
                    const savedBrand = await newBrand.save();
                    results.brands.push(savedBrand);
                    console.log(`✅ Created brand: ${name}`);
                } catch (error) {
                    results.errors.push({
                        type: 'brand',
                        index: i,
                        error: error.message,
                        data: brands[i]
                    });
                }
            }
        }

        // Step 4: Create Variant Types
        if (variantTypes && Array.isArray(variantTypes)) {
            console.log('🚀 Creating variant types...');
            for (let i = 0; i < variantTypes.length; i++) {
                try {
                    const { name, type } = variantTypes[i];
                    const newVariantType = new VariantType({ name, type });
                    const savedVariantType = await newVariantType.save();
                    results.variantTypes.push(savedVariantType);
                    console.log(`✅ Created variant type: ${name} (${type})`);
                } catch (error) {
                    results.errors.push({
                        type: 'variantType',
                        index: i,
                        error: error.message,
                        data: variantTypes[i]
                    });
                }
            }
        }

        // Step 5: Create Variants
        if (variants && Array.isArray(variants)) {
            console.log('🚀 Creating variants...');
            for (let i = 0; i < variants.length; i++) {
                try {
                    const { name, variantTypeName } = variants[i];
                    // Find variant type by name
                    const variantType = results.variantTypes.find(vt => vt.name === variantTypeName);
                    if (!variantType) {
                        results.errors.push({
                            type: 'variant',
                            index: i,
                            error: `Variant type '${variantTypeName}' not found`,
                            data: variants[i]
                        });
                        continue;
                    }
                    
                    const newVariant = new Variant({ 
                        name, 
                        variantTypeId: variantType._id 
                    });
                    const savedVariant = await newVariant.save();
                    results.variants.push(savedVariant);
                    console.log(`✅ Created variant: ${name}`);
                } catch (error) {
                    results.errors.push({
                        type: 'variant',
                        index: i,
                        error: error.message,
                        data: variants[i]
                    });
                }
            }
        }

        const summary = {
            categories: results.categories.length,
            subcategories: results.subcategories.length,
            brands: results.brands.length,
            variantTypes: results.variantTypes.length,
            variants: results.variants.length,
            errors: results.errors.length
        };

        res.json({
            success: true,
            message: `Complete bulk upload finished. Total created: ${Object.values(summary).reduce((a, b) => a + b, 0) - summary.errors}`,
            data: results,
            summary: summary
        });

    } catch (error) {
        console.error('Complete bulk upload error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
}));

module.exports = router;