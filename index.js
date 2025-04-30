import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import helmet from 'helmet';
import connectDB from './config/connectDB.js';
import userRouter from './route/user.route.js';
import categoryRouter from './route/category.route.js';
import attributeRouter from './route/attribute.route.js';
import tagRouter from './route/tag.route.js';
import brandRouter from './route/brand.route.js';
import ratingRouter from './route/rating.route.js';
import uploadRouter from './route/upload.router.js';
import subCategoryRouter from './route/subCategory.route.js';
import productRouter from './route/product.route.js';
import cartRouter from './route/cart.route.js';
import addressRouter from './route/address.route.js';
import orderRouter from './route/order.route.js';
import coffeeRoastAreaRouter from './route/coffee-roast-area.route.js';
import sliderRouter from './route/slider.route.js';
import productRequestRouter from './route/productRequest.route.js';

// Debug environment variables on startup (will appear in Vercel logs)
console.log('Environment check:', {
  nodeEnv: process.env.NODE_ENV,
  vercelEnv: process.env.VERCEL_ENV,
  frontendUrlExists: !!process.env.FRONTEND_URL,
  frontendUrl2Exists: !!process.env.FRONTEND_URL2,
  mongoDbUriExists: !!process.env.MONGODB_URI,
});

const app = express();

// Improved CORS configuration for Vercel
const allowedOrigins = [
  'https://italiancoffeeng.vercel.app', // Add your deployed frontend URL explicitly
  'https://www.italiancoffeeng.com', // Add your custom domain if you have one
  'http://localhost:3000', // For local development
  process.env.FRONTEND_URL,
  process.env.FRONTEND_URL2,
].filter(Boolean); // Remove any undefined values

console.log('Allowed CORS origins:', allowedOrigins);

app.use(
  cors({
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.log(`CORS blocked for origin: ${origin}`);
        callback(null, false); // Don't throw error, just block the request
      }
    },
  })
);

// Handle OPTIONS preflight requests explicitly
app.options('*', cors());

app.use(express.json());
app.use(cookieParser());

// Use morgan only in development mode
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('tiny')); // Minimal logging in production
}

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(500).json({
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'production' ? null : err.message,
  });
});

// Health check route
app.get('/', (request, response) => {
  response.json({
    message: 'Server is running',
    environment: process.env.NODE_ENV,
    vercel: !!process.env.VERCEL,
  });
});

// API routes
app.use('/api/user', userRouter);
app.use('/api/category', categoryRouter);
app.use('/api/file', uploadRouter);
app.use('/api/subcategory', subCategoryRouter);
app.use('/api/product', productRouter);
app.use('/api/tag', tagRouter);
app.use('/api/brand', brandRouter);
app.use('/api/rating', ratingRouter);
app.use('/api/attribute', attributeRouter);
app.use('/api/cart', cartRouter);
app.use('/api/address', addressRouter);
app.use('/api/order', orderRouter);
app.use('/api/coffee-roast-area', coffeeRoastAreaRouter);
app.use('/api/slider', sliderRouter);
app.use('/api/product-request', productRequestRouter);

// Debug route - remove in production
if (process.env.NODE_ENV !== 'production') {
  app.get('/debug-env', (req, res) => {
    res.json({
      nodeEnv: process.env.NODE_ENV,
      vercel: !!process.env.VERCEL,
      vercelEnv: process.env.VERCEL_ENV,
      allowedOrigins,
      mongoDbUriExists: !!process.env.MONGODB_URI,
    });
  });
}

// Catch-all route handler for non-existent routes
app.use('*', (req, res) => {
  res.status(404).json({ message: 'API endpoint not found' });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Don't exit process in serverless environment
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit process in serverless environment
});

// Server startup logic
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Check if we're in a serverless environment
    if (process.env.VERCEL) {
      console.log('Running in Vercel serverless environment');
      // In Vercel, we don't explicitly start a server
    } else {
      // Traditional server startup for local development
      const PORT = process.env.PORT || 8080;
      app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
      });
    }
  } catch (error) {
    console.error('Failed to start server:', error);
    // Don't exit process in serverless environment
  }
};

// Start server if not in a serverless environment
if (!process.env.VERCEL) {
  startServer();
}

// Export the app for serverless functions
export default app;
