const mongoose = require('mongoose');
const fs = require('fs').promises;
const path = require('path');
const Product = require('../model/product');
const Category = require('../model/category');
const { Poster } = require('../model/poster');
const { Message } = require('../model/message'); // Corrected import
const { 
    uploadProductImage, 
    uploadCategoryImage, 
    uploadPosterImage, 
    uploadMessageImage, 
    uploadMessageVideo, 
    uploadMessageVoice, 
    uploadMessageDocument 
} = require('../utils/cloudinaryUpload');

// Base path for public folder
const PUBLIC_PATH = path.join(__dirname, '..', 'public');

// Set higher timeout for mongoose operations
mongoose.set('bufferTimeoutMS', 30000); // 30 seconds

// Migration for Products
async function migrateProducts() {
    const products = await Product.find({});
    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const product of products) {
        if (!product.images || product.images.length === 0) {
            skippedCount++;
            continue;
        }

        const newImages = [];
        for (const img of product.images) {
            if (img.url && img.url.includes('cloudinary.com')) {
                newImages.push(img);
                skippedCount++;
                continue;
            }

            try {
                const filename = img.url ? img.url.split('/').pop() : null;
                if (!filename) {
                    newImages.push(img);
                    skippedCount++;
                    continue;
                }

                const localPath = path.join(PUBLIC_PATH, 'products', filename);
                if (await fs.access(localPath).then(() => true).catch(() => false)) {
                    const fileBuffer = await fs.readFile(localPath);
                    const uploadResult = await uploadProductImage(fileBuffer, filename);

                    newImages.push({
                        image: img.image,
                        url: uploadResult.url,
                        publicId: uploadResult.publicId
                    });

                    console.log(`✅ Product image migrated: ${filename}`);
                    migratedCount++;
                } else {
                    console.log(`⚠️ Product file not found: ${localPath}`);
                    newImages.push(img);
                    skippedCount++;
                }
            } catch (error) {
                console.error(`❌ Failed to migrate product image ${img.url || 'unknown'}:`, error.message);
                newImages.push(img);
                errorCount++;
            }
        }

        product.images = newImages;
        await product.save();
    }

    console.log(`✅ Product migration complete: ${migratedCount} migrated, ${skippedCount} skipped, ${errorCount} errors`);
    return { migrated: migratedCount, skipped: skippedCount, errors: errorCount };
}

// Migration for Categories
async function migrateCategories() {
    const categories = await Category.find({});
    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const category of categories) {
        if (!category.image || category.image.includes('cloudinary.com')) {
            skippedCount++;
            continue;
        }

        try {
            const filename = category.image.split('/').pop();
            const localPath = path.join(PUBLIC_PATH, 'category', filename);

            if (await fs.access(localPath).then(() => true).catch(() => false)) {
                const fileBuffer = await fs.readFile(localPath);
                const uploadResult = await uploadCategoryImage(fileBuffer, filename);

                category.image = uploadResult.url;
                category.publicId = uploadResult.publicId;
                await category.save();

                console.log(`✅ Category migrated: ${category.name}`);
                migratedCount++;
            } else {
                console.log(`⚠️ Category file not found: ${localPath}`);
                skippedCount++;
            }
        } catch (error) {
            console.error(`❌ Failed to migrate category ${category.name}:`, error.message);
            errorCount++;
        }
    }

    console.log(`✅ Category migration complete: ${migratedCount} migrated, ${skippedCount} skipped, ${errorCount} errors`);
    return { migrated: migratedCount, skipped: skippedCount, errors: errorCount };
}

// Migration for Posters
async function migratePosters() {
    const posters = await Poster.find({});
    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const poster of posters) {
        if (!poster.images || poster.images.length === 0) {
            skippedCount++;
            continue;
        }

        const newImages = [];
        for (const img of poster.images) {
            if (img.url && img.url.includes('cloudinary.com')) {
                newImages.push(img);
                skippedCount++;
                continue;
            }

            try {
                const filename = img.url ? img.url.split('/').pop() : null;
                if (!filename) {
                    newImages.push(img);
                    skippedCount++;
                    continue;
                }

                const localPath = path.join(PUBLIC_PATH, 'posters', filename);
                if (await fs.access(localPath).then(() => true).catch(() => false)) {
                    const fileBuffer = await fs.readFile(localPath);
                    const uploadResult = await uploadPosterImage(fileBuffer, filename);

                    newImages.push({
                        url: uploadResult.url,
                        filename: uploadResult.filename,
                        publicId: uploadResult.publicId,
                        order: img.order,
                        alt: img.alt
                    });

                    console.log(`✅ Poster image migrated: ${filename}`);
                    migratedCount++;
                } else {
                    console.log(`⚠️ Poster file not found: ${localPath}`);
                    newImages.push(img);
                    skippedCount++;
                }
            } catch (error) {
                console.error(`❌ Failed to migrate poster image ${img.url || 'unknown'}:`, error.message);
                newImages.push(img);
                errorCount++;
            }
        }

        poster.images = newImages;
        await poster.save();
    }

    console.log(`✅ Poster migration complete: ${migratedCount} migrated, ${skippedCount} skipped, ${errorCount} errors`);
    return { migrated: migratedCount, skipped: skippedCount, errors: errorCount };
}

