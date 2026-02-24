// controllers/warehouse.controller.js - ENHANCED VERSION
import ProductModel from "../models/product.model.js";
import StockModel from "../models/stock.model.js";
import UserModel from "../models/user.model.js";
import WarehouseActivityModel from "../models/warehouse-activity.model.js";
import mongoose from "mongoose";
import PDFDocument from "pdfkit";
import csv from "csv-parser";
import { Readable } from "stream";
import { transporter } from "../utils/nodemailer.js";
import SupplierModel from "../models/supplier.model.js";

// System settings with persistence
let systemSettings = {
  enabled: true,
  autoSyncEnabled: true,
  lowStockThreshold: 10,
  criticalStockThreshold: 5,
  notificationEmails: [
    process.env.WAREHOUSE_ADMIN_EMAIL || "shipment2@yehgs.co.uk",
    process.env.DIRECTOR_EMAIL || "md@yehgs.co.uk",
  ],
};

// ==========================================
// EMAIL NOTIFICATION
// ==========================================
const sendImportNotificationEmail = async (emails, results, user) => {
  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD) {
      console.error(
        "❌ EMAIL CONFIGURATION ERROR: EMAIL_USER or EMAIL_APP_PASSWORD not set in .env file",
      );
      throw new Error("Email configuration missing. Please check .env file.");
    }

    if (!emails || emails.length === 0) {
      console.error("❌ EMAIL ERROR: No recipients provided");
      throw new Error("No email recipients provided");
    }

    console.log("📧 Preparing to send import notification email...");
    console.log("📧 Recipients:", emails.join(", "));
    console.log("📧 From:", process.env.EMAIL_USER);

    const emailBody = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 900px; margin: 0 auto; padding: 20px; }
    .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; }
    .summary { background-color: #f5f5f5; padding: 15px; margin: 20px 0; border-radius: 5px; }
    .new-suppliers { background-color: #d1ecf1; padding: 10px; margin: 10px 0; border-left: 4px solid #17a2b8; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
    th { background-color: #4CAF50; color: white; }
    tr:nth-child(even) { background-color: #f2f2f2; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 3px; font-size: 11px; font-weight: bold; }
    .badge-new { background-color: #17a2b8; color: white; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📦 Warehouse Stock Import Report</h1>
    </div>
    <div class="summary">
      <h2>Import Summary</h2>
      <p><strong>Import Date:</strong> ${results.timestamp.toLocaleString()}</p>
      <p><strong>Imported By:</strong> ${user.name} (${user.email})</p>
      <p><strong>Total Products Processed:</strong> ${results.totalProcessed}</p>
      <p><strong>✅ Successful Updates:</strong> ${results.successful.length}</p>
      <p><strong>❌ Failed Updates:</strong> ${results.failed.length}</p>
      ${results.newSuppliersCreated.length > 0 ? `<p><strong>🆕 New Suppliers Created:</strong> ${results.newSuppliersCreated.length}</p>` : ""}
    </div>

    ${
      results.newSuppliersCreated.length > 0
        ? `
    <div class="new-suppliers">
      <h3>🆕 New Suppliers Created</h3>
      <ul>
        ${results.newSuppliersCreated.map((supplier) => `<li><strong>${supplier.name}</strong> (slug: ${supplier.slug})</li>`).join("")}
      </ul>
    </div>
    `
        : ""
    }

    ${
      results.successful.length > 0
        ? `
    <h3>✅ Successfully Updated Products</h3>
    <table>
      <thead>
        <tr><th>SKU</th><th>Product Name</th><th>Supplier</th><th>Changes</th></tr>
      </thead>
      <tbody>
        ${results.successful
          .map(
            (item) => `
          <tr>
            <td>${item.sku}</td>
            <td>${item.productName}</td>
            <td>${item.supplier || "N/A"}${item.updates.supplier ? '<span class="badge badge-new">NEW</span>' : ""}</td>
            <td style="font-size: 11px;">${Object.keys(item.updates)
              .map(
                (key) =>
                  `<strong>${key}:</strong> ${item.updates[key].from} → ${item.updates[key].to}`,
              )
              .join("<br>")}</td>
          </tr>
        `,
          )
          .join("")}
      </tbody>
    </table>
    `
        : ""
    }

    ${
      results.failed.length > 0
        ? `
    <h3>❌ Failed Updates</h3>
    <table>
      <thead>
        <tr><th>SKU</th><th>Product Name</th><th>Reason</th></tr>
      </thead>
      <tbody>
        ${results.failed
          .map(
            (item) => `
          <tr>
            <td>${item.sku}</td>
            <td>${item.productName || "N/A"}</td>
            <td>${item.reason}</td>
          </tr>
        `,
          )
          .join("")}
      </tbody>
    </table>
    `
        : ""
    }

    <div class="footer">
      <p>This is an automated notification from the Warehouse Management System.</p>
      <p><strong>Note:</strong> New suppliers are automatically created with slugs generated from their names.</p>
      <p>© ${new Date().getFullYear()} I-Coffee Nigeria</p>
    </div>
  </div>
</body>
</html>
    `;

    console.log("📧 Sending email...");
    const info = await transporter.sendMail({
      from: `"I-Coffee Warehouse" <${process.env.EMAIL_USER}>`,
      to: emails.join(", "),
      subject: `Warehouse Stock Import Report - ${results.successful.length} Updates${results.newSuppliersCreated.length > 0 ? `, ${results.newSuppliersCreated.length} New Suppliers` : ""}`,
      html: emailBody,
    });

    console.log("✅ Import notification email sent successfully");
    console.log("📧 Message ID:", info.messageId);
    return info;
  } catch (error) {
    console.error("❌ ERROR sending import notification email:", error);
    console.error(
      "⚠️  EMAIL SENDING FAILED - Import completed but notification not sent",
    );
  }
};

// ==========================================
// VALIDATION FUNCTIONS
// ==========================================

// FIXED: Simplified validation - Stock on Arrival, Supplier, Packaging have NO effect on validation
const validateStockUpdate = (data) => {
  const errors = [];

  // Parse all values to numbers to avoid string comparison issues
  const stockInHouse = parseFloat(data.stockInHouse) || 0;
  const damagedQty = parseFloat(data.damagedQty) || 0;
  const expiredQty = parseFloat(data.expiredQty) || 0;
  const refurbishedQty = parseFloat(data.refurbishedQty) || 0;
  const finalStock = parseFloat(data.finalStock) || 0;
  const onlineStock = parseFloat(data.onlineStock) || 0;
  const offlineStock = parseFloat(data.offlineStock) || 0;

  // Rule 1: All quantities must be non-negative
  const quantities = [
    { name: "Stock In House", value: stockInHouse },
    { name: "Damaged Qty", value: damagedQty },
    { name: "Expired Qty", value: expiredQty },
    { name: "Refurbished Qty", value: refurbishedQty },
    { name: "Final Stock", value: finalStock },
    { name: "Online Stock", value: onlineStock },
    { name: "Offline Stock", value: offlineStock },
  ];

  quantities.forEach(({ name, value }) => {
    if (value < 0) {
      errors.push(`${name} cannot be negative`);
    }
  });

  // Rule 2: Final Stock cannot exceed Stock In House
  if (finalStock > stockInHouse) {
    errors.push(
      `Final Stock (${finalStock}) cannot exceed Stock In House (${stockInHouse})`,
    );
  }

  // Rule 3: Online + Offline cannot exceed Final Stock
  if (onlineStock + offlineStock > finalStock) {
    errors.push(
      `Online Stock (${onlineStock}) + Offline Stock (${offlineStock}) = ${onlineStock + offlineStock} exceeds Final Stock (${finalStock})`,
    );
  }

  // Rule 4: Stock In House must equal Damaged + Expired + Refurbished + Final Stock
  // Use Math.round to avoid floating point precision issues (e.g. 12.000000001 !== 12)
  const calculatedStockInHouse =
    damagedQty + expiredQty + refurbishedQty + finalStock;
  if (
    Math.round(stockInHouse * 100) !== Math.round(calculatedStockInHouse * 100)
  ) {
    errors.push(
      `Stock In House (${stockInHouse}) must equal Damaged (${damagedQty}) + Expired (${expiredQty}) + Refurbished (${refurbishedQty}) + Final Stock (${finalStock}) = ${calculatedStockInHouse}`,
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

// Legacy validation (used only for CSV import compatibility check)
const validateStockData = (data) => {
  return validateStockUpdate(data);
};

// ==========================================
// ACTIVITY LOGGING
// ==========================================
const logActivity = async (
  user,
  action,
  target,
  changes = null,
  notes = "",
  metadata = {},
) => {
  try {
    const activity = new WarehouseActivityModel({
      user: user._id,
      action,
      target: {
        type: target.type,
        id: target.id || null,
        name: target.name || "",
        sku: target.sku || "",
      },
      changes: changes ? new Map(Object.entries(changes)) : null,
      notes,
      metadata: {
        ip: metadata.ip || "",
        userAgent: metadata.userAgent || "",
        sessionId: metadata.sessionId || "",
      },
    });
    await activity.save();
    return activity;
  } catch (error) {
    console.error("Error logging activity:", error);
  }
};

// ==========================================
// STOCK SYNC HELPERS
// ==========================================
const syncStockFromStockModel = async (productId) => {
  try {
    const stockBatches = await StockModel.find({
      product: productId,
      status: { $in: ["AVAILABLE", "PARTIALLY_ALLOCATED", "RECEIVED"] },
    });

    const totals = stockBatches.reduce(
      (acc, batch) => {
        acc.stockOnArrival += batch.originalQuantity || 0;
        acc.goodQuantity += batch.goodQuantity || 0;
        acc.refurbishedQuantity += batch.refurbishedQuantity || 0;
        acc.damagedQuantity += batch.damagedQuantity || 0;
        acc.expiredQuantity += 0;
        acc.onlineStock += batch.onlineStock || 0;
        acc.offlineStock += batch.offlineStock || 0;
        return acc;
      },
      {
        stockOnArrival: 0,
        goodQuantity: 0,
        refurbishedQuantity: 0,
        damagedQuantity: 0,
        expiredQuantity: 0,
        onlineStock: 0,
        offlineStock: 0,
      },
    );

    const finalStock = totals.goodQuantity + totals.refurbishedQuantity;

    return {
      stockOnArrival: totals.stockOnArrival,
      stockInHouse:
        totals.goodQuantity +
        totals.refurbishedQuantity +
        totals.damagedQuantity,
      damagedQty: totals.damagedQuantity,
      expiredQty: totals.expiredQuantity,
      refurbishedQty: totals.refurbishedQuantity,
      finalStock,
      onlineStock: totals.onlineStock,
      offlineStock: totals.offlineStock,
      source: "STOCK_BATCHES",
      lastUpdated: new Date(),
    };
  } catch (error) {
    console.error("Error syncing stock from Stock model:", error);
    return null;
  }
};

const getEffectiveStock = async (product) => {
  if (product.warehouseStock?.enabled) {
    return {
      stockOnArrival: product.warehouseStock.stockOnArrival || 0,
      stockInHouse: product.warehouseStock.stockInHouse || 0,
      damagedQty: product.warehouseStock.damagedQty || 0,
      expiredQty: product.warehouseStock.expiredQty || 0,
      refurbishedQty: product.warehouseStock.refurbishedQty || 0,
      finalStock: product.warehouseStock.finalStock || 0,
      onlineStock: product.warehouseStock.onlineStock || 0,
      offlineStock: product.warehouseStock.offlineStock || 0,
      packaging: product.warehouseStock.packaging || product.packaging || "",
      unit: product.warehouseStock.unit || product.unit || "",
      notes: product.warehouseStock.notes || "",
      lastUpdated: product.warehouseStock.lastUpdated,
      source: "WAREHOUSE_MANUAL",
      isManualOverride: true,
    };
  } else {
    const stockTotals = await syncStockFromStockModel(product._id);
    if (stockTotals) {
      return {
        ...stockTotals,
        packaging: product.packaging || "",
        unit: product.unit || "",
      };
    } else {
      return {
        stockOnArrival: product.stock || 0,
        stockInHouse: product.stock || 0,
        damagedQty: 0,
        expiredQty: 0,
        refurbishedQty: 0,
        finalStock: product.stock || 0,
        onlineStock: 0,
        offlineStock: 0,
        packaging: product.packaging || "",
        unit: product.unit || "",
        notes: "Default product stock",
        lastUpdated: product.updatedAt,
        source: "PRODUCT_DEFAULT",
        isManualOverride: false,
      };
    }
  }
};

// ==========================================
// SUPPLIER HELPERS
// ==========================================
const generateSupplierSlug = (name) => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
};

const findOrCreateSupplier = async (supplierName) => {
  if (!supplierName || supplierName.trim() === "") {
    return null;
  }

  const trimmedName = supplierName.trim();

  let supplier = await SupplierModel.findOne({
    name: { $regex: new RegExp(`^${trimmedName}$`, "i") },
  });

  if (supplier) {
    const expectedSlug = generateSupplierSlug(trimmedName);
    if (!supplier.slug || supplier.slug !== expectedSlug) {
      supplier.slug = expectedSlug;
      await supplier.save();
    }
    return supplier._id;
  }

  const newSupplier = new SupplierModel({
    name: trimmedName,
    slug: generateSupplierSlug(trimmedName),
    status: "INACTIVE",
  });

  await newSupplier.save();
  return newSupplier._id;
};

// ==========================================
// EXPORTED CONTROLLERS
// ==========================================

export const updateWeight = async (request, response) => {
  try {
    const { productId, weight } = request.body;

    const userRole = request.user.subRole || request.user.role;
    if (userRole !== "WAREHOUSE") {
      return response.status(403).json({
        message: "Only warehouse staff can update product weight",
        error: true,
        success: false,
      });
    }

    if (!productId) {
      return response.status(400).json({
        message: "Product ID is required",
        error: true,
        success: false,
      });
    }

    if (weight < 0) {
      return response.status(400).json({
        message: "Weight cannot be negative",
        error: true,
        success: false,
      });
    }

    const currentProduct = await ProductModel.findById(productId);
    if (!currentProduct) {
      return response.status(404).json({
        message: "Product not found",
        error: true,
        success: false,
      });
    }

    const changes = {};
    if (currentProduct.weight !== weight) {
      changes.weight = { from: currentProduct.weight || 0, to: weight };
    }

    const updatedProduct = await ProductModel.findByIdAndUpdate(
      productId,
      { weight, updatedBy: request.user._id },
      { new: true, runValidators: true },
    ).populate("category brand compatibleSystem", "name");

    await logActivity(
      request.user,
      "WEIGHT_UPDATE",
      {
        type: "PRODUCT",
        id: productId,
        name: updatedProduct.name,
        sku: updatedProduct.sku,
      },
      changes,
      "Product weight updated",
      { ip: request.ip, userAgent: request.headers["user-agent"] },
    );

    return response.json({
      message: "Product weight updated successfully",
      data: updatedProduct,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Update weight error:", error);
    return response.status(500).json({
      message: error.message || "Failed to update product weight",
      error: true,
      success: false,
    });
  }
};

export const getActivityLog = async (request, response) => {
  try {
    const {
      page = 1,
      limit = 50,
      dateRange,
      action,
      userId,
      sortOrder = "desc",
    } = request.query;

    const query = {};

    if (dateRange && dateRange !== "all") {
      const daysAgo = parseInt(dateRange);
      const cutoffDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
      query.createdAt = { $gte: cutoffDate };
    }

    if (action) query.action = action;
    if (userId) query.user = userId;

    const skip = (page - 1) * limit;
    const sort = { createdAt: sortOrder === "asc" ? 1 : -1 };

    const [activities, totalCount] = await Promise.all([
      WarehouseActivityModel.find(query)
        .populate("user", "name email subRole role avatar")
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      WarehouseActivityModel.countDocuments(query),
    ]);

    const formattedActivities = activities.map((activity) => ({
      id: activity._id,
      timestamp: activity.createdAt,
      user: {
        id: activity.user._id,
        name: activity.user.name,
        email: activity.user.email,
        role: activity.user.subRole || activity.user.role,
        avatar: activity.user.avatar,
      },
      action: activity.action,
      target: activity.target,
      changes: activity.changes ? Object.fromEntries(activity.changes) : null,
      notes: activity.notes,
      metadata: activity.metadata,
    }));

    return response.json({
      message: "Activity log retrieved successfully",
      data: formattedActivities,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: parseInt(page),
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Get activity log error:", error);
    return response.status(500).json({
      message: error.message || "Failed to retrieve activity log",
      error: true,
      success: false,
    });
  }
};

export const enableSystem = async (request, response) => {
  try {
    const userRole = request.user.subRole || request.user.role;
    if (!["DIRECTOR", "IT"].includes(userRole)) {
      return response.status(403).json({
        message: "Only Director or IT can enable the warehouse system",
        error: true,
        success: false,
      });
    }

    systemSettings.enabled = true;

    await logActivity(
      request.user,
      "SYSTEM_ENABLED",
      { type: "SYSTEM", name: "Warehouse Stock Management" },
      null,
      "Enabled manual stock management for warehouse team",
      { ip: request.ip, userAgent: request.headers["user-agent"] },
    );

    return response.json({
      message: "Warehouse system enabled successfully",
      data: { enabled: true },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Enable system error:", error);
    return response.status(500).json({
      message: error.message || "Failed to enable system",
      error: true,
      success: false,
    });
  }
};

export const disableSystem = async (request, response) => {
  try {
    const userRole = request.user.subRole || request.user.role;
    if (!["DIRECTOR", "IT"].includes(userRole)) {
      return response.status(403).json({
        message: "Only Director or IT can disable the warehouse system",
        error: true,
        success: false,
      });
    }

    systemSettings.enabled = false;

    await logActivity(
      request.user,
      "SYSTEM_DISABLED",
      { type: "SYSTEM", name: "Warehouse Stock Management" },
      null,
      "Disabled manual stock management",
      { ip: request.ip, userAgent: request.headers["user-agent"] },
    );

    return response.json({
      message: "Warehouse system disabled successfully",
      data: { enabled: false },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Disable system error:", error);
    return response.status(500).json({
      message: error.message || "Failed to disable system",
      error: true,
      success: false,
    });
  }
};

export const disableWarehouseOverride = async (request, response) => {
  try {
    const { productId } = request.params;

    const userRole = request.user.subRole || request.user.role;
    if (!["DIRECTOR", "IT", "WAREHOUSE"].includes(userRole)) {
      return response.status(403).json({
        message: "Insufficient permissions",
        error: true,
        success: false,
      });
    }

    const product = await ProductModel.findById(productId);
    if (!product) {
      return response.status(404).json({
        message: "Product not found",
        error: true,
        success: false,
      });
    }

    const stockTotals = await syncStockFromStockModel(productId);
    const newStock = stockTotals ? stockTotals.finalStock : product.stock || 0;

    const updatedProduct = await ProductModel.findByIdAndUpdate(
      productId,
      {
        "warehouseStock.enabled": false,
        stock: newStock,
        stockSource: stockTotals ? "STOCK_BATCHES" : "PRODUCT_DEFAULT",
        updatedBy: request.user._id,
      },
      { new: true, runValidators: true },
    );

    await logActivity(
      request.user,
      "WAREHOUSE_OVERRIDE_DISABLED",
      {
        type: "PRODUCT",
        id: productId,
        name: updatedProduct.name,
        sku: updatedProduct.sku,
      },
      null,
      "Warehouse manual override disabled, synced from stock batches",
      { ip: request.ip, userAgent: request.headers["user-agent"] },
    );

    return response.json({
      message: "Warehouse override disabled, stock synced from batches",
      data: updatedProduct,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Disable warehouse override error:", error);
    return response.status(500).json({
      message: error.message || "Failed to disable warehouse override",
      error: true,
      success: false,
    });
  }
};

export const syncAllFromStockModel = async (request, response) => {
  try {
    const userRole = request.user.subRole || request.user.role;
    if (!["DIRECTOR", "IT"].includes(userRole)) {
      return response.status(403).json({
        message: "Only Director or IT can perform bulk sync",
        error: true,
        success: false,
      });
    }

    const products = await ProductModel.find({
      $or: [
        { "warehouseStock.enabled": { $ne: true } },
        { warehouseStock: { $exists: false } },
      ],
    });

    let syncedCount = 0;
    let errorCount = 0;

    for (const product of products) {
      try {
        const stockTotals = await syncStockFromStockModel(product._id);
        if (stockTotals) {
          await ProductModel.findByIdAndUpdate(product._id, {
            stock: stockTotals.finalStock,
            stockSource: "STOCK_BATCHES",
            updatedBy: request.user._id,
          });
          syncedCount++;
        }
      } catch (error) {
        console.error(`Error syncing product ${product._id}:`, error);
        errorCount++;
      }
    }

    await logActivity(
      request.user,
      "BULK_STOCK_SYNC",
      { type: "SYSTEM", name: "Stock Synchronization" },
      null,
      `Synced ${syncedCount} products, ${errorCount} errors`,
      { ip: request.ip, userAgent: request.headers["user-agent"] },
    );

    return response.json({
      message: "Bulk stock sync completed",
      data: { totalProducts: products.length, syncedCount, errorCount },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Bulk sync error:", error);
    return response.status(500).json({
      message: error.message || "Failed to perform bulk sync",
      error: true,
      success: false,
    });
  }
};

export const getStockSummary = async (request, response) => {
  try {
    const products = await ProductModel.find({}).lean();

    let stats = {
      totalProducts: 0,
      totalStock: 0,
      onlineStock: 0,
      offlineStock: 0,
      lowStockItems: 0,
      outOfStockItems: 0,
      damagedItems: 0,
      refurbishedItems: 0,
      expiredItems: 0,
      manualOverrideCount: 0,
      stockBatchCount: 0,
    };

    for (const product of products) {
      const effectiveStock = await getEffectiveStock(product);

      stats.totalProducts += 1;
      stats.totalStock += effectiveStock.finalStock;
      stats.onlineStock += effectiveStock.onlineStock;
      stats.offlineStock += effectiveStock.offlineStock;
      stats.damagedItems += effectiveStock.damagedQty;
      stats.refurbishedItems += effectiveStock.refurbishedQty;
      stats.expiredItems += effectiveStock.expiredQty;

      if (effectiveStock.source === "WAREHOUSE_MANUAL") {
        stats.manualOverrideCount += 1;
      } else if (effectiveStock.source === "STOCK_BATCHES") {
        stats.stockBatchCount += 1;
      }

      const finalStock = effectiveStock.finalStock;
      if (finalStock === 0) {
        stats.outOfStockItems += 1;
      } else if (finalStock <= systemSettings.lowStockThreshold) {
        stats.lowStockItems += 1;
      }
    }

    return response.json({
      message: "Stock summary retrieved successfully",
      data: stats,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Get stock summary error:", error);
    return response.status(500).json({
      message: error.message || "Failed to retrieve stock summary",
      error: true,
      success: false,
    });
  }
};

export const getSystemStatus = async (request, response) => {
  try {
    return response.json({
      message: "System status retrieved successfully",
      data: { enabled: systemSettings.enabled, settings: systemSettings },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Get system status error:", error);
    return response.status(500).json({
      message: error.message || "Failed to retrieve system status",
      error: true,
      success: false,
    });
  }
};

export const updateSystemSettings = async (request, response) => {
  try {
    const userRole = request.user.subRole || request.user.role;
    if (!["DIRECTOR", "IT"].includes(userRole)) {
      return response.status(403).json({
        message: "Only Director or IT can update system settings",
        error: true,
        success: false,
      });
    }

    const { autoSyncEnabled, lowStockThreshold, criticalStockThreshold } =
      request.body;
    const changes = {};

    if (
      autoSyncEnabled !== undefined &&
      autoSyncEnabled !== systemSettings.autoSyncEnabled
    ) {
      changes.autoSyncEnabled = {
        from: systemSettings.autoSyncEnabled,
        to: autoSyncEnabled,
      };
      systemSettings.autoSyncEnabled = autoSyncEnabled;
    }

    if (
      lowStockThreshold !== undefined &&
      lowStockThreshold !== systemSettings.lowStockThreshold
    ) {
      if (lowStockThreshold < 1 || lowStockThreshold > 100) {
        return response.status(400).json({
          message: "Low stock threshold must be between 1 and 100",
          error: true,
          success: false,
        });
      }
      changes.lowStockThreshold = {
        from: systemSettings.lowStockThreshold,
        to: lowStockThreshold,
      };
      systemSettings.lowStockThreshold = lowStockThreshold;
    }

    if (
      criticalStockThreshold !== undefined &&
      criticalStockThreshold !== systemSettings.criticalStockThreshold
    ) {
      if (
        criticalStockThreshold < 1 ||
        criticalStockThreshold > systemSettings.lowStockThreshold
      ) {
        return response.status(400).json({
          message:
            "Critical stock threshold must be between 1 and low stock threshold",
          error: true,
          success: false,
        });
      }
      changes.criticalStockThreshold = {
        from: systemSettings.criticalStockThreshold,
        to: criticalStockThreshold,
      };
      systemSettings.criticalStockThreshold = criticalStockThreshold;
    }

    if (Object.keys(changes).length > 0) {
      await logActivity(
        request.user,
        "SETTINGS_UPDATE",
        { type: "SYSTEM", name: "System Settings" },
        changes,
        "System settings updated",
        { ip: request.ip, userAgent: request.headers["user-agent"] },
      );
    }

    return response.json({
      message: "System settings updated successfully",
      data: systemSettings,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Update system settings error:", error);
    return response.status(500).json({
      message: error.message || "Failed to update system settings",
      error: true,
      success: false,
    });
  }
};

export const getSystemSettings = async (request, response) => {
  try {
    return response.json({
      message: "System settings retrieved successfully",
      data: systemSettings,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Get system settings error:", error);
    return response.status(500).json({
      message: error.message || "Failed to retrieve system settings",
      error: true,
      success: false,
    });
  }
};

export const getLowStockAlerts = async (request, response) => {
  try {
    const products = await ProductModel.find({})
      .populate("category brand", "name")
      .lean();

    const lowStock = [];
    const criticalStock = [];
    const outOfStock = [];

    for (const product of products) {
      const effectiveStock = await getEffectiveStock(product);
      const stock = effectiveStock.finalStock;
      const productData = {
        ...product,
        effectiveStock: stock,
        warehouseStock: effectiveStock,
      };

      if (stock === 0) {
        outOfStock.push(productData);
      } else if (stock <= systemSettings.criticalStockThreshold) {
        criticalStock.push(productData);
      } else if (stock <= systemSettings.lowStockThreshold) {
        lowStock.push(productData);
      }
    }

    return response.json({
      message: "Stock alerts retrieved successfully",
      data: {
        lowStock,
        criticalStock,
        outOfStock,
        thresholds: {
          low: systemSettings.lowStockThreshold,
          critical: systemSettings.criticalStockThreshold,
        },
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Get low stock alerts error:", error);
    return response.status(500).json({
      message: error.message || "Failed to retrieve stock alerts",
      error: true,
      success: false,
    });
  }
};

export const bulkUpdateStock = async (request, response) => {
  try {
    if (!systemSettings.enabled) {
      return response.status(403).json({
        message: "Warehouse stock system is disabled",
        error: true,
        success: false,
      });
    }

    const userRole = request.user.subRole || request.user.role;
    if (userRole !== "WAREHOUSE") {
      return response.status(403).json({
        message: "Only warehouse staff can update stock quantities",
        error: true,
        success: false,
      });
    }

    const { updates } = request.body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return response.status(400).json({
        message: "Updates array is required",
        error: true,
        success: false,
      });
    }

    const results = [];
    const errors = [];

    for (const update of updates) {
      try {
        const product = await ProductModel.findById(update.productId);
        if (!product) {
          errors.push(`Product not found: ${update.productId}`);
          continue;
        }

        await ProductModel.findByIdAndUpdate(
          update.productId,
          {
            "warehouseStock.enabled": true,
            "warehouseStock.stockOnArrival": update.stockOnArrival,
            "warehouseStock.damagedQty": update.damagedQty,
            "warehouseStock.expiredQty": update.expiredQty,
            "warehouseStock.refurbishedQty": update.refurbishedQty,
            "warehouseStock.finalStock": update.finalStock,
            "warehouseStock.onlineStock": update.onlineStock,
            "warehouseStock.offlineStock": update.offlineStock,
            "warehouseStock.notes": update.notes,
            "warehouseStock.lastUpdated": new Date(),
            "warehouseStock.updatedBy": request.user._id,
            stock: update.finalStock,
            stockSource: "WAREHOUSE_MANUAL",
            updatedBy: request.user._id,
          },
          { new: true, runValidators: true },
        );

        results.push({ productId: update.productId, success: true });

        await logActivity(
          request.user,
          "BULK_STOCK_UPDATE",
          {
            type: "PRODUCT",
            id: update.productId,
            name: product.name,
            sku: product.sku,
          },
          null,
          `Bulk update: ${update.notes || "No notes"}`,
          { ip: request.ip, userAgent: request.headers["user-agent"] },
        );
      } catch (error) {
        errors.push(`Error updating ${update.productId}: ${error.message}`);
        results.push({
          productId: update.productId,
          success: false,
          error: error.message,
        });
      }
    }

    return response.json({
      message: "Bulk update completed",
      data: {
        successful: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        results,
        errors,
      },
      error: errors.length > 0,
      success: true,
    });
  } catch (error) {
    console.error("Bulk update stock error:", error);
    return response.status(500).json({
      message: error.message || "Failed to perform bulk update",
      error: true,
      success: false,
    });
  }
};

export const reconcileStock = async (request, response) => {
  try {
    const { productId, actualCount } = request.body;

    if (!productId || actualCount === undefined) {
      return response.status(400).json({
        message: "Product ID and actual count are required",
        error: true,
        success: false,
      });
    }

    const product = await ProductModel.findById(productId);
    if (!product) {
      return response.status(404).json({
        message: "Product not found",
        error: true,
        success: false,
      });
    }

    const effectiveStock = await getEffectiveStock(product);
    const currentStock = effectiveStock.finalStock;
    const difference = actualCount - currentStock;

    await ProductModel.findByIdAndUpdate(productId, {
      "warehouseStock.enabled": true,
      "warehouseStock.finalStock": actualCount,
      "warehouseStock.lastUpdated": new Date(),
      "warehouseStock.updatedBy": request.user._id,
      stock: actualCount,
      stockSource: "WAREHOUSE_MANUAL",
      updatedBy: request.user._id,
    });

    await logActivity(
      request.user,
      "STOCK_RECONCILIATION",
      { type: "PRODUCT", id: productId, name: product.name, sku: product.sku },
      { finalStock: { from: currentStock, to: actualCount } },
      `Stock reconciliation: ${difference > 0 ? "+" : ""}${difference} units`,
      { ip: request.ip, userAgent: request.headers["user-agent"] },
    );

    return response.json({
      message: "Stock reconciled successfully",
      data: {
        productId,
        previousStock: currentStock,
        newStock: actualCount,
        difference,
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Reconcile stock error:", error);
    return response.status(500).json({
      message: error.message || "Failed to reconcile stock",
      error: true,
      success: false,
    });
  }
};

export const exportStockData = async (request, response) => {
  try {
    const { category, brand, productType, compatibleSystem } = request.query;
    const query = {};

    if (category) query.category = category;
    if (brand) query.brand = { $in: [brand] };
    if (productType) query.productType = productType;
    if (compatibleSystem) query.compatibleSystem = compatibleSystem;

    const products = await ProductModel.find(query)
      .populate("category brand compatibleSystem", "name")
      .sort({ name: 1 });

    const csvHeaders = [
      "Product Name",
      "SKU",
      "Category",
      "Brand",
      "Product Type",
      "Weight",
      "Stock on Arrival",
      "Damaged Qty",
      "Expired Qty",
      "Refurbished Qty",
      "Final Stock",
      "Online Stock",
      "Offline Stock",
      "Last Updated",
      "Notes",
    ];

    const csvRows = await Promise.all(
      products.map(async (product) => {
        const effectiveStock = await getEffectiveStock(product);
        return [
          product.name || "",
          product.sku || "",
          product.category?.name || "",
          product.brand?.map((b) => b.name).join(", ") || "",
          product.productType || "",
          product.weight || 0,
          effectiveStock.stockOnArrival || 0,
          effectiveStock.damagedQty || 0,
          effectiveStock.expiredQty || 0,
          effectiveStock.refurbishedQty || 0,
          effectiveStock.finalStock || 0,
          effectiveStock.onlineStock || 0,
          effectiveStock.offlineStock || 0,
          effectiveStock.lastUpdated
            ? new Date(effectiveStock.lastUpdated).toLocaleDateString()
            : "",
          effectiveStock.notes || "",
        ];
      }),
    );

    const csvContent = [csvHeaders, ...csvRows]
      .map((row) => row.map((field) => `"${field}"`).join(","))
      .join("\n");

    response.setHeader("Content-Type", "text/csv");
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="warehouse-stock-export.csv"',
    );
    return response.send(csvContent);
  } catch (error) {
    console.error("Export stock data error:", error);
    return response.status(500).json({
      message: error.message || "Failed to export stock data",
      error: true,
      success: false,
    });
  }
};

export const exportActivityLog = async (request, response) => {
  try {
    const { dateRange, action, userId } = request.query;
    const query = {};

    if (dateRange && dateRange !== "all") {
      const daysAgo = parseInt(dateRange);
      const cutoffDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
      query.createdAt = { $gte: cutoffDate };
    }

    if (action) query.action = action;
    if (userId) query.user = userId;

    const activities = await WarehouseActivityModel.find(query)
      .populate("user", "name email subRole role")
      .sort({ createdAt: -1 })
      .lean();

    const csvHeaders = [
      "Timestamp",
      "User",
      "Email",
      "Role",
      "Action",
      "Target Type",
      "Target Name",
      "Target SKU",
      "Changes",
      "Notes",
    ];

    const csvRows = activities.map((activity) => [
      new Date(activity.createdAt).toISOString(),
      activity.user.name,
      activity.user.email,
      activity.user.subRole || activity.user.role,
      activity.action,
      activity.target.type,
      activity.target.name,
      activity.target.sku || "",
      activity.changes
        ? JSON.stringify(Object.fromEntries(activity.changes))
        : "",
      activity.notes || "",
    ]);

    const csvContent = [csvHeaders, ...csvRows]
      .map((row) => row.map((field) => `"${field}"`).join(","))
      .join("\n");

    response.setHeader("Content-Type", "text/csv");
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="warehouse-activity-log.csv"',
    );
    return response.send(csvContent);
  } catch (error) {
    console.error("Export activity log error:", error);
    return response.status(500).json({
      message: error.message || "Failed to export activity log",
      error: true,
      success: false,
    });
  }
};

export const getWarehouseUsers = async (request, response) => {
  try {
    const users = await UserModel.find({
      $or: [
        { subRole: "WAREHOUSE" },
        { subRole: "DIRECTOR" },
        { subRole: "IT" },
        { subRole: "MANAGER" },
      ],
      status: "Active",
    })
      .select("_id name email subRole role avatar")
      .sort({ name: 1 })
      .lean();

    return response.json({
      message: "Warehouse users retrieved successfully",
      data: users,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Get warehouse users error:", error);
    return response.status(500).json({
      message: error.message || "Failed to retrieve warehouse users",
      error: true,
      success: false,
    });
  }
};

export const exportStockCSV = async (request, response) => {
  try {
    const {
      category,
      brand,
      productType,
      compatibleSystem,
      supplier,
      columns = "all",
    } = request.query;
    const query = {};

    if (category) query.category = category;
    if (brand) query.brand = { $in: [brand] };
    if (productType) query.productType = productType;
    if (compatibleSystem) query.compatibleSystem = compatibleSystem;
    if (supplier) query.supplier = supplier;

    const products = await ProductModel.find(query)
      .populate("category brand compatibleSystem supplier", "name slug")
      .sort({ name: 1 });

    const selectedColumns = columns.split(",");

    const headers = [
      "Product Name",
      "SKU",
      "Supplier",
      "Weight (kg)",
      "Unit",
      "Packaging",
      "Stock In House",
    ];

    if (columns === "all" || selectedColumns.includes("damaged"))
      headers.push("Damaged Qty");
    if (columns === "all" || selectedColumns.includes("expired"))
      headers.push("Expired Qty");
    if (columns === "all" || selectedColumns.includes("refurb"))
      headers.push("Refurbished Qty");
    if (columns === "all" || selectedColumns.includes("final"))
      headers.push("Final Stock");
    if (columns === "all" || selectedColumns.includes("online"))
      headers.push("Online Stock");
    if (columns === "all" || selectedColumns.includes("offline"))
      headers.push("Offline Stock");
    if (columns === "all")
      headers.push("Stock on Arrival", "Last Updated", "Notes");

    const csvData = products.map((product) => {
      const stock = product.warehouseStock?.enabled
        ? product.warehouseStock
        : {
            finalStock: product.stock || 0,
            stockInHouse: 0,
            stockOnArrival: 0,
            damagedQty: 0,
            expiredQty: 0,
            refurbishedQty: 0,
            onlineStock: 0,
            offlineStock: 0,
            notes: "",
          };

      const row = [
        product.name || "",
        product.sku || "",
        product.supplier?.name || "",
        product.weight || 0,
        product.unit || "",
        product.packaging || "",
        stock.stockInHouse || 0,
      ];

      if (columns === "all" || selectedColumns.includes("damaged"))
        row.push(stock.damagedQty || 0);
      if (columns === "all" || selectedColumns.includes("expired"))
        row.push(stock.expiredQty || 0);
      if (columns === "all" || selectedColumns.includes("refurb"))
        row.push(stock.refurbishedQty || 0);
      if (columns === "all" || selectedColumns.includes("final"))
        row.push(stock.finalStock || 0);
      if (columns === "all" || selectedColumns.includes("online"))
        row.push(stock.onlineStock || 0);
      if (columns === "all" || selectedColumns.includes("offline"))
        row.push(stock.offlineStock || 0);
      if (columns === "all") {
        row.push(
          stock.stockOnArrival || 0,
          stock.lastUpdated
            ? new Date(stock.lastUpdated).toLocaleDateString()
            : "",
          stock.notes || "",
        );
      }

      return row;
    });

    const csvContent = [headers, ...csvData]
      .map((row) => row.map((field) => `"${field}"`).join(","))
      .join("\n");

    response.setHeader("Content-Type", "text/csv");
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="warehouse-stock-export.csv"',
    );
    return response.send(csvContent);
  } catch (error) {
    console.error("Export CSV error:", error);
    return response.status(500).json({
      message: error.message || "Failed to export CSV",
      error: true,
      success: false,
    });
  }
};

export const exportStockPDF = async (request, response) => {
  let doc;

  try {
    const {
      category,
      brand,
      productType,
      compatibleSystem,
      supplier,
      columns = "all",
    } = request.query;
    const query = {};

    if (category) query.category = category;
    if (brand) query.brand = { $in: [brand] };
    if (productType) query.productType = productType;
    if (compatibleSystem) query.compatibleSystem = compatibleSystem;
    if (supplier) query.supplier = supplier;

    const products = await ProductModel.find(query)
      .populate("category brand compatibleSystem supplier", "name slug")
      .sort({ name: 1 })
      .limit(500);

    if (products.length === 0) {
      return response.status(404).json({
        message: "No products found to export",
        error: true,
        success: false,
      });
    }

    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}h${String(now.getMinutes()).padStart(2, "0")}m${String(now.getSeconds()).padStart(2, "0")}s`;
    const filename = `warehouse-stock-${timestamp}.pdf`;

    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Access-Control-Expose-Headers": "Content-Disposition",
      "Cache-Control": "no-cache",
    });

    doc = new PDFDocument({ margin: 30, size: "A4", layout: "landscape" });
    doc.pipe(response);

    doc
      .fontSize(18)
      .font("Helvetica-Bold")
      .text("Warehouse Stock Report", { align: "center" })
      .fontSize(10)
      .font("Helvetica")
      .text(`Date: ${now.toLocaleString()}`, { align: "center" })
      .text(`Products: ${products.length}`, { align: "center" })
      .moveDown(2);

    const legendY = 120;
    doc.fontSize(8).fillColor("#dc3545").text("█ Out of Stock", 50, legendY);
    doc.fillColor("#fd7e14").text("█ Low Stock", 150, legendY);
    doc.fillColor("#28a745").text("█ In Stock", 250, legendY);
    doc.fillColor("#000000");

    const startY = 140;
    let y = startY;
    const lineHeight = 18;
    const selectedColumns = columns.split(",");

    doc.fontSize(7).font("Helvetica-Bold");
    let x = 30;
    const colWidths = {
      product: 80,
      sku: 50,
      supplier: 70,
      weight: 35,
      unit: 35,
      packaging: 45,
      stockInHouse: 45,
      damaged: 40,
      expired: 40,
      refurb: 40,
      final: 40,
      online: 40,
      offline: 40,
    };

    doc.text("Product", x, y, { width: colWidths.product });
    x += colWidths.product;
    doc.text("SKU", x, y, { width: colWidths.sku });
    x += colWidths.sku;

    if (columns === "all" || selectedColumns.includes("supplier")) {
      doc.text("Supplier", x, y, { width: colWidths.supplier });
      x += colWidths.supplier;
    }
    if (columns === "all" || selectedColumns.includes("weight")) {
      doc.text("Weight", x, y, { width: colWidths.weight });
      x += colWidths.weight;
    }
    if (columns === "all" || selectedColumns.includes("unit")) {
      doc.text("Unit", x, y, { width: colWidths.unit });
      x += colWidths.unit;
    }
    if (columns === "all" || selectedColumns.includes("packaging")) {
      doc.text("Package", x, y, { width: colWidths.packaging });
      x += colWidths.packaging;
    }
    if (columns === "all" || selectedColumns.includes("stockInHouse")) {
      doc.text("In House", x, y, { width: colWidths.stockInHouse });
      x += colWidths.stockInHouse;
    }
    if (columns === "all" || selectedColumns.includes("damaged")) {
      doc.text("Damaged", x, y, { width: colWidths.damaged });
      x += colWidths.damaged;
    }
    if (columns === "all" || selectedColumns.includes("expired")) {
      doc.text("Expired", x, y, { width: colWidths.expired });
      x += colWidths.expired;
    }
    if (columns === "all" || selectedColumns.includes("refurb")) {
      doc.text("Refurb", x, y, { width: colWidths.refurb });
      x += colWidths.refurb;
    }
    if (columns === "all" || selectedColumns.includes("final")) {
      doc.text("Final", x, y, { width: colWidths.final });
      x += colWidths.final;
    }
    if (columns === "all" || selectedColumns.includes("online")) {
      doc.text("Online", x, y, { width: colWidths.online });
      x += colWidths.online;
    }
    if (columns === "all" || selectedColumns.includes("offline")) {
      doc.text("Offline", x, y, { width: colWidths.offline });
      x += colWidths.offline;
    }

    y += 15;
    doc.moveTo(30, y).lineTo(800, y).stroke();
    y += 5;

    doc.fontSize(6).font("Helvetica");

    products.forEach((product) => {
      if (y > 520) {
        doc.addPage();
        y = 50;
      }

      const stock = product.warehouseStock?.enabled
        ? product.warehouseStock
        : {
            finalStock: product.stock || 0,
            stockInHouse: 0,
            stockOnArrival: 0,
            damagedQty: 0,
            expiredQty: 0,
            refurbishedQty: 0,
            onlineStock: 0,
            offlineStock: 0,
          };

      const finalStock = stock.finalStock || 0;
      let rowColor = "#28a745";
      if (finalStock === 0) rowColor = "#dc3545";
      else if (finalStock <= systemSettings.lowStockThreshold)
        rowColor = "#fd7e14";

      doc.fillColor(rowColor);
      x = 30;

      doc.text(product.name?.substring(0, 15) || "", x, y, {
        width: colWidths.product,
      });
      x += colWidths.product;
      doc.text(product.sku || "", x, y, { width: colWidths.sku });
      x += colWidths.sku;

      if (columns === "all" || selectedColumns.includes("supplier")) {
        doc.text(product.supplier?.name?.substring(0, 12) || "-", x, y, {
          width: colWidths.supplier,
        });
        x += colWidths.supplier;
      }
      if (columns === "all" || selectedColumns.includes("weight")) {
        doc.text(product.weight ? `${product.weight}kg` : "-", x, y, {
          width: colWidths.weight,
        });
        x += colWidths.weight;
      }
      if (columns === "all" || selectedColumns.includes("unit")) {
        doc.text(product.unit || "-", x, y, { width: colWidths.unit });
        x += colWidths.unit;
      }
      if (columns === "all" || selectedColumns.includes("packaging")) {
        doc.text(product.packaging?.substring(0, 8) || "-", x, y, {
          width: colWidths.packaging,
        });
        x += colWidths.packaging;
      }
      if (columns === "all" || selectedColumns.includes("stockInHouse")) {
        doc.text(String(stock.stockInHouse || 0), x, y, {
          width: colWidths.stockInHouse,
        });
        x += colWidths.stockInHouse;
      }
      if (columns === "all" || selectedColumns.includes("damaged")) {
        doc.text(String(stock.damagedQty || 0), x, y, {
          width: colWidths.damaged,
        });
        x += colWidths.damaged;
      }
      if (columns === "all" || selectedColumns.includes("expired")) {
        doc.text(String(stock.expiredQty || 0), x, y, {
          width: colWidths.expired,
        });
        x += colWidths.expired;
      }
      if (columns === "all" || selectedColumns.includes("refurb")) {
        doc.text(String(stock.refurbishedQty || 0), x, y, {
          width: colWidths.refurb,
        });
        x += colWidths.refurb;
      }
      if (columns === "all" || selectedColumns.includes("final")) {
        doc.text(String(stock.finalStock || 0), x, y, {
          width: colWidths.final,
        });
        x += colWidths.final;
      }
      if (columns === "all" || selectedColumns.includes("online")) {
        doc.text(String(stock.onlineStock || 0), x, y, {
          width: colWidths.online,
        });
        x += colWidths.online;
      }
      if (columns === "all" || selectedColumns.includes("offline")) {
        doc.text(String(stock.offlineStock || 0), x, y, {
          width: colWidths.offline,
        });
        x += colWidths.offline;
      }

      doc.fillColor("#000000");
      y += lineHeight;
    });

    doc.end();
    console.log("✅ PDF generated successfully");
  } catch (error) {
    console.error("❌ PDF export error:", error);
    if (doc) {
      try {
        doc.end();
      } catch (e) {
        console.error("Error ending PDF:", e);
      }
    }
    if (!response.headersSent) {
      response.status(500).json({
        message: error.message || "Failed to export PDF",
        error: true,
        success: false,
      });
    }
  }
};

export const getSuppliers = async (request, response) => {
  try {
    const suppliers = await SupplierModel.find({ status: "ACTIVE" })
      .select("_id name slug")
      .sort({ name: 1 });

    return response.json({
      message: "Suppliers retrieved successfully",
      data: suppliers,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Get suppliers error:", error);
    return response.status(500).json({
      message: error.message || "Failed to retrieve suppliers",
      error: true,
      success: false,
    });
  }
};

export const getProductsForStock = async (request, response) => {
  try {
    const {
      page = 1,
      limit = 100,
      search,
      category,
      brand,
      productType,
      compatibleSystem,
      supplier,
    } = request.query;

    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { sku: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    if (category) query.category = category;
    if (brand) query.brand = { $in: [brand] };
    if (productType) query.productType = productType;
    if (compatibleSystem) query.compatibleSystem = compatibleSystem;
    if (supplier) query.supplier = supplier;

    const skip = (page - 1) * limit;

    const [products, totalCount] = await Promise.all([
      ProductModel.find(query)
        .populate("category", "name")
        .populate("brand", "name")
        .populate("compatibleSystem", "name")
        .populate("supplier", "name slug")
        .sort({ name: 1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      ProductModel.countDocuments(query),
    ]);

    const productsWithStock = await Promise.all(
      products.map(async (product) => {
        const effectiveStock = await getEffectiveStock(product);
        return { ...product, warehouseStock: effectiveStock };
      }),
    );

    return response.json({
      message: "Products retrieved successfully",
      data: productsWithStock,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: parseInt(page),
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Get products for stock error:", error);
    return response.status(500).json({
      message: error.message || "Failed to retrieve products",
      error: true,
      success: false,
    });
  }
};

// ==========================================
// MAIN UPDATE STOCK - FIXED VALIDATION
// ==========================================
export const updateStock = async (request, response) => {
  try {
    const {
      productId,
      stockOnArrival,
      stockInHouse,
      damagedQty,
      expiredQty,
      refurbishedQty,
      finalStock,
      onlineStock,
      offlineStock,
      notes,
      unit,
      packaging,
      supplierName,
    } = request.body;

    if (!systemSettings.enabled) {
      return response.status(403).json({
        message: "Warehouse stock system is disabled",
        error: true,
        success: false,
      });
    }

    const userRole = request.user.subRole || request.user.role;
    if (userRole !== "WAREHOUSE") {
      return response.status(403).json({
        message: "Only warehouse staff can update stock quantities",
        error: true,
        success: false,
      });
    }

    if (!productId) {
      return response.status(400).json({
        message: "Product ID is required",
        error: true,
        success: false,
      });
    }

    // Parse all values to numbers before validation
    // NOTE: stockOnArrival, supplierName, unit, packaging are NOT validated
    const parsedData = {
      stockInHouse: parseFloat(stockInHouse) || 0,
      damagedQty: parseFloat(damagedQty) || 0,
      expiredQty: parseFloat(expiredQty) || 0,
      refurbishedQty: parseFloat(refurbishedQty) || 0,
      finalStock: parseFloat(finalStock) || 0,
      onlineStock: parseFloat(onlineStock) || 0,
      offlineStock: parseFloat(offlineStock) || 0,
    };

    // Validate stock data - only the 7 core fields
    const validation = validateStockUpdate(parsedData);

    if (!validation.isValid) {
      return response.status(400).json({
        message: "Stock validation failed",
        errors: validation.errors,
        error: true,
        success: false,
      });
    }

    const currentProduct = await ProductModel.findById(productId).populate(
      "supplier",
      "name slug",
    );
    if (!currentProduct) {
      return response.status(404).json({
        message: "Product not found",
        error: true,
        success: false,
      });
    }

    // Handle supplier - find or create if name provided
    let supplierId = currentProduct.supplier?._id;
    if (supplierName && supplierName.trim() !== "") {
      supplierId = await findOrCreateSupplier(supplierName);
    }

    const currentEffectiveStock = await getEffectiveStock(currentProduct);

    // Track changes for activity log
    const changes = {};
    const oldStock = {
      stockOnArrival: currentEffectiveStock.stockOnArrival,
      stockInHouse: currentEffectiveStock.stockInHouse,
      damagedQty: currentEffectiveStock.damagedQty,
      expiredQty: currentEffectiveStock.expiredQty,
      refurbishedQty: currentEffectiveStock.refurbishedQty,
      finalStock: currentEffectiveStock.finalStock,
      onlineStock: currentEffectiveStock.onlineStock,
      offlineStock: currentEffectiveStock.offlineStock,
      unit: currentProduct.unit,
      packaging: currentProduct.packaging,
      supplier: currentProduct.supplier?.name || "None",
    };

    const newStock = {
      stockOnArrival: parseFloat(stockOnArrival) || 0,
      stockInHouse: parsedData.stockInHouse,
      damagedQty: parsedData.damagedQty,
      expiredQty: parsedData.expiredQty,
      refurbishedQty: parsedData.refurbishedQty,
      finalStock: parsedData.finalStock,
      onlineStock: parsedData.onlineStock,
      offlineStock: parsedData.offlineStock,
      unit: unit || currentProduct.unit,
      packaging: packaging || currentProduct.packaging,
      supplier: supplierName || oldStock.supplier,
    };

    Object.keys(newStock).forEach((key) => {
      if (oldStock[key] !== newStock[key]) {
        changes[key] = { from: oldStock[key], to: newStock[key] };
      }
    });

    // Build update object using parsed (validated) values
    const updateData = {
      warehouseStock: {
        enabled: true,
        stockOnArrival: parseFloat(stockOnArrival) || 0,
        stockInHouse: parsedData.stockInHouse,
        damagedQty: parsedData.damagedQty,
        expiredQty: parsedData.expiredQty,
        refurbishedQty: parsedData.refurbishedQty,
        finalStock: parsedData.finalStock,
        onlineStock: parsedData.onlineStock,
        offlineStock: parsedData.offlineStock,
        notes: notes || "",
        lastUpdated: new Date(),
        updatedBy: request.user._id,
      },
      stock: parsedData.finalStock,
      unit: unit || currentProduct.unit,
      packaging: packaging || currentProduct.packaging,
      stockSource: "WAREHOUSE_MANUAL",
      updatedBy: request.user._id,
    };

    if (supplierId) {
      updateData.supplier = supplierId;
    }

    const updatedProduct = await ProductModel.findByIdAndUpdate(
      productId,
      updateData,
      { new: true, runValidators: true },
    ).populate("category brand compatibleSystem supplier", "name slug");

    await logActivity(
      request.user,
      "STOCK_UPDATE",
      {
        type: "PRODUCT",
        id: productId,
        name: updatedProduct.name,
        sku: updatedProduct.sku,
      },
      changes,
      notes || "",
      { ip: request.ip, userAgent: request.headers["user-agent"] },
    );

    return response.json({
      message: "Stock updated successfully",
      data: updatedProduct,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Update stock error:", error);
    return response.status(500).json({
      message: error.message || "Failed to update stock",
      error: true,
      success: false,
    });
  }
};

// ==========================================
// CSV IMPORT
// ==========================================
export const importStockCSV = async (request, response) => {
  try {
    const userRole = request.user.subRole || request.user.role;
    if (userRole !== "WAREHOUSE") {
      return response.status(403).json({
        message: "Only warehouse staff can import stock",
        error: true,
        success: false,
      });
    }

    if (!systemSettings.enabled) {
      return response.status(403).json({
        message: "Warehouse stock system is disabled",
        error: true,
        success: false,
      });
    }

    const { csvData, notificationEmails = [] } = request.body;

    if (!csvData) {
      return response.status(400).json({
        message: "CSV data is required",
        error: true,
        success: false,
      });
    }

    const rows = [];
    const stream = Readable.from([csvData]);

    await new Promise((resolve, reject) => {
      stream
        .pipe(csv())
        .on("data", (row) => rows.push(row))
        .on("end", resolve)
        .on("error", reject);
    });

    const results = {
      successful: [],
      failed: [],
      totalProcessed: 0,
      timestamp: new Date(),
      newSuppliersCreated: [],
    };

    for (const row of rows) {
      try {
        results.totalProcessed++;

        const product = await ProductModel.findOne({
          sku: row["SKU"],
        }).populate("supplier", "name slug");

        if (!product) {
          results.failed.push({
            sku: row["SKU"],
            productName: row["Product Name"],
            reason: "Product not found",
          });
          continue;
        }

        const stockData = {
          stockInHouse: parseFloat(row["Stock In House"] || 0),
          damagedQty: parseFloat(row["Damaged Qty"] || 0),
          expiredQty: parseFloat(row["Expired Qty"] || 0),
          refurbishedQty: parseFloat(row["Refurbished Qty"] || 0),
          finalStock: parseFloat(row["Final Stock"] || 0),
          onlineStock: parseFloat(row["Online Stock"] || 0),
          offlineStock: parseFloat(row["Offline Stock"] || 0),
          stockOnArrival: parseFloat(row["Stock on Arrival"] || 0),
          unit: row["Unit"] || product.unit || "",
          packaging: row["Packaging"] || product.packaging || "",
        };

        let supplierId = product.supplier?._id;
        let supplierName = product.supplier?.name || "";

        if (row["Supplier"] && row["Supplier"].trim() !== "") {
          const wasNewSupplier = !(await SupplierModel.findOne({
            name: { $regex: new RegExp(`^${row["Supplier"].trim()}$`, "i") },
          }));

          supplierId = await findOrCreateSupplier(row["Supplier"]);
          supplierName = row["Supplier"].trim();

          if (wasNewSupplier) {
            results.newSuppliersCreated.push({
              name: supplierName,
              slug: generateSupplierSlug(supplierName),
            });
          }
        }

        // Validate only the core stock fields
        const validation = validateStockUpdate(stockData);

        if (!validation.isValid) {
          results.failed.push({
            sku: row["SKU"],
            productName: product.name,
            reason: validation.errors.join("; "),
          });
          continue;
        }

        const oldValues = {
          stockInHouse: product.warehouseStock?.stockInHouse || 0,
          finalStock: product.warehouseStock?.finalStock || product.stock || 0,
          onlineStock: product.warehouseStock?.onlineStock || 0,
          offlineStock: product.warehouseStock?.offlineStock || 0,
          damagedQty: product.warehouseStock?.damagedQty || 0,
          expiredQty: product.warehouseStock?.expiredQty || 0,
          refurbishedQty: product.warehouseStock?.refurbishedQty || 0,
          unit: product.unit || "",
          packaging: product.packaging || "",
          supplier: product.supplier?.name || "None",
        };

        const updateData = {
          warehouseStock: {
            enabled: true,
            ...stockData,
            notes: `Imported via CSV on ${new Date().toLocaleString()}`,
            lastUpdated: new Date(),
            updatedBy: request.user._id,
          },
          stock: stockData.finalStock,
          unit: stockData.unit,
          packaging: stockData.packaging,
          stockSource: "WAREHOUSE_MANUAL",
          updatedBy: request.user._id,
        };

        if (supplierId) updateData.supplier = supplierId;

        await ProductModel.findByIdAndUpdate(product._id, updateData, {
          new: true,
          runValidators: true,
        });

        const changes = {};
        Object.keys({ ...stockData, supplier: supplierName }).forEach((key) => {
          const oldVal =
            key === "supplier" ? oldValues.supplier : oldValues[key];
          const newVal = key === "supplier" ? supplierName : stockData[key];
          if (oldVal !== undefined && oldVal !== newVal) {
            changes[key] = { from: oldVal, to: newVal };
          }
        });

        await logActivity(
          request.user,
          "STOCK_UPDATE",
          {
            type: "PRODUCT",
            id: product._id,
            name: product.name,
            sku: product.sku,
          },
          changes,
          "CSV Import - Batch update",
          { ip: request.ip, userAgent: request.headers["user-agent"] },
        );

        results.successful.push({
          sku: row["SKU"],
          productName: product.name,
          supplier: supplierName,
          updates: changes,
        });
      } catch (error) {
        results.failed.push({
          sku: row["SKU"],
          productName: row["Product Name"],
          reason: error.message,
        });
      }
    }

    try {
      const mandatoryEmails = [
        "webmaster@yehgs.co.uk",
        "shipment2@yehgs.co.uk",
      ].filter(Boolean);
      const additionalEmails = notificationEmails.filter(
        (email) => email && email.trim() !== "",
      );
      const allEmails = [...new Set([...mandatoryEmails, ...additionalEmails])];

      if (allEmails.length > 0) {
        await sendImportNotificationEmail(allEmails, results, request.user);
        console.log(
          `✅ Import notification sent to ${allEmails.length} recipient(s)`,
        );
      }
    } catch (emailError) {
      console.error("❌ Failed to send import notification email:", emailError);
    }

    return response.json({
      message: `Import completed: ${results.successful.length} successful, ${results.failed.length} failed${results.newSuppliersCreated.length > 0 ? `, ${results.newSuppliersCreated.length} new suppliers created` : ""}`,
      data: results,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Import CSV error:", error);
    return response.status(500).json({
      message: error.message || "Failed to import CSV",
      error: true,
      success: false,
    });
  }
};
