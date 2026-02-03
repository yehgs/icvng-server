// ==========================================
// EMAIL NOTIFICATION FUNCTIONS
// ==========================================

/**
 * Send Order Notification to Sales Team
 */
const sendOrderNotificationToSales = async (order) => {
  try {
    // Get all SALES and MANAGER users
    const salesUsers = await UserModel.find({
      role: "ADMIN",
      subRole: { $in: ["SALES", "MANAGER"] },
      status: "Active",
    });

    const emailAddresses = salesUsers.map((user) => user.email);

    if (emailAddresses.length === 0) {
      console.log("No sales users found to notify");
      return;
    }

    const mailOptions = {
      from: `"YEHGS Order System" <${process.env.EMAIL_USER}>`,
      to: emailAddresses.join(","),
      subject: `New BTB Order Request - ${order.orderNumber}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #111011; color: #fffb06; padding: 20px; text-align: center; }
            .content { background: #f4f4f4; padding: 30px; }
            .order-details { background: white; padding: 20px; margin: 20px 0; border-radius: 5px; }
            .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
            .button { display: inline-block; background: #fffb06; color: #111011; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔔 New Order Request</h1>
            </div>
            <div class="content">
              <h2>Order #${order.orderNumber}</h2>
              <div class="order-details">
                <div class="detail-row">
                  <strong>Customer:</strong>
                  <span>${order.customer.name} (${order.customer.companyName})</span>
                </div>
                <div class="detail-row">
                  <strong>Email:</strong>
                  <span>${order.customer.email}</span>
                </div>
                <div class="detail-row">
                  <strong>Mobile:</strong>
                  <span>${order.customer.mobile}</span>
                </div>
                <div class="detail-row">
                  <strong>Items:</strong>
                  <span>${order.items.length} item(s)</span>
                </div>
                <div class="detail-row">
                  <strong>Total Amount:</strong>
                  <span>₦${order.totalAmount.toLocaleString()}</span>
                </div>
                <div class="detail-row">
                  <strong>Order Date:</strong>
                  <span>${new Date(order.createdAt).toLocaleString()}</span>
                </div>
              </div>
              ${
                order.customerNotes
                  ? `
              <div class="order-details">
                <strong>Customer Notes:</strong>
                <p>${order.customerNotes}</p>
              </div>
              `
                  : ""
              }
              <p style="text-align: center;">
                <a href="${process.env.ADMIN_FRONTEND_URL}/orders/${order._id}" class="button">View Order Details</a>
              </p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} YEHGS Co Ltd. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log("Order notification sent to sales team");
  } catch (error) {
    console.error("Error sending sales notification:", error);
  }
};

/**
 * Send Order Status Update Notification
 */
const sendOrderStatusUpdateNotification = async (order) => {
  try {
    if (!order.user) return;

    const user = await UserModel.findById(order.user);
    if (!user) return;

    const statusMessages = {
      PENDING: "Your order is pending review",
      ATTENDING_TO: "Our team is now reviewing your order",
      PROCESSING: "Your order is being processed",
      CONFIRMED: "Your order has been confirmed",
      PREPARING: "Your order is being prepared",
      READY_FOR_PICKUP: "Your order is ready for pickup/delivery",
      IN_TRANSIT: "Your order is on its way",
      DELIVERED: "Your order has been delivered",
      CANCELLED: "Your order has been cancelled",
      REJECTED: "Your order has been rejected",
    };

    const mailOptions = {
      from: `"YEHGS Order System" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: `Order Status Update - ${order.orderNumber}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #111011; color: #fffb06; padding: 20px; text-align: center; }
            .content { background: #f4f4f4; padding: 30px; }
            .status-badge { display: inline-block; background: #fffb06; color: #111011; padding: 10px 20px; border-radius: 5px; font-weight: bold; margin: 20px 0; }
            .button { display: inline-block; background: #fffb06; color: #111011; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📦 Order Status Update</h1>
            </div>
            <div class="content">
              <h2>Hello ${user.name},</h2>
              <p>Your order <strong>${order.orderNumber}</strong> has been updated.</p>
              
              <div style="text-align: center;">
                <div class="status-badge">${order.status.replace(/_/g, " ")}</div>
              </div>
              
              <p>${statusMessages[order.status]}</p>
              
              ${
                order.estimatedDeliveryDate
                  ? `
              <p><strong>Estimated Delivery:</strong> ${new Date(order.estimatedDeliveryDate).toLocaleDateString()}</p>
              `
                  : ""
              }
              
              <p style="text-align: center;">
                <a href="${process.env.FRONTEND_URL}/orders/${order._id}" class="button">View Order Details</a>
              </p>
            </div>
            <div style="text-align: center; padding: 20px; font-size: 12px; color: #666;">
              <p>© ${new Date().getFullYear()} YEHGS Co Ltd. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log("Status update notification sent");
  } catch (error) {
    console.error("Error sending status update:", error);
  }
};

/**
 * Send Order Assignment Notification
 */
const sendOrderAssignmentNotification = async (order, assignedUser) => {
  try {
    const mailOptions = {
      from: `"YEHGS Order System" <${process.env.EMAIL_USER}>`,
      to: assignedUser.email,
      subject: `Order Assigned - ${order.orderNumber}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #111011; color: #fffb06; padding: 20px; text-align: center; }
            .content { background: #f4f4f4; padding: 30px; }
            .button { display: inline-block; background: #fffb06; color: #111011; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📋 Order Assigned to You</h1>
            </div>
            <div class="content">
              <h2>Hello ${assignedUser.name},</h2>
              <p>Order <strong>${order.orderNumber}</strong> has been assigned to you.</p>
              
              <p><strong>Order Amount:</strong> ₦${order.totalAmount.toLocaleString()}</p>
              <p><strong>Items:</strong> ${order.items.length}</p>
              
              <p style="text-align: center;">
                <a href="${process.env.ADMIN_FRONTEND_URL}/orders/${order._id}" class="button">View Order</a>
              </p>
            </div>
            <div style="text-align: center; padding: 20px; font-size: 12px; color: #666;">
              <p>© ${new Date().getFullYear()} YEHGS Co Ltd. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log("Assignment notification sent");
  } catch (error) {
    console.error("Error sending assignment notification:", error);
  }
};

/**
 * Send Order Cancellation Notification
 */
const sendOrderCancellationNotification = async (order) => {
  try {
    const assignedUser = await UserModel.findById(order.assignedTo);
    if (!assignedUser) return;

    const mailOptions = {
      from: `"YEHGS Order System" <${process.env.EMAIL_USER}>`,
      to: assignedUser.email,
      subject: `Order Cancelled - ${order.orderNumber}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #111011; color: #fffb06; padding: 20px; text-align: center; }
            .content { background: #f4f4f4; padding: 30px; }
            .alert { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>⚠️ Order Cancelled</h1>
            </div>
            <div class="content">
              <h2>Hello ${assignedUser.name},</h2>
              <div class="alert">
                <p><strong>Order ${order.orderNumber} has been cancelled by the customer.</strong></p>
              </div>
              
              <p><strong>Cancellation Notes:</strong></p>
              <p>${order.customerNotes}</p>
              
              <p style="text-align: center;">
                <a href="${process.env.ADMIN_FRONTEND_URL}/orders/${order._id}" style="display: inline-block; background: #fffb06; color: #111011; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; margin: 20px 0;">View Order</a>
              </p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log("Cancellation notification sent");
  } catch (error) {
    console.error("Error sending cancellation notification:", error);
  }
};

export {
  sendOrderNotificationToSales,
  sendOrderStatusUpdateNotification,
  sendOrderAssignmentNotification,
  sendOrderCancellationNotification,
};
