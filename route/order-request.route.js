// route/order-request.route.js - FIXED
import { Router } from "express";
import {
  createOrderRequest,
  calculateOrderShipping,
  getCustomerOrderRequests,
  getCustomerOrderRequestById,
  cancelOrderRequest,
  getAllOrderRequests,
  getOrderRequestById,
  assignOrderRequest,
  updateOrderStatus,
  processOrderRequest,
  markProductAsBTB,
  getOrderStatistics,
} from "../controllers/requestOrder.controller.js";
import auth from "../middleware/auth.js";
import { requireRole } from "../middleware/roleAuth.js";

const orderRequestRouter = Router();

// Customer routes
orderRequestRouter.post("/create", auth, createOrderRequest);
orderRequestRouter.post("/calculate-shipping", auth, calculateOrderShipping);
orderRequestRouter.get("/my-orders", auth, getCustomerOrderRequests);
orderRequestRouter.get(
  "/my-orders/:orderId",
  auth,
  getCustomerOrderRequestById,
);
orderRequestRouter.patch("/cancel/:orderId", auth, cancelOrderRequest);

// Admin/Sales routes - ADD auth MIDDLEWARE FIRST
orderRequestRouter.get(
  "/all",
  auth, // Add this
  requireRole(["SALES", "MANAGER", "IT", "DIRECTOR"]),
  getAllOrderRequests,
);

orderRequestRouter.get(
  "/stats",
  auth, // Add this
  requireRole(["SALES", "MANAGER", "IT", "DIRECTOR"]),
  getOrderStatistics,
);

orderRequestRouter.get(
  "/:orderId",
  auth, // Add this
  requireRole(["SALES", "MANAGER", "IT", "DIRECTOR"]),
  getOrderRequestById,
);

orderRequestRouter.patch(
  "/assign/:orderId",
  auth, // Add this
  requireRole(["MANAGER", "IT", "DIRECTOR"]),
  assignOrderRequest,
);

orderRequestRouter.patch(
  "/status/:orderId",
  auth, // Add this
  requireRole(["SALES", "MANAGER", "IT"]),
  updateOrderStatus,
);

orderRequestRouter.patch(
  "/process/:orderId",
  auth, // Add this
  requireRole(["SALES", "MANAGER", "IT"]),
  processOrderRequest,
);

orderRequestRouter.patch(
  "/product-btb/:productId",
  auth, // Add this
  requireRole(["SALES", "MANAGER", "IT"]),
  markProductAsBTB,
);

export default orderRequestRouter;
