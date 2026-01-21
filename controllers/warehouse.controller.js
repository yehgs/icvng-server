// controllers/warehouse.controller.js
import ProductModel from "../models/product.model.js";
import StockModel from "../models/stock.model.js";
import UserModel from "../models/user.model.js";
import WarehouseActivityModel from "../models/warehouse-activity.model.js";
import mongoose from "mongoose";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

// System settings with persistence
let systemSettings = {
  enabled: true,
  autoSyncEnabled: true,
  lowStockThreshold: 10,
  criticalStockThreshold: 5,
};

// Enhanced activity logging with database persistence
const logActivity = async (
  user,
  action,
  target,
  changes = null,
  notes = "",
  metadata = {}
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
    // Don't throw error to prevent main operation from failing
  }
};

// Helper function to sync stock from Stock model
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
      }
    );

    const finalStock = totals.goodQuantity + totals.refurbishedQuantity;

    return {
      stockOnArrival: totals.stockOnArrival,
      damagedQty: totals.damagedQuantity,
      expiredQty: totals.expiredQuantity,
      refurbishedQty: totals.refurbishedQuantity,
      finalStock: finalStock,
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

// Helper function to get effective stock
const getEffectiveStock = async (product) => {
  if (product.warehouseStock?.enabled) {
    return {
      stockOnArrival: product.warehouseStock.stockOnArrival || 0,
      damagedQty: product.warehouseStock.damagedQty || 0,
      expiredQty: product.warehouseStock.expiredQty || 0,
      refurbishedQty: product.warehouseStock.refurbishedQty || 0,
      finalStock: product.warehouseStock.finalStock || 0,
      onlineStock: product.warehouseStock.onlineStock || 0,
      offlineStock: product.warehouseStock.offlineStock || 0,
      notes: product.warehouseStock.notes || "",
      lastUpdated: product.warehouseStock.lastUpdated,
      source: "WAREHOUSE_MANUAL",
      isManualOverride: true,
    };
  } else {
    const stockTotals = await syncStockFromStockModel(product._id);

    if (stockTotals) {
      return stockTotals;
    } else {
      return {
        stockOnArrival: product.stock || 0,
        damagedQty: 0,
        expiredQty: 0,
        refurbishedQty: 0,
        finalStock: product.stock || 0,
        onlineStock: 0,
        offlineStock: 0,
        notes: "Default product stock",
        lastUpdated: product.updatedAt,
        source: "PRODUCT_DEFAULT",
        isManualOverride: false,
      };
    }
  }
};

// Get products for warehouse stock management
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

    const skip = (page - 1) * limit;

    const [products, totalCount] = await Promise.all([
      ProductModel.find(query)
        .populate("category", "name")
        .populate("brand", "name")
        .populate("compatibleSystem", "name")
        .sort({ name: 1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      ProductModel.countDocuments(query),
    ]);

    const productsWithStock = await Promise.all(
      products.map(async (product) => {
        const effectiveStock = await getEffectiveStock(product);
        return {
          ...product,
          warehouseStock: effectiveStock,
        };
      })
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

// Update stock quantities
export const updateStock = async (request, response) => {
  try {
    const {
      productId,
      stockOnArrival,
      damagedQty,
      expiredQty,
      refurbishedQty,
      finalStock,
      onlineStock,
      offlineStock,
      notes,
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

    // Validation
    const validationErrors = [];

    if (stockOnArrival < 0)
      validationErrors.push("Stock on arrival cannot be negative");
    if (damagedQty < 0)
      validationErrors.push("Damaged quantity cannot be negative");
    if (expiredQty < 0)
      validationErrors.push("Expired quantity cannot be negative");
    if (refurbishedQty < 0)
      validationErrors.push("Refurbished quantity cannot be negative");
    if (onlineStock < 0)
      validationErrors.push("Online stock cannot be negative");
    if (offlineStock < 0)
      validationErrors.push("Offline stock cannot be negative");

    const totalProcessed =
      damagedQty + expiredQty + refurbishedQty + finalStock;
    if (totalProcessed !== stockOnArrival) {
      validationErrors.push(
        "Total processed quantities must equal stock on arrival"
      );
    }

    if (onlineStock + offlineStock > finalStock) {
      validationErrors.push("Total distribution cannot exceed final stock");
    }

    if (validationErrors.length > 0) {
      return response.status(400).json({
        message: "Validation errors",
        errors: validationErrors,
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

    const currentEffectiveStock = await getEffectiveStock(currentProduct);

    // Track changes
    const changes = {};
    const oldStock = {
      stockOnArrival: currentEffectiveStock.stockOnArrival,
      damagedQty: currentEffectiveStock.damagedQty,
      expiredQty: currentEffectiveStock.expiredQty,
      refurbishedQty: currentEffectiveStock.refurbishedQty,
      finalStock: currentEffectiveStock.finalStock,
      onlineStock: currentEffectiveStock.onlineStock,
      offlineStock: currentEffectiveStock.offlineStock,
    };

    const newStock = {
      stockOnArrival,
      damagedQty,
      expiredQty,
      refurbishedQty,
      finalStock,
      onlineStock,
      offlineStock,
    };

    Object.keys(newStock).forEach((key) => {
      if (oldStock[key] !== newStock[key]) {
        changes[key] = {
          from: oldStock[key],
          to: newStock[key],
        };
      }
    });

    // Update product
    const updateData = {
      warehouseStock: {
        enabled: true,
        stockOnArrival,
        damagedQty,
        expiredQty,
        refurbishedQty,
        finalStock,
        onlineStock,
        offlineStock,
        notes,
        lastUpdated: new Date(),
        updatedBy: request.user._id,
      },
      stock: finalStock,
      stockSource: "WAREHOUSE_MANUAL",
      updatedBy: request.user._id,
    };

    const updatedProduct = await ProductModel.findByIdAndUpdate(
      productId,
      updateData,
      { new: true, runValidators: true }
    ).populate("category brand compatibleSystem", "name");

    // Log activity to database
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
      notes,
      {
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      }
    );

    return response.json({
      message: "Stock updated successfully",
      data: {
        ...updatedProduct.toObject(),
        warehouseStock: {
          stockOnArrival,
          damagedQty,
          expiredQty,
          refurbishedQty,
          finalStock,
          onlineStock,
          offlineStock,
          notes,
          lastUpdated: updateData.warehouseStock.lastUpdated,
          source: "WAREHOUSE_MANUAL",
          isManualOverride: true,
        },
      },
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

// Update product weight
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
      changes.weight = {
        from: currentProduct.weight || 0,
        to: weight,
      };
    }

    const updateData = {
      weight,
      updatedBy: request.user._id,
    };

    const updatedProduct = await ProductModel.findByIdAndUpdate(
      productId,
      updateData,
      { new: true, runValidators: true }
    ).populate("category brand compatibleSystem", "name");

    // Log activity
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
      {
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      }
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

// Get activity log with real database data
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

    // Date range filter
    if (dateRange && dateRange !== "all") {
      const daysAgo = parseInt(dateRange);
      const cutoffDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
      query.createdAt = { $gte: cutoffDate };
    }

    // Action filter
    if (action) {
      query.action = action;
    }

    // User filter
    if (userId) {
      query.user = userId;
    }

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

    // Format activities for response
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

export const exportStockPDF = async (request, response) => {
  let doc;

  try {
    const { category, brand, productType, compatibleSystem } = request.query;

    const query = {};
    if (category) query.category = category;
    if (brand) query.brand = { $in: [brand] };
    if (productType) query.productType = productType;
    if (compatibleSystem) query.compatibleSystem = compatibleSystem;

    const products = await ProductModel.find(query)
      .populate("category brand compatibleSystem", "name")
      .sort({ name: 1 })
      .limit(500);

    if (products.length === 0) {
      return response.status(404).json({
        message: "No products found to export",
        error: true,
        success: false,
      });
    }

    // Format timestamp for filename
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");

    const timestamp = `${year}-${month}-${day}_${hours}h${minutes}m${seconds}s`;
    const filename = `warehouse-stock-${timestamp}.pdf`;

    console.log("📄 Generating PDF:", filename);

    // CRITICAL: Set headers BEFORE creating PDF document
    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Access-Control-Expose-Headers": "Content-Disposition",
      "Cache-Control": "no-cache",
    });

    // Create PDF AFTER headers are set
    doc = new PDFDocument({
      margin: 30,
      size: "A4",
      layout: "landscape",
    });

    // Pipe to response
    doc.pipe(response);

    // Title
    doc
      .fontSize(18)
      .font("Helvetica-Bold")
      .text("Warehouse Stock Report", { align: "center" })
      .fontSize(10)
      .font("Helvetica")
      .text(`Date: ${now.toLocaleString()}`, { align: "center" })
      .text(`Products: ${products.length}`, { align: "center" })
      .moveDown(2);

    // Table header
    const startY = 100;
    let y = startY;
    const lineHeight = 18;

    doc.fontSize(8).font("Helvetica-Bold");
    doc.text("Product", 30, y, { width: 100 });
    doc.text("SKU", 135, y, { width: 60 });
    doc.text("Weight", 200, y, { width: 45 });
    doc.text("Stock", 250, y, { width: 40 });
    doc.text("Damaged", 295, y, { width: 45 });
    doc.text("Final", 345, y, { width: 40 });
    doc.text("Online", 390, y, { width: 40 });
    doc.text("Offline", 435, y, { width: 40 });

    y += 15;
    doc.moveTo(30, y).lineTo(580, y).stroke();
    y += 5;

    // Products
    doc.fontSize(7).font("Helvetica");

    products.forEach((product) => {
      if (y > 520) {
        doc.addPage();
        y = 50;
      }

      const stock = product.warehouseStock?.enabled
        ? product.warehouseStock
        : {
            finalStock: product.stock || 0,
            stockOnArrival: 0,
            damagedQty: 0,
            onlineStock: 0,
            offlineStock: 0,
          };

      doc.text(product.name?.substring(0, 18) || "", 30, y, { width: 100 });
      doc.text(product.sku || "", 135, y, { width: 60 });
      doc.text(product.weight ? `${product.weight}kg` : "-", 200, y, {
        width: 45,
      });
      doc.text(String(stock.stockOnArrival || 0), 250, y, { width: 40 });
      doc.text(String(stock.damagedQty || 0), 295, y, { width: 45 });
      doc.text(String(stock.finalStock || 0), 345, y, { width: 40 });
      doc.text(String(stock.onlineStock || 0), 390, y, { width: 40 });
      doc.text(String(stock.offlineStock || 0), 435, y, { width: 40 });

      y += lineHeight;
    });

    // Finalize PDF
    doc.end();

    console.log("✅ PDF generated successfully");
  } catch (error) {
    console.error("❌ PDF export error:", error);

    // Clean up document if it was created
    if (doc) {
      try {
        doc.end();
      } catch (e) {
        console.error("Error ending PDF:", e);
      }
    }

    // Only send error if headers haven't been sent
    if (!response.headersSent) {
      response.status(500).json({
        message: error.message || "Failed to export PDF",
        error: true,
        success: false,
      });
    }
  }
};

// Enable system
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
      {
        type: "SYSTEM",
        name: "Warehouse Stock Management",
      },
      null,
      "Enabled manual stock management for warehouse team",
      {
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      }
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

// Disable system
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
      {
        type: "SYSTEM",
        name: "Warehouse Stock Management",
      },
      null,
      "Disabled manual stock management",
      {
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      }
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

// Continue with remaining controller functions...
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

    const updateData = {
      "warehouseStock.enabled": false,
      stock: newStock,
      stockSource: stockTotals ? "STOCK_BATCHES" : "PRODUCT_DEFAULT",
      updatedBy: request.user._id,
    };

    const updatedProduct = await ProductModel.findByIdAndUpdate(
      productId,
      updateData,
      { new: true, runValidators: true }
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
      {
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      }
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
      {
        type: "SYSTEM",
        name: "Stock Synchronization",
      },
      null,
      `Synced ${syncedCount} products, ${errorCount} errors`,
      {
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      }
    );

    return response.json({
      message: "Bulk stock sync completed",
      data: {
        totalProducts: products.length,
        syncedCount,
        errorCount,
      },
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
      data: {
        enabled: systemSettings.enabled,
        settings: systemSettings,
      },
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
        {
          type: "SYSTEM",
          name: "System Settings",
        },
        changes,
        "System settings updated",
        {
          ip: request.ip,
          userAgent: request.headers["user-agent"],
        }
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

        const updateData = {
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
        };

        await ProductModel.findByIdAndUpdate(update.productId, updateData, {
          new: true,
          runValidators: true,
        });

        results.push({
          productId: update.productId,
          success: true,
        });

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
          {
            ip: request.ip,
            userAgent: request.headers["user-agent"],
          }
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

    const updateData = {
      "warehouseStock.enabled": true,
      "warehouseStock.finalStock": actualCount,
      "warehouseStock.lastUpdated": new Date(),
      "warehouseStock.updatedBy": request.user._id,
      stock: actualCount,
      stockSource: "WAREHOUSE_MANUAL",
      updatedBy: request.user._id,
    };

    await ProductModel.findByIdAndUpdate(productId, updateData);

    await logActivity(
      request.user,
      "STOCK_RECONCILIATION",
      {
        type: "PRODUCT",
        id: productId,
        name: product.name,
        sku: product.sku,
      },
      {
        finalStock: {
          from: currentStock,
          to: actualCount,
        },
      },
      `Stock reconciliation: ${difference > 0 ? "+" : ""}${difference} units`,
      {
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      }
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
      })
    );

    const csvContent = [csvHeaders, ...csvRows]
      .map((row) => row.map((field) => `"${field}"`).join(","))
      .join("\n");

    response.setHeader("Content-Type", "text/csv");
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="warehouse-stock-export.csv"'
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

    if (action) {
      query.action = action;
    }

    if (userId) {
      query.user = userId;
    }

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
      'attachment; filename="warehouse-activity-log.csv"'
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

// Get list of users for activity log filter
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
