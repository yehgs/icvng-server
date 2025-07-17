// utils/emailTemplates.js - Email templates for shipping notifications
import sendEmail from '../config/sendEmail.js';

// Order Confirmation Email Template
export const orderConfirmationTemplate = ({
  customerName,
  orderId,
  orderDate,
  items,
  totalAmount,
  shippingAddress,
  shippingMethod,
  estimatedDelivery,
  trackingNumber,
}) => {
  const itemsHTML = items
    .map(
      (item) => `
    <tr>
      <td style="padding: 10px; border-bottom: 1px solid #eee;">
        <div style="display: flex; align-items: center;">
          <img src="${item.image}" alt="${
        item.name
      }" style="width: 50px; height: 50px; object-fit: cover; margin-right: 10px; border-radius: 4px;">
          <div>
            <div style="font-weight: 600; color: #333;">${item.name}</div>
            <div style="color: #666; font-size: 14px;">Qty: ${
              item.quantity
            }</div>
          </div>
        </div>
      </td>
      <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">
        ₦${item.totalPrice?.toLocaleString() || '0'}
      </td>
    </tr>
  `
    )
    .join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Order Confirmation - I-COFFEE.NG</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #8B4513, #D2691E); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border: 1px solid #ddd; }
            .footer { background: #333; color: white; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; }
            .status-update { background: white; border-left: 4px solid ${getStatusColor(
              status
            )}; padding: 20px; margin: 20px 0; border-radius: 0 8px 8px 0; }
            .tracking-box { background: #e8f5e8; border: 2px solid #4CAF50; padding: 20px; margin: 20px 0; border-radius: 8px; text-align: center; }
            .button { display: inline-block; background: #8B4513; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; margin: 15px 0; }
            .status-badge { background: ${getStatusColor(
              status
            )}; color: white; padding: 6px 16px; border-radius: 20px; font-size: 14px; font-weight: 600; }
            .location-info { background: #f0f8ff; border: 1px solid #b3d9ff; padding: 15px; margin: 15px 0; border-radius: 6px; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>${getStatusIcon(status)} Shipping Update</h1>
            <p>Your I-COFFEE.NG order is on the move!</p>
        </div>
        
        <div class="content">
            <h2>Hello ${customerName}!</h2>
            <p>We have an update on your order <strong>${orderId}</strong>.</p>
            
            <div class="status-update">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                    <h3 style="margin: 0;">Current Status</h3>
                    <span class="status-badge">${status.replace(
                      '_',
                      ' '
                    )}</span>
                </div>
                <p style="font-size: 16px; margin: 0;">${statusDescription}</p>
                
                ${
                  location && (location.city || location.facility)
                    ? `
                <div class="location-info">
                    <strong>📍 Current Location:</strong><br>
                    ${location.facility ? `${location.facility}<br>` : ''}
                    ${location.city || ''} ${
                        location.state ? `, ${location.state}` : ''
                      } ${location.country ? `, ${location.country}` : ''}
                </div>
                `
                    : ''
                }
                
                ${
                  estimatedDelivery && status !== 'DELIVERED'
                    ? `
                <p><strong>📅 Estimated Delivery:</strong> ${new Date(
                  estimatedDelivery
                ).toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}</p>
                `
                    : ''
                }
                
                <p><strong>🚚 Carrier:</strong> ${carrierName}</p>
            </div>
            
            <div class="tracking-box">
                <h3>📦 Track Your Package</h3>
                <p><strong>Tracking Number:</strong> <span style="font-family: monospace; font-size: 18px; font-weight: bold;">${trackingNumber}</span></p>
                <a href="${
                  process.env.FRONTEND_URL
                }/track/${trackingNumber}" class="button">View Full Tracking Details</a>
            </div>
            
            ${
              status === 'DELIVERED'
                ? `
            <div style="background: #e8f5e8; border: 2px solid #4CAF50; padding: 20px; margin: 20px 0; border-radius: 8px;">
                <h3 style="color: #4CAF50; margin-top: 0;">🎉 Delivery Completed!</h3>
                <p>Your order has been successfully delivered. We hope you enjoy your premium coffee experience!</p>
                <p>Please consider leaving a review to help other customers.</p>
            </div>
            `
                : ''
            }
            
            ${
              items && items.length > 0
                ? `
            <div style="background: white; border: 1px solid #ddd; padding: 20px; margin: 20px 0; border-radius: 8px;">
                <h3>📋 Order Items</h3>
                ${items
                  .map(
                    (item) => `
                    <div style="display: flex; align-items: center; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #eee;">
                        <img src="${item.image}" alt="${item.name}" style="width: 40px; height: 40px; object-fit: cover; margin-right: 10px; border-radius: 4px;">
                        <div>
                            <div style="font-weight: 600;">${item.name}</div>
                            <div style="color: #666; font-size: 14px;">Qty: ${item.quantity}</div>
                        </div>
                    </div>
                `
                  )
                  .join('')}
            </div>
            `
                : ''
            }
            
            <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; margin: 20px 0; border-radius: 6px;">
                <h4 style="color: #856404; margin-top: 0;">📞 Need Help?</h4>
                <p style="color: #856404; margin-bottom: 0;">
                    If you have any questions about your delivery, please contact our support team:
                    <br>📧 Email: <a href="mailto:support@i-coffee.ng">support@i-coffee.ng</a>
                    <br>📞 Phone: +234-800-ICOFFEE
                </p>
            </div>
            
            <p>Thank you for choosing I-COFFEE.NG!</p>
        </div>
        
        <div class="footer">
            <p>&copy; 2025 I-COFFEE.NG - Premium Coffee Delivered</p>
            <p>This is an automated message, please do not reply directly to this email.</p>
        </div>
    </body>
    </html>
  `;
};

// Delivery Confirmation Email Template
export const deliveryConfirmationTemplate = ({
  customerName,
  orderId,
  trackingNumber,
  deliveryDate,
  items,
  totalAmount,
}) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Delivery Confirmation - I-COFFEE.NG</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #4CAF50, #8BC34A); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border: 1px solid #ddd; }
            .footer { background: #333; color: white; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; }
            .success-box { background: #e8f5e8; border: 2px solid #4CAF50; padding: 25px; margin: 20px 0; border-radius: 8px; text-align: center; }
            .button { display: inline-block; background: #4CAF50; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; margin: 15px 0; }
            .review-section { background: #fff3e0; border: 1px solid #ffcc02; padding: 20px; margin: 20px 0; border-radius: 8px; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🎉 Delivery Confirmed!</h1>
            <p>Your I-COFFEE.NG order has been delivered</p>
        </div>
        
        <div class="content">
            <h2>Hello ${customerName}!</h2>
            
            <div class="success-box">
                <h3 style="color: #4CAF50; margin-top: 0;">✅ Successfully Delivered</h3>
                <p><strong>Order ID:</strong> ${orderId}</p>
                <p><strong>Tracking Number:</strong> ${trackingNumber}</p>
                <p><strong>Delivered On:</strong> ${new Date(
                  deliveryDate
                ).toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}</p>
            </div>
            
            <p>Great news! Your order has been successfully delivered. We hope you're excited to enjoy your premium coffee experience!</p>
            
            ${
              items && items.length > 0
                ? `
            <div style="background: white; border: 1px solid #ddd; padding: 20px; margin: 20px 0; border-radius: 8px;">
                <h3>📦 Delivered Items</h3>
                ${items
                  .map(
                    (item) => `
                    <div style="display: flex; align-items: center; margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #eee;">
                        <img src="${item.image}" alt="${item.name}" style="width: 60px; height: 60px; object-fit: cover; margin-right: 15px; border-radius: 6px;">
                        <div>
                            <div style="font-weight: 600; font-size: 16px;">${item.name}</div>
                            <div style="color: #666; font-size: 14px;">Quantity: ${item.quantity}</div>
                        </div>
                    </div>
                `
                  )
                  .join('')}
                <div style="text-align: right; margin-top: 15px; padding-top: 15px; border-top: 2px solid #4CAF50;">
                    <strong style="font-size: 18px;">Total: ₦${
                      totalAmount?.toLocaleString() || '0'
                    }</strong>
                </div>
            </div>
            `
                : ''
            }
            
            <div class="review-section">
                <h3 style="color: #ff6f00; margin-top: 0;">⭐ Share Your Experience</h3>
                <p>We'd love to hear about your experience! Your feedback helps us improve and helps other customers make informed decisions.</p>
                <div style="text-align: center;">
                    <a href="${
                      process.env.FRONTEND_URL
                    }/reviews/create?order=${orderId}" class="button" style="background: #ff6f00;">Leave a Review</a>
                </div>
            </div>
            
            <div style="background: #f0f8ff; border: 1px solid #b3d9ff; padding: 20px; margin: 20px 0; border-radius: 8px;">
                <h3 style="color: #1976d2; margin-top: 0;">☕ Brewing Tips</h3>
                <ul style="color: #1976d2; margin-bottom: 0;">
                    <li>Store your coffee in an airtight container</li>
                    <li>Grind beans just before brewing for maximum freshness</li>
                    <li>Use filtered water for the best taste</li>
                    <li>Experiment with different brewing methods</li>
                </ul>
            </div>
            
            <div style="background: #e3f2fd; border: 1px solid #90caf9; padding: 20px; margin: 20px 0; border-radius: 8px;">
                <h3 style="color: #1565c0; margin-top: 0;">🛍️ Shop Again</h3>
                <p style="color: #1565c0;">Ready for your next coffee adventure? Browse our latest collection and discover new flavors.</p>
                <div style="text-align: center;">
                    <a href="${
                      process.env.FRONTEND_URL
                    }/shop" class="button" style="background: #1565c0;">Shop Now</a>
                </div>
            </div>
            
            <p>Thank you for choosing I-COFFEE.NG. We appreciate your business and look forward to serving you again!</p>
            
            <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; margin: 20px 0; border-radius: 6px;">
                <p style="color: #856404; margin-bottom: 0;">
                    <strong>Need Support?</strong><br>
                    If you have any issues with your delivery, please contact us:
                    <br>📧 Email: <a href="mailto:support@i-coffee.ng">support@i-coffee.ng</a>
                    <br>📞 Phone: +234-800-ICOFFEE
                </p>
            </div>
        </div>
        
        <div class="footer">
            <p>&copy; 2025 I-COFFEE.NG - Premium Coffee Delivered</p>
            <p>This is an automated message, please do not reply directly to this email.</p>
        </div>
    </body>
    </html>
  `;
};

// Email sending functions
export const sendOrderConfirmationEmail = async (orderData) => {
  try {
    const {
      user,
      order,
      items,
      shippingAddress,
      shippingMethod,
      trackingNumber,
    } = orderData;

    const emailData = {
      sendTo: user.email,
      subject: `Order Confirmation - ${order.orderId} | I-COFFEE.NG`,
      html: orderConfirmationTemplate({
        customerName: user.name,
        orderId: order.orderId,
        orderDate: order.createdAt,
        items: items.map((item) => ({
          name: item.product_details?.name || item.name,
          image: item.product_details?.image?.[0] || item.image?.[0] || '',
          quantity: item.quantity,
          totalPrice: item.totalAmt,
        })),
        totalAmount: order.totalAmt,
        shippingAddress,
        shippingMethod,
        estimatedDelivery: order.estimated_delivery,
        trackingNumber,
      }),
    };

    return await sendEmail(emailData);
  } catch (error) {
    console.error('Error sending order confirmation email:', error);
    throw error;
  }
};

export const sendShippingNotificationEmail = async (trackingData) => {
  try {
    const { user, order, tracking, latestEvent } = trackingData;

    const emailData = {
      sendTo: user.email || tracking.recipientInfo.email,
      subject: `Shipping Update: ${tracking.status.replace('_', ' ')} - ${
        order.orderId
      } | I-COFFEE.NG`,
      html: shippingNotificationTemplate({
        customerName: user.name || tracking.recipientInfo.name,
        orderId: order.orderId,
        trackingNumber: tracking.trackingNumber,
        status: tracking.status,
        statusDescription: latestEvent.description,
        location: latestEvent.location,
        estimatedDelivery: tracking.estimatedDelivery,
        carrierName: tracking.carrier.name,
        items: order.items || [
          {
            name: order.product_details?.name || 'Coffee Order',
            image: order.product_details?.image?.[0] || '',
            quantity: order.quantity || 1,
          },
        ],
      }),
    };

    return await sendEmail(emailData);
  } catch (error) {
    console.error('Error sending shipping notification email:', error);
    throw error;
  }
};

export const sendDeliveryConfirmationEmail = async (deliveryData) => {
  try {
    const { user, order, tracking } = deliveryData;

    const emailData = {
      sendTo: user.email || tracking.recipientInfo.email,
      subject: `Delivery Confirmed - ${order.orderId} | I-COFFEE.NG`,
      html: deliveryConfirmationTemplate({
        customerName: user.name || tracking.recipientInfo.name,
        orderId: order.orderId,
        trackingNumber: tracking.trackingNumber,
        deliveryDate: tracking.actualDelivery,
        items: order.items || [
          {
            name: order.product_details?.name || 'Coffee Order',
            image: order.product_details?.image?.[0] || '',
            quantity: order.quantity || 1,
          },
        ],
        totalAmount: order.totalAmt,
      }),
    };

    return await sendEmail(emailData);
  } catch (error) {
    console.error('Error sending delivery confirmation email:', error);
    throw error;
  }
};

// Admin notification templates
export const adminShippingAlertTemplate = ({
  alertType,
  orderId,
  trackingNumber,
  issue,
  customerName,
  estimatedDelivery,
}) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Shipping Alert - I-COFFEE.NG Admin</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #f44336; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border: 1px solid #ddd; }
            .alert-box { background: #ffebee; border: 2px solid #f44336; padding: 20px; margin: 20px 0; border-radius: 8px; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>⚠️ Shipping Alert</h1>
            <p>Action Required - I-COFFEE.NG Logistics</p>
        </div>
        
        <div class="content">
            <div class="alert-box">
                <h3>Alert Type: ${alertType}</h3>
                <p><strong>Order ID:</strong> ${orderId}</p>
                <p><strong>Tracking Number:</strong> ${trackingNumber}</p>
                <p><strong>Customer:</strong> ${customerName}</p>
                <p><strong>Issue:</strong> ${issue}</p>
                ${
                  estimatedDelivery
                    ? `<p><strong>Estimated Delivery:</strong> ${new Date(
                        estimatedDelivery
                      ).toLocaleDateString()}</p>`
                    : ''
                }
            </div>
            
            <p>Please review and take appropriate action through the admin dashboard.</p>
            
            <a href="${
              process.env.ADMIN_FRONTEND_URL
            }/tracking" style="display: inline-block; background: #f44336; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px;">
                View in Admin Dashboard
            </a>
        </div>
    </body>
    </html>
  `;
};

export const sendAdminShippingAlert = async (alertData) => {
  try {
    const emailData = {
      sendTo: 'logistics@i-coffee.ng',
      subject: `Shipping Alert: ${alertData.alertType} - ${alertData.orderId}`,
      html: adminShippingAlertTemplate(alertData),
    };

    return await sendEmail(emailData);
  } catch (error) {
    console.error('Error sending admin shipping alert:', error);
    throw error;
  }
};
