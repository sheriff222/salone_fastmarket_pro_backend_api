const mongoose = require('mongoose');
const Product = require('../model/product');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URL || 'mongodb://localhost:27017/yourdb')
  .then(async () => {
    console.log('✅ Connected to MongoDB');

    // Create text index
    try {
      await Product.collection.createIndex({ name: 'text', description: 'text' });
      console.log('✅ Text index created on products (name, description)');
    } catch (error) {
      console.error('❌ Failed to create text index:', error.message);
    }

    // Create regular index
    try {
      await Product.collection.createIndex({ name: 1 });
      console.log('✅ Regular index created on products (name)');
    } catch (error) {
      console.error('❌ Failed to create regular index:', error.message);
    }

    // Verify indexes
    const indexes = await Product.collection.getIndexes();
    console.log('Current indexes:', JSON.stringify(indexes, null, 2));

    process.exit(0);
  })
  .catch(error => {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  });