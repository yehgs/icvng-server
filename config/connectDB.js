import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

if (!process.env.MONGODB_URI) {
  throw new Error('Please provide MONGODB_URI in the .env file');
}

// Cache the database connection between function invocations
let cachedConnection = null;

async function connectDB() {
  // If a connection already exists, reuse it
  if (cachedConnection) {
    console.log('Using existing database connection');
    return cachedConnection;
  }

  console.log('Creating new database connection');

  try {
    // Set mongoose options for better performance in serverless environments
    const options = {
      serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
      socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
      maxPoolSize: 10, // Maintain up to 10 socket connections
    };

    // Connect to MongoDB
    const connection = await mongoose.connect(process.env.MONGODB_URI, options);

    // Cache the connection
    cachedConnection = connection;

    console.log('Connected to MongoDB');
    return connection;
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
}

export default connectDB;
