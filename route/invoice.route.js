// route/invoice.route.js
import express from "express";
import { requireRole } from "../middleware/roleAuth.js";
import {
  generateInvoice,
  uploadInvoice,
  emailInvoice,
} from "../controllers/invoice.controller.js";
import multer from "multer";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Generate invoice number
router.post(
  "/generate/:orderId",
  requireRole(["SALES", "MANAGER", "DIRECTOR", "ACCOUNTANT"]),
  generateInvoice,
);

// Upload invoice PDF
router.post(
  "/upload/:orderId",
  requireRole(["SALES", "MANAGER", "DIRECTOR", "ACCOUNTANT"]),
  upload.single("invoice"),
  uploadInvoice,
);

// Email invoice
router.post(
  "/email/:orderId",
  requireRole(["SALES", "MANAGER", "DIRECTOR", "ACCOUNTANT"]),
  emailInvoice,
);

export default router;
