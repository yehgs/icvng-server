// controllers/invoice.controller.js
import Order from "../models/order-request.model.js";
import uploadToCloudinary from "../utils/uploadFileCloudinary.js";
import { sendInvoiceEmail } from "../utils/request-email-service.js";

/**
 * Generate and save invoice for an order
 */
export const generateInvoice = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId)
      .populate("customer")
      .populate("items.product")
      .populate("shippingAddress")
      .populate("shippingZone")
      .populate("assignedTo")
      .populate("processedBy");

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Generate invoice number if not exists
    if (!order.invoiceNumber) {
      const invoiceNumber = `INV-${order.orderNumber}-${Date.now()}`;
      order.invoiceNumber = invoiceNumber;
      order.invoiceGenerated = true;
      await order.save();
    }

    res.status(200).json({
      success: true,
      message: "Invoice generated successfully",
      data: order,
    });
  } catch (error) {
    console.error("Generate invoice error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate invoice",
      error: error.message,
    });
  }
};

/**
 * Upload invoice PDF to Cloudinary
 */
export const uploadInvoice = async (req, res) => {
  try {
    const { orderId } = req.params;
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Upload to Cloudinary
    const uploadResult = await uploadToCloudinary(file.buffer, "invoices");

    // Update order with invoice URL
    order.invoiceUrl = uploadResult.secure_url;
    order.invoiceGenerated = true;
    await order.save();

    res.status(200).json({
      success: true,
      message: "Invoice uploaded successfully",
      data: {
        invoiceUrl: uploadResult.secure_url,
        order,
      },
    });
  } catch (error) {
    console.error("Upload invoice error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to upload invoice",
      error: error.message,
    });
  }
};

/**
 * Send invoice via email
 */
export const emailInvoice = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { email } = req.body;

    const order = await Order.findById(orderId)
      .populate("customer")
      .populate("items.product")
      .populate("shippingAddress");

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (!order.invoiceUrl) {
      return res.status(400).json({
        success: false,
        message: "Invoice not generated yet",
      });
    }

    const recipientEmail = email || order.customer?.email;

    if (!recipientEmail) {
      return res.status(400).json({
        success: false,
        message: "No email address provided",
      });
    }

    // Send invoice email
    await sendInvoiceEmail(recipientEmail, order);

    res.status(200).json({
      success: true,
      message: "Invoice sent successfully",
    });
  } catch (error) {
    console.error("Email invoice error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to send invoice",
      error: error.message,
    });
  }
};
