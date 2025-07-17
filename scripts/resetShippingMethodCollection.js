import mongoose from 'mongoose';
import dotenv from 'dotenv';
import ShippingMethodModel from '../models/shipping-method.model.js';

dotenv.config();

const resetShippingMethodCollection = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Drop the existing collection if it exists
    const collectionExists = await mongoose.connection.db
      .listCollections({ name: 'shippingmethods' })
      .hasNext();

    if (collectionExists) {
      await mongoose.connection.db.dropCollection('shippingmethods');
      console.log('🗑️ Dropped existing shippingmethods collection');
    }

    // Recreate indexes from schema
    await ShippingMethodModel.init();
    console.log('✅ Re-initialized ShippingMethod schema with indexes');

    console.log('🚀 Migration complete: shippingmethods collection reset');
  } catch (err) {
    console.error('❌ Migration failed:', err);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 MongoDB connection closed');
  }
};

resetShippingMethodCollection();
