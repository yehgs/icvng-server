import "dotenv/config";
import mongoose from "mongoose";
import ProductModel from "../models/product.model.js";
import CategoryModel from "../models/category.model.js";
import BrandModel from "../models/brand.model.js";

/**
 * Generates a unique SKU for a product
 * SKU formula: First 3 letters of product name + category + brand + 3 random numbers + 2 random letters
 * @param {string} productName - The name of the product
 * @param {string} categoryId - The category ID (ObjectId)
 * @param {string|Array} brandId - The brand ID (ObjectId) or array of brand IDs
 * @returns {Promise<string>} - Unique SKU
 */
const generateSKU = async (productName, categoryId, brandId) => {
  try {
    // Helper function to get first 3 letters from a string
    const getFirstThreeLetters = (str) => {
      if (!str) return "XXX";
      return str
        .replace(/[^a-zA-Z]/g, "")
        .substring(0, 3)
        .toUpperCase()
        .padEnd(3, "X");
    };

    // Helper function to generate random numbers
    const generateRandomNumbers = (count) => {
      let result = "";
      for (let i = 0; i < count; i++) {
        result += Math.floor(Math.random() * 10);
      }
      return result;
    };

    // Helper function to generate random letters
    const generateRandomLetters = (count) => {
      const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      let result = "";
      for (let i = 0; i < count; i++) {
        result += letters.charAt(Math.floor(Math.random() * letters.length));
      }
      return result;
    };

    // Get product name prefix
    const productPrefix = getFirstThreeLetters(productName);

    // Get category name
    let categoryPrefix = "CAT";
    if (categoryId) {
      const category = await CategoryModel.findById(categoryId);
      if (category && category.name) {
        categoryPrefix = getFirstThreeLetters(category.name);
      }
    }

    // Get brand name
    let brandPrefix = "BRD";
    if (brandId) {
      // Handle array of brands - take the first one
      const actualBrandId = Array.isArray(brandId) ? brandId[0] : brandId;
      if (actualBrandId) {
        const brand = await BrandModel.findById(actualBrandId);
        if (brand && brand.name) {
          brandPrefix = getFirstThreeLetters(brand.name);
        }
      }
    }

    // Generate random components
    const randomNumbers = generateRandomNumbers(3);
    const randomLetters = generateRandomLetters(2);

    // Combine all parts
    let baseSKU = `${productPrefix}${categoryPrefix}${brandPrefix}${randomNumbers}${randomLetters}`;

    // Ensure uniqueness by checking against existing SKUs
    let finalSKU = baseSKU;
    let counter = 1;

    while (await ProductModel.findOne({ sku: finalSKU })) {
      // If SKU exists, append a counter
      finalSKU = `${baseSKU}${counter.toString().padStart(2, "0")}`;
      counter++;

      // Safety check to prevent infinite loop
      if (counter > 999) {
        // Generate completely new random components
        const newRandomNumbers = generateRandomNumbers(3);
        const newRandomLetters = generateRandomLetters(2);
        baseSKU = `${productPrefix}${categoryPrefix}${brandPrefix}${newRandomNumbers}${newRandomLetters}`;
        finalSKU = baseSKU;
        counter = 1;
      }
    }

    return finalSKU;
  } catch (error) {
    console.error("Error generating SKU:", error);
    // Fallback SKU generation if database queries fail
    return `PRD${Date.now().toString().slice(-6)}${Math.random()
      .toString(36)
      .substring(2, 4)
      .toUpperCase()}`;
  }
};

/**
 * Updates products that are missing SKUs
 */
const updateProductsWithoutSKU = async () => {
  try {
    console.log("🚀 Starting SKU generation script...\n");

    // Get MongoDB URI from environment
    const MONGODB_URI = process.env.MONGODB_URI;

    if (!MONGODB_URI) {
      console.error("❌ Error: MONGODB_URI is not defined in .env file");
      console.log("\nPlease add MONGODB_URI to your .env file:");
      console.log("MONGODB_URI=mongodb://your-connection-string\n");
      process.exit(1);
    }

    console.log("📋 Configuration:");
    console.log(
      `   MongoDB URI: ${MONGODB_URI.replace(/\/\/.*@/, "//***@")}\n`,
    );

    console.log("🔄 Connecting to MongoDB...");
    await mongoose.connect(MONGODB_URI);
    console.log("✅ Connected to MongoDB successfully!\n");

    // Find all products without SKU or with empty SKU
    const productsWithoutSKU = await ProductModel.find({
      $or: [
        { sku: { $exists: false } },
        { sku: null },
        { sku: "" },
        { sku: /^\s*$/ }, // Matches empty or whitespace-only strings
      ],
    }).populate("category brand");

    console.log(`📦 Found ${productsWithoutSKU.length} products without SKU\n`);

    if (productsWithoutSKU.length === 0) {
      console.log("✨ All products already have SKUs! Nothing to update.");
      await mongoose.disconnect();
      return;
    }

    let successCount = 0;
    let failureCount = 0;
    const errors = [];

    // Process each product
    for (let i = 0; i < productsWithoutSKU.length; i++) {
      const product = productsWithoutSKU[i];

      try {
        console.log(
          `\n[${i + 1}/${productsWithoutSKU.length}] Processing: ${product.name}`,
        );
        console.log(`   Product ID: ${product._id}`);

        // Generate SKU
        const newSKU = await generateSKU(
          product.name,
          product.category,
          product.brand,
        );

        console.log(`   Generated SKU: ${newSKU}`);

        // Update the product
        await ProductModel.findByIdAndUpdate(
          product._id,
          { sku: newSKU },
          { new: true },
        );

        console.log(`   ✅ Updated successfully`);
        successCount++;
      } catch (error) {
        console.error(`   ❌ Error updating product: ${error.message}`);
        failureCount++;
        errors.push({
          productId: product._id,
          productName: product.name,
          error: error.message,
        });
      }
    }

    // Print summary
    console.log("\n" + "=".repeat(60));
    console.log("📊 UPDATE SUMMARY");
    console.log("=".repeat(60));
    console.log(`✅ Successfully updated: ${successCount} products`);
    console.log(`❌ Failed to update: ${failureCount} products`);
    console.log(`📦 Total processed: ${productsWithoutSKU.length} products`);

    if (errors.length > 0) {
      console.log("\n❌ ERRORS:");
      errors.forEach((err, index) => {
        console.log(
          `\n${index + 1}. Product: ${err.productName} (ID: ${err.productId})`,
        );
        console.log(`   Error: ${err.error}`);
      });
    }

    console.log("\n✨ Script completed!");

    // Disconnect from MongoDB
    await mongoose.disconnect();
    console.log("🔌 Disconnected from MongoDB");
  } catch (error) {
    console.error("💥 Fatal error:", error.message);
    if (error.stack) {
      console.error("\nStack trace:", error.stack);
    }
    try {
      await mongoose.disconnect();
    } catch (disconnectError) {
      // Ignore disconnect errors
    }
    process.exit(1);
  }
};

// Run the script
updateProductsWithoutSKU();
