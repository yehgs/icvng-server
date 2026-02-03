// resetProductPrices.js
import "dotenv/config";
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import mongoose from "mongoose";
import { fileURLToPath } from "url";
import { dirname } from "path";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const resetProductPrices = async () => {
  try {
    console.log("🚀 Starting Product Price Reset Script...\n");

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

    // Read the CSV file from the scripts directory
    const csvFilePath = path.join(__dirname, "product_pricing_2026-01-31.csv");

    console.log(`📂 Looking for CSV file at: ${csvFilePath}\n`);

    // Check if file exists
    if (!fs.existsSync(csvFilePath)) {
      console.error("❌ Error: CSV file not found!");
      console.log("\nPlease place your CSV file at:");
      console.log(`   ${csvFilePath}\n`);
      console.log("Or in the same directory as this script with the name:");
      console.log("   product_pricing_2026-01-31.csv\n");
      await mongoose.disconnect();
      process.exit(1);
    }

    const fileContent = fs.readFileSync(csvFilePath, "utf-8");

    // Parse CSV
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    console.log(`📦 Total products in CSV: ${records.length}\n`);

    // Reset prices for first 20 products
    const productsToUpdate = Math.min(20, records.length);

    console.log(
      `🔄 Resetting prices for first ${productsToUpdate} products...\n`,
    );

    for (let i = 0; i < productsToUpdate; i++) {
      records[i].price = "0";
      records[i].salePrice = "0";
      records[i].price3weeksDelivery = "0";
      records[i].price5weeksDelivery = "0";
      records[i].btbPrice = "0";
      records[i].btcPrice = "0";
    }

    console.log(`✅ Reset prices for ${productsToUpdate} products\n`);

    // Convert back to CSV
    const updatedCsv = stringify(records, {
      header: true,
      columns: Object.keys(records[0]),
    });

    // Save to new file in the same directory
    const timestamp = new Date().toISOString().split("T")[0];
    const outputPath = path.join(
      __dirname,
      `product_pricing_${timestamp}_RESET.csv`,
    );

    fs.writeFileSync(outputPath, updatedCsv);

    console.log("✅ Success! Updated CSV saved to:");
    console.log(`   ${outputPath}\n`);
    console.log(
      `📊 First ${productsToUpdate} products now have all prices set to 0\n`,
    );

    // Show summary of first 3 products
    console.log("=".repeat(60));
    console.log("📊 SAMPLE OF UPDATED PRODUCTS");
    console.log("=".repeat(60));

    records.slice(0, 3).forEach((product, index) => {
      console.log(`\n[Product ${index + 1}]`);
      console.log(`  Name: ${product.name || "N/A"}`);
      console.log(`  SKU: ${product.sku || "N/A"}`);
      console.log(`  Price: ₦${product.price}`);
      console.log(`  Sale Price: ₦${product.salePrice}`);
      console.log(`  3 Weeks Delivery: ₦${product.price3weeksDelivery}`);
      console.log(`  5 Weeks Delivery: ₦${product.price5weeksDelivery}`);
      console.log(`  BTB Price: ₦${product.btbPrice}`);
      console.log(`  BTC Price: ₦${product.btcPrice}`);
    });

    console.log("\n" + "=".repeat(60));
    console.log("✨ Script completed successfully!");
    console.log("=".repeat(60));

    // Disconnect from MongoDB
    await mongoose.disconnect();
    console.log("\n🔌 Disconnected from MongoDB");
  } catch (error) {
    console.error("❌ Error processing CSV:", error.message);
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
resetProductPrices();
