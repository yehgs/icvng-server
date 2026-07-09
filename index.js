// icvng-server/index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import helmet from "helmet";
import connectDB from "./config/connectDB.js";
// ── Phase 1: Multi-country ──────────────────────────────────────────────────
import countryDetect from "./middleware/countryDetect.js";
import countryContext from "./middleware/countryContext.js";
import { refreshCountryCache } from "./services/countryService.js";
import { auditRoutes } from "./core/routeAuditor.js";
import { paymentConfigMiddleware } from "./config/paymentRouter.js";
import countryRouter from "./route/country.route.js";
import translationRouter from "./route/translation.route.js";
import dashboardRouter from "./route/dashboard.route.js";
import seoRouter from "./route/seo.route.js";
// ── Phase 4: Google OAuth ─────────────────────────────────────────────────────
import googleAuthRouter from "./route/google-auth.route.js";
// ── Existing routers ────────────────────────────────────────────────────────
import userRouter from "./route/user.route.js";
import activityLogRouter from "./route/activity-log.route.js";
import categoryRouter from "./route/category.route.js";
import attributeRouter from "./route/attribute.route.js";
import tagRouter from "./route/tag.route.js";
import brandRouter from "./route/brand.route.js";
import compatibleRouter from "./route/compatible.route.js";
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
import fomoRouter from "./route/fomo.route.js";
import formEmailRouter from "./route/form-email.route.js";
import adminOrderRouter from "./route/admin-order.route.js";
import orderRequestRouter from "./route/order-request.route.js";
import couponRouter from "./route/coupon.route.js";
import orderRequestAuthRouter from "./route/order-request-auth.route.js";
import invoiceRouter from "./route/invoice.route.js";
import notificationRouter from "./route/notification.route.js";
import supportTicketRouter from "./route/support-ticket.route.js";
import passwordVaultRouter from "./route/password-vault.route.js";
import financeRouter from "./route/finance.route.js";
import crmRouter from "./route/crm.route.js";
import homeContentBlockRouter from "./route/homeContentBlock.route.js";
import scraperRouter from "./route/scraper.route.js";
import profileRouter from "./route/profile.route.js";

dotenv.config();

const app = express();

// Handle preflight OPTIONS for ALL routes before anything else
app.options("*", (req, res) => {
  const origin = req.headers.origin;
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,DELETE,PATCH,OPTIONS",
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type,Authorization,X-Requested-With,x-auth-token,token,x-access-token,x-csrf-token,x-storefront-host,x-country-code,x-language",
  );
  res.sendStatus(204);
});

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
      "x-storefront-host",
      "x-country-code",
      "x-language",
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
        process.env.REQUEST_FRONTEND_URL,
        process.env.ADMIN_FRONTEND_URL1,
        process.env.ADMIN_FRONTEND_URL2,
        // Client side — i-coffee.ng (the site the server also serves)
        "https://i-coffee.ng",
        "https://www.i-coffee.ng",
        // New country domains
        "https://i-coffee.tg",
        "https://www.i-coffee.tg",
        "https://i-coffee.bj",
        "https://www.i-coffee.bj",
        "https://i-coffee.it",
        "https://www.i-coffee.it",
        // Admin panels
        "https://app.i-coffee.ng",
        "https://app.i-coffee.tg",
        "https://app.i-coffee.bj",
        "https://app.i-coffee.it",
        // Vercel deployment URLs
        "https://icvng-client.vercel.app",
        "https://icvng-admin.vercel.app",
        "https://italiancoffeeng.vercel.app",
        // Local development
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:5176",
        "http://localhost:5177",
        "http://localhost:3000",
        "http://localhost:3001",
      ];

      // Filter out undefined/null env vars
      const validOrigins = allowedOrigins.filter(Boolean);

      if (!origin || validOrigins.includes(origin)) {
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

// ── Phase 1: Attach country context to EVERY request ────────────────────────
app.use(countryDetect);
// ── Phase 3: Establish AsyncLocalStorage request context so countryScoped
// model hooks can auto-filter. countryScope (route-level) mutates the scope
// inside this store once req.user is known.
app.use(countryContext);
app.use(paymentConfigMiddleware);
// ─────────────────────────────────────────────────────────────────────────────
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

const PORT = process.env.PORT || 8080; // PHASE 1 FIX: env var could never win

app.get("/", (request, response) => {
  ///server to client
  response.json({
    message: "Server is running " + PORT,
    payloadLimit: "50mb",
  });
});
app.use("/api/file", uploadRouter);
// ── Phase 1: Multi-country endpoints ─────────────────────────────────────────
app.use("/api/country", countryRouter);
app.use("/api/translations", translationRouter);
app.use("/api/admin/dashboard", dashboardRouter);
// SEO files served at root — must be before API routes
app.use("/", seoRouter);
app.use("/api/seo", seoRouter);
// ── Phase 4: Google OAuth ─────────────────────────────────────────────────────
app.use("/api/auth/google", googleAuthRouter);
// ─────────────────────────────────────────────────────────────────────────────
app.use("/api/user", userRouter);
app.use("/api/category", categoryRouter);
app.use("/api/subcategory", subCategoryRouter);
app.use("/api/product", productRouter);
app.use("/api/tag", tagRouter);
app.use("/api/brand", brandRouter);
app.use("/api/compatible", compatibleRouter);
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
app.use("/api/fomo", fomoRouter);
app.use("/api/home-content", homeContentBlockRouter);
app.use("/api/send-email", formEmailRouter);
app.use("/api/admin/orders", adminOrderRouter);
app.use("/api/order-requests", orderRequestRouter);
app.use("/api/coupons", couponRouter);
app.use("/api/btb-auth", orderRequestAuthRouter);
app.use("/api/invoices", invoiceRouter);
app.use("/api/activity-logs", activityLogRouter);
app.use("/api/admin/notifications", notificationRouter);
app.use("/api/admin/support-tickets", supportTicketRouter);
app.use("/api/admin/password-vault", passwordVaultRouter);
app.use("/api/admin/finance", financeRouter);
app.use("/api/admin/crm", crmRouter);
app.use("/api/admin/scraper", scraperRouter);
app.use("/api/admin/profile", profileRouter);

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
  // PHASE 4: fail-fast (or warn) if any admin/HQ route lacks a guard.
  try {
    auditRoutes(app, ["auth", "adminAuth", "requireRole", "requirePermission"]);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  // PHASE 3: warm the country cache from DB (falls back to config if unseeded)
  refreshCountryCache().catch((e) =>
    console.warn("Country cache warm failed (using config fallback):", e.message),
  );
  app.listen(PORT, () => {
    console.log("✅ Server is running on port:", PORT);
    console.log("✅ Database connected");
  });
});
