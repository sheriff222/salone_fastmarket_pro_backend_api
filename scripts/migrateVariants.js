// scripts/migrateVariants.js
const mongoose = require('mongoose');
const Product = require('../model/product');
require('dotenv').config();

async function migrateVariantIds() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'your-mongodb-connection-string');
        console.log('🔗 Connected to MongoDB');

        const products = await Product.find({});
        console.log(`📦 Found ${products.length} products to check`);

        let updatedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        for (const product of products) {
            try {
                if (!product.proVariantId || product.proVariantId.length === 0) {
                    skippedCount++;
                    continue;
                }

                // Check if variants need conversion
                let needsUpdate = false;
                const convertedVariants = [];

                for (const variant of product.proVariantId) {
                    if (typeof variant === 'string' || variant instanceof String) {
                        // It's a string ID, needs conversion
                        needsUpdate = true;
                        if (mongoose.Types.ObjectId.isValid(variant)) {
                            convertedVariants.push(new mongoose.Types.ObjectId(variant));
                        }
                    } else if (variant._id && typeof variant._id === 'string') {
                        // It's an object with _id as string
                        needsUpdate = true;
                        if (mongoose.Types.ObjectId.isValid(variant._id)) {
                            convertedVariants.push(new mongoose.Types.ObjectId(variant._id));
                        }
                    } else if (mongoose.Types.ObjectId.isValid(variant)) {
                        // Already an ObjectId, keep it
                        convertedVariants.push(variant);
                    }
                }

                if (needsUpdate && convertedVariants.length > 0) {
                    product.proVariantId = convertedVariants;
                    await product.save();
                    updatedCount++;
                    console.log(`✅ Updated product: ${product.name} (${product._id}) - ${convertedVariants.length} variants`);
                } else {
                    skippedCount++;
                }

            } catch (error) {
                errorCount++;
                console.error(`❌ Error updating product ${product._id}:`, error.message);
            }
        }

        console.log('\n📊 Migration Summary:');
        console.log(`   ✅ Updated: ${updatedCount} products`);
        console.log(`   ⏭️  Skipped: ${skippedCount} products`);
        console.log(`   ❌ Errors: ${errorCount} products`);
        console.log('\n🎉 Migration completed!');

    } catch (error) {
        console.error('❌ Migration failed:', error);
    } finally {
        await mongoose.connection.close();
        console.log('🔌 Database connection closed');
    }
}

// Run the migration
migrateVariantIds();