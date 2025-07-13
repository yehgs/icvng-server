import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
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
import bannerRouter from './route/banner.route.js';
import productRequestRouter from './route/productRequest.route.js';
import wishlistRouter from './route/wishlist.route.js';
import compareRouter from './route/compare.route.js';
import adminAuthRouter from './route/admin-auth.route.js';
import adminUserRouter from './route/admin-user.route.js';
import colorRouter from './route/color.route.js';
import supplierRouter from './route/supplier.route.js';
import purchaseOrderRouter from './route/purchaseOrder.route.js';
import stockRouter from './route/stock.route.js';
import pricingRouter from './route/price.route.js';
import exchangeRateRouter from './route/exchange-rate.route.js';
import warehouseRouter from './route/warehouse.route.js';

dotenv.config();

// console.log(process.env.ADMIN_FRONTEND_URL1);
// console.log(process.env.ADMIN_FRONTEND_URL2);

const app = express();
app.use(
  cors({
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'x-auth-token',
      'token',
      'x-access-token',
      'x-csrf-token',
    ],
    origin: (origin, callback) => {
      console.log('Incoming Origin:', origin);
      const allowedOrigins = [
        process.env.FRONTEND_URL,
        process.env.ADMIN_FRONTEND_URL,
        process.env.FRONTEND_URL1,
        process.env.FRONTEND_URL2,
        process.env.FRONTEND_URL3,
        process.env.ADMIN_FRONTEND_URL1,
        process.env.ADMIN_FRONTEND_URL2,
      ];

      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.log('Blocked by CORS:', origin);
        callback(new Error('Not allowed by CORS'));
      }
    },
  })
);

app.options('*', cors());
app.use(express.json());
app.use(cookieParser());
app.use(morgan());
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

const PORT = 8080 || process.env.PORT;

app.get('/', (request, response) => {
  ///server to client
  response.json({
    message: 'Server is running ' + PORT,
  });
});

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
app.use('/api/banner', bannerRouter);
app.use('/api/product-request', productRequestRouter);
app.use('/api/wishlist', wishlistRouter);
app.use('/api/compare', compareRouter);
app.use('/api/admin/auth', adminAuthRouter);
app.use('/api/admin/user', adminUserRouter);
app.use('/api/colors', colorRouter);
app.use('/api/suppliers', supplierRouter);
app.use('/api/purchase-orders', purchaseOrderRouter);
app.use('/api/stock', stockRouter);
app.use('/api/pricing', pricingRouter);
app.use('/api/exchange-rates', exchangeRateRouter);
app.use('/api/warehouse', warehouseRouter);

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log('Server is running', PORT);
  });
});
