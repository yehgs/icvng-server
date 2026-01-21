import dotenv from "dotenv";
import mongoose from "mongoose";
import CartProductModel from "./models/cartproduct.model.js";
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

async function fixIndexes() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("Connected to MongoDB");

    // Drop old index
    await CartProductModel.collection.dropIndex("userId_1_productId_1");
    console.log("Old index dropped");

    // Create new indexes
    await CartProductModel.syncIndexes();
    console.log("New indexes created");

    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

fixIndexes();
