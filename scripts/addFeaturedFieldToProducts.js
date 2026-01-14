// scripts/addFeaturedFieldToProducts.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import ProductModel from "../models/product.model.js";

dotenv.config();

const addFeaturedFieldToProducts = async () => {
  try {
    console.log("🔄 Connecting to database...");
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Database connected successfully\n");

    // Find all products that don't have the featured field
    const productsWithoutFeatured = await ProductModel.find({
      featured: { $exists: false },
    });

    console.log(
      `📊 Found ${productsWithoutFeatured.length} products without 'featured' field\n`
    );

    if (productsWithoutFeatured.length === 0) {
      console.log("✅ All products already have the featured field!");
      await mongoose.connection.close();
      return;
    }

    // Update all products without featured field
    const result = await ProductModel.updateMany(
      { featured: { $exists: false } },
      { $set: { featured: false } }
    );

    console.log("📝 Migration Results:");
    console.log(`   ✅ Matched: ${result.matchedCount} products`);
    console.log(`   ✅ Modified: ${result.modifiedCount} products`);
    console.log(`   ✅ Acknowledged: ${result.acknowledged}\n`);

    // Verify the update
    const remainingProducts = await ProductModel.find({
      featured: { $exists: false },
    });

    console.log("🔍 Verification:");
    console.log(
      `   Products without 'featured' field: ${remainingProducts.length}`
    );

    // Show sample of updated products
    const sampleProducts = await ProductModel.find({})
      .limit(5)
      .select("name featured");
    console.log("\n📋 Sample of updated products:");
    sampleProducts.forEach((product, index) => {
      console.log(
        `   ${index + 1}. ${product.name} - featured: ${product.featured}`
      );
    });

    console.log("\n✅ Migration completed successfully!");

    await mongoose.connection.close();
    console.log("🔌 Database connection closed");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
};

// Run the migration
addFeaturedFieldToProducts();