// Migration for Messages
async function migrateMessages() {
    const messages = await Message.find({ isDeleted: false });
    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const message of messages) {
        if (!message.content || !message.content.url || message.content.url.includes('cloudinary.com')) {
            skippedCount++;
            continue;
        }

        try {
            const filename = message.content.url.split('/').pop();
            let localPath;
            let uploadFn;

            switch (message.messageType) {
                case 'image':
                    localPath = path.join(PUBLIC_PATH, 'messages', 'images', filename);
                    uploadFn = uploadMessageImage;
                    break;
                case 'video':
                    localPath = path.join(PUBLIC_PATH, 'messages', 'videos', filename);
                    uploadFn = uploadMessageVideo;
                    break;
                case 'voice':
                    localPath = path.join(PUBLIC_PATH, 'messages', 'voice', filename);
                    uploadFn = uploadMessageVoice;
                    break;
                case 'document':
                    localPath = path.join(PUBLIC_PATH, 'messages', 'documents', filename);
                    uploadFn = uploadMessageDocument;
                    break;
                default:
                    skippedCount++;
                    continue;
            }

            if (await fs.access(localPath).then(() => true).catch(() => false)) {
                const fileBuffer = await fs.readFile(localPath);
                const uploadResult = await uploadFn(fileBuffer, filename);

                message.content.url = uploadResult.url;
                message.content.publicId = uploadResult.publicId;
                await message.save();

                console.log(`✅ Message ${message.messageType} migrated: ${filename}`);
                migratedCount++;
            } else {
                console.log(`⚠️ Message file not found: ${localPath}`);
                skippedCount++;
            }
        } catch (error) {
            console.error(`❌ Failed to migrate message ${message._id}:`, error.message);
            errorCount++;
        }
    }

    console.log(`✅ Message migration complete: ${migratedCount} migrated, ${skippedCount} skipped, ${errorCount} errors`);
    return { migrated: migratedCount, skipped: skippedCount, errors: errorCount };
}

// Main migration function
async function migrate() {
    try {
        // Verify MongoDB connection
        if (mongoose.connection.readyState !== 1) {
            console.error('❌ MongoDB not connected');
            if (!process.env.MONGO_URL) {
                console.error('❌ MONGO_URL not defined in .env file');
                process.exit(1);
            }
            await mongoose.connect(process.env.MONGO_URL, {
                serverSelectionTimeoutMS: 30000,
                socketTimeoutMS: 45000
            });
            console.log('✅ MongoDB connected');
        }

        // Check if public folder exists
        if (!await fs.access(PUBLIC_PATH).then(() => true).catch(() => false)) {
            console.error('❌ Public folder not found at:', PUBLIC_PATH);
            process.exit(1);
        }

        // Check for .DS_Store and log
        const dsStorePath = path.join(PUBLIC_PATH, '.DS_Store');
        if (await fs.access(dsStorePath).then(() => true).catch(() => false)) {
            console.log('ℹ️ .DS_Store file found in public folder, skipping migration for this file');
        }

        console.log('🚀 Starting migration to Cloudinary...');
        const results = {
            products: await migrateProducts(),
            categories: await migrateCategories(),
            posters: await migratePosters(),
            messages: await migrateMessages()
        };

        console.log('🎉 All migrations complete!');
        console.log('📊 Summary:');
        console.log(`Products: ${results.products.migrated} migrated, ${results.products.skipped} skipped, ${results.products.errors} errors`);
        console.log(`Categories: ${results.categories.migrated} migrated, ${results.categories.skipped} skipped, ${results.categories.errors} errors`);
        console.log(`Posters: ${results.posters.migrated} migrated, ${results.posters.skipped} skipped, ${results.posters.errors} errors`);
        console.log(`Messages: ${results.messages.migrated} migrated, ${results.messages.skipped} skipped, ${results.messages.errors} errors`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

migrate();