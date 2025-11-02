import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

if (!process.env.MONGODB_URI) {
  throw new Error('❌ Please provide MONGODB_URI in the .env file');
}

const connectDB = async () => {
  const options = {     
    serverSelectionTimeoutMS: 20000,  
  };

  const uri = process.env.MONGODB_URI;

  const connect = async () => {
    try {
      const conn = await mongoose.connect(uri, options);
      console.log(`✅ MongoDB connected: ${conn.connection.host}`);
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error.message);

      // If it’s a timeout or DNS error, retry instead of exiting
      if (
        error.code === 'ETIMEOUT' ||
        error.code === 'ENOTFOUND' ||
        error.name === 'MongooseServerSelectionError'
      ) {
        console.log('⏳ Retrying MongoDB connection in 5 seconds...');
        setTimeout(connect, 5000);
      } else {
        console.error('🚨 Unrecoverable DB error. Check your URI or credentials.');
        process.exit(1);
      }
    }
  };

  await connect();
};

export default connectDB;
