// utils/emailService.js - Add this function
import { transporter } from "./nodemailer.js";

/**
 * Send invoice email to customer
 */
export const sendInvoiceEmail = async (email, order) => {
  const emailTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; background-color: #111011; color: #ffffff; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #fffb06; color: #111011; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background-color: #262626; padding: 30px; border-radius: 0 0 8px 8px; }
        .button { display: inline-block; background-color: #fffb06; color: #111011; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 20px 0; }
        .footer { text-align: center; padding: 20px; color: #a3a3a3; font-size: 12px; }
        .invoice-details { background-color: #171717; padding: 20px; border-radius: 6px; margin: 20px 0; }
        .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #404040; }
        .label { color: #a3a3a3; }
        .value { color: #ffffff; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 style="margin: 0;">YEHGS CO LTD</h1>
          <p style="margin: 5px 0 0 0; font-size: 14px;">Your Invoice is Ready</p>
        </div>
        <div class="content">
          <h2 style="color: #fffb06; margin-top: 0;">Invoice for Order #${order.orderNumber}</h2>
          
          <p>Dear ${order.customer?.name},</p>
          
          <p>Thank you for your business! Please find your invoice attached to this email.</p>
          
          <div class="invoice-details">
            <div class="detail-row">
              <span class="label">Invoice Number:</span>
              <span class="value">${order.invoiceNumber || order.orderNumber}</span>
            </div>
            <div class="detail-row">
              <span class="label">Order Date:</span>
              <span class="value">${new Date(order.createdAt).toLocaleDateString("en-GB")}</span>
            </div>
            <div class="detail-row">
              <span class="label">Total Amount:</span>
              <span class="value" style="color: #fffb06;">₦${order.totalAmount.toLocaleString()}</span>
            </div>
            <div class="detail-row">
              <span class="label">Payment Status:</span>
              <span class="value">${order.paymentStatus}</span>
            </div>
          </div>
          
          ${
            order.invoiceUrl
              ? `
          <div style="text-align: center;">
            <a href="${order.invoiceUrl}" class="button" target="_blank">Download Invoice</a>
          </div>
          `
              : ""
          }
          
          <p style="margin-top: 30px;">If you have any questions about this invoice, please don't hesitate to contact us.</p>
          
          <p style="margin-top: 20px;">Best regards,<br><strong>YEHGS Team</strong></p>
        </div>
        <div class="footer">
          <p><strong>YEHGS CO LTD</strong> - FMCG Coffee Partner Worldwide</p>
          <p>UK: Unit A51, The Mall, LUI 2TA Luton, United Kingdom</p>
          <p>Nigeria: 3, Kafi Street, Alausa Ikeja, Lagos</p>
          <p>Tel: (+44)-7404-493555 | (+234)-7030-292729</p>
          <p>Email: reception@yehgs.co.uk | Web: www.yehgs.co.uk</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const mailOptions = {
    from: `"YEHGS Co Ltd" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `Invoice for Order #${order.orderNumber}`,
    html: emailTemplate,
  };

  await transporter.sendMail(mailOptions);
};
