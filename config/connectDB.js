// config/connectDB.js
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

// Check for required environment variables
if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not defined in environment variables');
  throw new Error('Please provide MONGODB_URI in the .env file');
}

// Global variables to track connection state
let cachedConnection = null;
let isConnected = false;

const connectDB = async () => {
  // If we already have a connection, return it
  if (isConnected && cachedConnection) {
    console.log('Using existing database connection');
    return cachedConnection;
  }

  console.log('Creating new database connection');

  try {
    // Force close previous connections - helps with serverless reconnection issues
    if (mongoose.connections.length > 0) {
      const connectionState = mongoose.connections[0].readyState;
      if (connectionState === 1) {
        console.log('Reusing existing MongoDB connection');
        isConnected = true;
        return mongoose;
      }

      // If connection state isn't "connected", disconnect
      await mongoose.disconnect();
      console.log('Closed previous MongoDB connection');
    }

    // MongoDB options optimized for serverless environments
    const options = {
      serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
      socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
      maxPoolSize: 10, // Maintain up to 10 socket connections
      bufferCommands: false, // Disable mongoose buffering
      useNewUrlParser: true, // Required for MongoDB driver
      useUnifiedTopology: true, // Required for MongoDB driver
    };

    // Connect to MongoDB
    const connection = await mongoose.connect(process.env.MONGODB_URI, options);

    // Log successful connection
    console.log('Connected to MongoDB');
    console.log('MongoDB connection state:', mongoose.connection.readyState);

    // Update connection status
    isConnected = true;
    cachedConnection = connection;

    // Pre-load all models to avoid "Schema hasn't been registered" errors
    // Note: You should import your models here
    // This is especially important for referenced models

    // Return the connection
    return connection;
  } catch (error) {
    console.error('MongoDB connection error:', error);
    isConnected = false;
    cachedConnection = null;

    // In serverless environment, don't exit process
    if (!process.env.VERCEL) {
      process.exit(1);
    }

    throw error;
  }
};

export default connectDB;
