// scripts/cleanup-table-shipping-methods.js
// Run this script to remove flatRate and pickup configs from table_shipping methods

import mongoose from 'mongoose';
import ShippingMethodModel from '../models/shipping-method.model.js';
import dotenv from 'dotenv';

dotenv.config();

const cleanupTableShippingMethods = async () => {
  try {
    console.log('🔧 Starting cleanup of table_shipping methods...');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✅ Connected to MongoDB');

    // Find all table_shipping methods
    const tableShippingMethods = await ShippingMethodModel.find({
      type: 'table_shipping',
    });

    console.log(
      `📊 Found ${tableShippingMethods.length} table_shipping methods to clean`
    );

    let cleanedCount = 0;
    let alreadyCleanCount = 0;

    for (const method of tableShippingMethods) {
      const hadFlatRate = !!method.flatRate;
      const hadPickup = !!method.pickup;

      if (hadFlatRate || hadPickup) {
        console.log(`\n🧹 Cleaning method: ${method.name} (${method.code})`);
        console.log(`   - Has flatRate: ${hadFlatRate}`);
        console.log(`   - Has pickup: ${hadPickup}`);

        // Use MongoDB's $unset operator to completely remove the fields
        await ShippingMethodModel.updateOne(
          { _id: method._id },
          {
            $unset: {
              flatRate: '',
              pickup: '',
            },
          }
        );

        cleanedCount++;
        console.log(`   ✅ Cleaned successfully`);
      } else {
        alreadyCleanCount++;
        console.log(
          `\n✨ Method already clean: ${method.name} (${method.code})`
        );
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 CLEANUP SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total table_shipping methods: ${tableShippingMethods.length}`);
    console.log(`Methods cleaned: ${cleanedCount}`);
    console.log(`Already clean: ${alreadyCleanCount}`);
    console.log('='.repeat(60));

    // Verify the cleanup
    console.log('\n🔍 Verifying cleanup...');
    const verifyMethods = await ShippingMethodModel.find({
      type: 'table_shipping',
    });

    let stillHasIssues = 0;
    for (const method of verifyMethods) {
      if (method.flatRate || method.pickup) {
        console.log(`❌ Still has unwanted config: ${method.name}`);
        stillHasIssues++;
      }
    }

    if (stillHasIssues === 0) {
      console.log('✅ All table_shipping methods are now clean!');
    } else {
      console.log(`⚠️  ${stillHasIssues} methods still have issues`);
    }

    await mongoose.connection.close();
    console.log('\n✅ Cleanup completed and database connection closed');
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
};

// Run the cleanup
cleanupTableShippingMethods();
