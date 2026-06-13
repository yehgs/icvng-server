import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

if (!process.env.MONGODB_URI) {
  throw new Error('❌ Please provide MONGODB_URI in the .env file');
}

// Named function so we can remove/re-add the listener on reconnect
function handleConnectionError(err) {
  console.error('⚠️  MongoDB runtime error (handled):', err.message);
}

const connectDB = async () => {
  const options = {
    serverSelectionTimeoutMS: 20000,
    maxPoolSize: 10,
    minPoolSize: 2,           // keep a few warm connections so the pool recovers faster
    socketTimeoutMS: 45000,
    family: 4, // Force IPv4 — avoids SSL handshake issues on dual-stack hosts
    retryWrites: true,        // auto-retry writes dropped by a transient pool error
    retryReads: true,         // auto-retry reads dropped by a transient pool error
  };

  const uri = process.env.MONGODB_URI;
  let retryCount = 0;
  const MAX_RETRIES = 10;

  const connect = async () => {
    try {
      const conn = await mongoose.connect(uri, options);
      console.log(`✅ MongoDB connected: ${conn.connection.host}`);
      retryCount = 0;

      // Ensure we only register these listeners once
      mongoose.connection.off('error', handleConnectionError);
      mongoose.connection.on('error', handleConnectionError);

      mongoose.connection.on('disconnected', () => {
        console.warn('⚠️  MongoDB disconnected — will auto-reconnect');
      });
      mongoose.connection.on('reconnected', () => {
        console.log('✅ MongoDB reconnected');
      });
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error.message);

      const isTransient =
        error.code === 'ETIMEOUT' ||
        error.code === 'ENOTFOUND' ||
        error.code === 'ECONNRESET' ||
        // SSL alert number 80 = unrecognised_name — transient on Atlas
        (error.message && error.message.includes('SSL alert number 80')) ||
        (error.message && error.message.includes('ssl3_read_bytes')) ||
        error.name === 'MongooseServerSelectionError' ||
        error.name === 'MongoNetworkError';

      if (isTransient && retryCount < MAX_RETRIES) {
        retryCount++;
        const delay = Math.min(5000 * retryCount, 30000); // exponential backoff up to 30s
        console.log(
          `⏳ Retrying MongoDB connection in ${delay / 1000}s... (attempt ${retryCount}/${MAX_RETRIES})`
        );
        setTimeout(connect, delay);
      } else {
        // Don't crash the server — keep it up so health checks pass.
        // Individual routes will fail gracefully when DB is unavailable.
        console.error(
          '🚨 Could not establish MongoDB connection. Check your URI, credentials, and network.'
        );
      }
    }
  };

  await connect();
};

export default connectDB;
