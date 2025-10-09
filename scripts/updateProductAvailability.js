// scripts/updateProductAvailability.js
import mongoose from 'mongoose';
import ProductModel from '../models/product.model.js'; // Adjust path as needed
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const updateProductAvailability = async () => {
  try {
    console.log('🚀 Starting product availability update...');

    // Connect to MongoDB
    const MONGODB_URI =
      process.env.MONGODB_URI || 'your-mongodb-connection-string';

    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✅ Connected to MongoDB');

    // Get current statistics
    const totalProducts = await ProductModel.countDocuments({});
    const productsWithAvailabilityTrue = await ProductModel.countDocuments({
      productAvailability: true,
    });
    const productsWithAvailabilityFalse = await ProductModel.countDocuments({
      productAvailability: false,
    });
    const productsWithAvailabilityNull = await ProductModel.countDocuments({
      productAvailability: { $exists: false },
    });

    console.log('\n📊 Current Statistics:');
    console.log(`Total products: ${totalProducts}`);
    console.log(
      `Products with availability = true: ${productsWithAvailabilityTrue}`
    );
    console.log(
      `Products with availability = false: ${productsWithAvailabilityFalse}`
    );
    console.log(
      `Products with availability = null/undefined: ${productsWithAvailabilityNull}`
    );

    // Update all products to set productAvailability to true
    const result = await ProductModel.updateMany(
      {}, // Empty filter = all documents
      {
        $set: { productAvailability: true },
      }
    );

    console.log('\n✨ Update completed!');
    console.log(`📝 Matched documents: ${result.matchedCount}`);
    console.log(`✏️  Modified documents: ${result.modifiedCount}`);

    // Get updated statistics
    const updatedTotal = await ProductModel.countDocuments({
      productAvailability: true,
    });

    console.log('\n📊 Updated Statistics:');
    console.log(`Products with availability = true: ${updatedTotal}`);

    // Show sample of updated products
    const sampleProducts = await ProductModel.find({})
      .select('name sku productAvailability')
      .limit(5);

    console.log('\n📦 Sample of updated products:');
    sampleProducts.forEach((product, index) => {
      console.log(
        `${index + 1}. ${product.name} (SKU: ${product.sku}) - Available: ${
          product.productAvailability
        }`
      );
    });

    console.log('\n✅ Script completed successfully!');
  } catch (error) {
    console.error('❌ Error updating product availability:', error);
    throw error;
  } finally {
    // Close the database connection
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
    process.exit(0);
  }
};

// Run the script
updateProductAvailability();
