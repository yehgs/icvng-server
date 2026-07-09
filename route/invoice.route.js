// route/invoice.route.js
// PHASE 1 FIX: requireRole reads req.user, which only the auth middleware
// sets. Without auth first, every invoice endpoint returned 401
// unconditionally. auth + adminAuth now run before the role check.
import express from "express";
import auth from "../middleware/auth.js";
import adminAuth from "../middleware/adminAuth.js";
import { requireRole } from "../middleware/roleAuth.js";
import {
  generateInvoice,
  uploadInvoice,
  emailInvoice,
} from "../controllers/invoice.controller.js";
import multer from "multer";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(auth, adminAuth);

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
