// icvng-server/index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import helmet from "helmet";
import connectDB from "./config/connectDB.js";
import userRouter from "./route/user.route.js";
import categoryRouter from "./route/category.route.js";
import attributeRouter from "./route/attribute.route.js";
import tagRouter from "./route/tag.route.js";
import brandRouter from "./route/brand.route.js";
import ratingRouter from "./route/rating.route.js";
import uploadRouter from "./route/upload.route.js";
import subCategoryRouter from "./route/subCategory.route.js";
import productRouter from "./route/product.route.js";
import cartRouter from "./route/cart.route.js";
import addressRouter from "./route/address.route.js";
import orderRouter from "./route/order.route.js";
import coffeeRoastAreaRouter from "./route/coffee-roast-area.route.js";
import sliderRouter from "./route/slider.route.js";
import bannerRouter from "./route/banner.route.js";
import productRequestRouter from "./route/productRequest.route.js";
import wishlistRouter from "./route/wishlist.route.js";
import compareRouter from "./route/compare.route.js";
import adminAuthRouter from "./route/admin-auth.route.js";
import adminUserRouter from "./route/admin-user.route.js";
import colorRouter from "./route/color.route.js";
import supplierRouter from "./route/supplier.route.js";
import purchaseOrderRouter from "./route/purchaseOrder.route.js";
import stockRouter from "./route/stock.route.js";
import pricingRouter from "./route/price.route.js";
import exchangeRateRouter from "./route/exchange-rate.route.js";
import warehouseRouter from "./route/warehouse.route.js";
import shippingRouter from "./route/shipping.route.js";
import blogRouter from "./route/blog.route.js";
import directPricingRouter from "./route/direct-pricing.route.js";
import customerRouter from "./route/customer.route.js";
import formEmailRouter from "./route/form-email.route.js";
import adminOrderRouter from "./route/admin-order.route.js";
import orderRequestRouter from "./route/order-request.route.js";
import couponRouter from "./route/coupon.route.js";
import orderRequestAuthRouter from "./route/order-request-auth.route.js";
import invoiceRouter from "./route/invoice.route.js";

dotenv.config();

const app = express();
app.use(
  cors({
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "x-auth-token",
      "token",
      "x-access-token",
      "x-csrf-token",
    ],
    exposedHeaders: ["Content-Disposition", "Content-Type"],
    origin: (origin, callback) => {
      const allowedOrigins = [
        process.env.FRONTEND_URL,
        process.env.ADMIN_FRONTEND_URL,
        process.env.FRONTEND_URL1,
        process.env.FRONTEND_URL2,
        process.env.FRONTEND_URL3,
        process.env.FRONTEND_URL4,
        process.env.ADMIN_FRONTEND_URL1,
        process.env.ADMIN_FRONTEND_URL2,
      ];

      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.log("Blocked by CORS:", origin);
        callback(new Error("Not allowed by CORS"));
      }
    },
  }),
);
app.options("*", cors());

app.post(
  "/api/order/webhook",
  express.raw({ type: "application/json" }),
  (req, res, next) => {
    import("./controllers/order.controller.js").then(({ webhookStripe }) => {
      webhookStripe(req, res);
    });
  },
);

app.use(
  express.json({
    limit: "50mb",
    strict: false,
  }),
);

app.use(
  express.urlencoded({
    limit: "50mb",
    extended: true,
    parameterLimit: 50000,
  }),
);

app.use(cookieParser());
app.use(morgan("dev"));
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  }),
);

// ============================================
// Debug middleware (optional but helpful)
// ============================================
app.use((req, res, next) => {
  if (req.path.includes("/upload")) {
    console.log("📥 Upload request:", {
      method: req.method,
      path: req.path,
      contentType: req.headers["content-type"],
      contentLength: req.headers["content-length"],
    });
  }
  next();
});

const PORT = 8080 || process.env.PORT;

app.get("/", (request, response) => {
  ///server to client
  response.json({
    message: "Server is running " + PORT,
    payloadLimit: "50mb",
  });
});
app.use("/api/file", uploadRouter);
app.use("/api/user", userRouter);
app.use("/api/category", categoryRouter);
app.use("/api/subcategory", subCategoryRouter);
app.use("/api/product", productRouter);
app.use("/api/tag", tagRouter);
app.use("/api/brand", brandRouter);
app.use("/api/rating", ratingRouter);
app.use("/api/attribute", attributeRouter);
app.use("/api/cart", cartRouter);
app.use("/api/address", addressRouter);
app.use("/api/order", orderRouter);
app.use("/api/coffee-roast-area", coffeeRoastAreaRouter);
app.use("/api/slider", sliderRouter);
app.use("/api/banner", bannerRouter);
app.use("/api/product-request", productRequestRouter);
app.use("/api/wishlist", wishlistRouter);
app.use("/api/compare", compareRouter);
app.use("/api/admin/auth", adminAuthRouter);
app.use("/api/admin/user", adminUserRouter);
app.use("/api/colors", colorRouter);
app.use("/api/suppliers", supplierRouter);
app.use("/api/purchase-orders", purchaseOrderRouter);
app.use("/api/stock", stockRouter);
app.use("/api/pricing", pricingRouter);
app.use("/api/exchange-rates", exchangeRateRouter);
app.use("/api/warehouse", warehouseRouter);
app.use("/api/shipping", shippingRouter);
app.use("/api/blog", blogRouter);
app.use("/api/direct-pricing", directPricingRouter);
app.use("/api/admin/customers", customerRouter);
app.use("/api/send-email", formEmailRouter);
app.use("/api/admin/orders", adminOrderRouter);
app.use("/api/order-requests", orderRequestRouter);
app.use("/api/coupons", couponRouter);
app.use("/api/btb-auth", orderRequestAuthRouter);
app.use("/api/invoices", invoiceRouter);

// ============================================
// Error handling middleware
// ============================================
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(err.status || 500).json({
    message: err.message || "Internal server error",
    error: true,
    success: false,
  });
});

// ===========================================
// Start server
// ============================================
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log("✅ Server is running on port:", PORT);
    console.log("✅ Database connected");
  });
});
