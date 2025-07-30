// utils/invoiceTemplate.js
export const generateInvoiceTemplate = ({
  order,
  customer,
  items,
  salesAgent,
}) => {
  // Company information - update these constants as needed
  const COMPANY_INFO = {
    name: 'I-Coffee Nigeria Limited',
    address: '4 Kafi Street, Alausa, Ikeja, Lagos State.',
    city: 'Lagos, Nigeria',
    phone: '+234-800-ICOFFEE',
    email: 'sales@i-coffee.ng',
    website: 'www.i-coffee.ng',
    taxNumber: 'TIN: 12345678901',
    rcNumber: 'RC: 1234567',
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
    }).format(amount);
  };

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const itemsHTML = items
    .map(
      (item, index) => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center;">${
        index + 1
      }</td>
      <td style="padding: 12px; border-bottom: 1px solid #eee;">
        <div style="font-weight: 600; color: #333; margin-bottom: 4px;">${
          item.productName
        }</div>
        ${
          item.priceOption !== 'regular'
            ? `<div style="font-size: 12px; color: #666;">${item.priceOption} delivery</div>`
            : ''
        }
      </td>
      <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center;">${
        item.quantity
      }</td>
      <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">${formatCurrency(
        item.unitPrice
      )}</td>
      <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${formatCurrency(
        item.totalPrice
      )}</td>
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
        <title>Invoice ${order.invoiceNumber}</title>
        <style>
            body { 
                font-family: 'Arial', sans-serif; 
                line-height: 1.6; 
                color: #333; 
                max-width: 800px; 
                margin: 0 auto; 
                padding: 20px;
                background-color: #f9f9f9;
            }
            .invoice-container {
                background: white;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                overflow: hidden;
            }
            .header { 
                background: linear-gradient(135deg, #8B4513, #D2691E); 
                color: white; 
                padding: 30px; 
                text-align: center; 
            }
            .company-info {
                background: #f8f9fa;
                padding: 20px;
                border-bottom: 2px solid #8B4513;
            }
            .invoice-details {
                padding: 30px;
            }
            .info-section {
                display: flex;
                justify-content: space-between;
                margin-bottom: 30px;
                gap: 30px;
            }
            .info-box {
                flex: 1;
                background: #f8f9fa;
                padding: 20px;
                border-radius: 6px;
                border-left: 4px solid #8B4513;
            }
            .table-container {
                overflow-x: auto;
                margin: 30px 0;
            }
            .items-table {
                width: 100%;
                border-collapse: collapse;
                background: white;
                border-radius: 6px;
                overflow: hidden;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            }
            .items-table th {
                background: #8B4513;
                color: white;
                padding: 15px 12px;
                text-align: left;
                font-weight: 600;
            }
            .totals-section {
                background: #f8f9fa;
                padding: 25px;
                border-radius: 6px;
                margin-top: 30px;
            }
            .total-row {
                display: flex;
                justify-content: space-between;
                padding: 8px 0;
                border-bottom: 1px solid #ddd;
            }
            .total-row.final {
                border-bottom: none;
                border-top: 2px solid #8B4513;
                font-size: 18px;
                font-weight: bold;
                color: #8B4513;
                padding-top: 15px;
                margin-top: 10px;
            }
            .footer {
                background: #333;
                color: white;
                padding: 25px;
                text-align: center;
            }
            .payment-info {
                background: #e8f5e8;
                border: 2px solid #4CAF50;
                padding: 20px;
                border-radius: 6px;
                margin: 20px 0;
            }
            .status-badge {
                display: inline-block;
                padding: 6px 12px;
                border-radius: 20px;
                font-size: 12px;
                font-weight: bold;
                text-transform: uppercase;
            }
            .status-pending { background: #fff3cd; color: #856404; }
            .status-paid { background: #d4edda; color: #155724; }
            .status-delivered { background: #cce5ff; color: #004085; }
            
            @media (max-width: 600px) {
                .info-section { flex-direction: column; }
                .invoice-details { padding: 20px; }
                .items-table { font-size: 14px; }
                .items-table th, .items-table td { padding: 8px 6px; }
            }
        </style>
    </head>
    <body>
        <div class="invoice-container">
            <!-- Header -->
            <div class="header">
                <h1 style="margin: 0; font-size: 28px;">INVOICE</h1>
                <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Premium Coffee Solutions</p>
            </div>
            
            <!-- Company Information -->
            <div class="company-info">
                <div style="display: flex; justify-content: space-between; align-items: start; flex-wrap: wrap; gap: 20px;">
                    <div>
                        <h2 style="margin: 0 0 10px 0; color: #8B4513; font-size: 24px;">${
                          COMPANY_INFO.name
                        }</h2>
                        <p style="margin: 0; line-height: 1.5;">
                            ${COMPANY_INFO.address}<br>
                            ${COMPANY_INFO.city}<br>
                            📞 ${COMPANY_INFO.phone}<br>
                            ✉️ ${COMPANY_INFO.email}<br>
                            🌐 ${COMPANY_INFO.website}
                        </p>
                    </div>
                    <div style="text-align: right;">
                        <div style="background: white; padding: 15px; border-radius: 6px; border: 2px solid #8B4513;">
                            <h3 style="margin: 0 0 10px 0; color: #8B4513;">Invoice #${
                              order.invoiceNumber
                            }</h3>
                            <p style="margin: 0; font-size: 14px;">
                                <strong>Date:</strong> ${formatDate(
                                  order.invoiceDate || order.createdAt
                                )}<br>
                                <strong>Order ID:</strong> ${order.orderId}<br>
                                ${COMPANY_INFO.taxNumber}<br>
                                ${COMPANY_INFO.rcNumber}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Invoice Details -->
            <div class="invoice-details">
                <!-- Customer and Order Information -->
                <div class="info-section">
                    <div class="info-box">
                        <h4 style="margin: 0 0 15px 0; color: #8B4513; border-bottom: 2px solid #8B4513; padding-bottom: 8px;">Bill To:</h4>
                        <p style="margin: 0; font-size: 16px; line-height: 1.6;">
                            <strong>${
                              customer.customerType === 'BTB' &&
                              customer.companyName
                                ? customer.companyName
                                : customer.name
                            }</strong><br>
                            ${
                              customer.customerType === 'BTB' &&
                              customer.companyName
                                ? `Contact: ${customer.name}<br>`
                                : ''
                            }
                            📧 ${customer.email}<br>
                            📱 ${customer.mobile}<br>
                            ${
                              customer.address
                                ? `📍 ${customer.address.street || ''}, ${
                                    customer.address.city || ''
                                  }, ${customer.address.state || ''}`
                                : ''
                            }
                            ${
                              customer.customerType === 'BTB' &&
                              customer.taxNumber
                                ? `<br>Tax ID: ${customer.taxNumber}`
                                : ''
                            }
                        </p>
                    </div>
                    
                    <div class="info-box">
                        <h4 style="margin: 0 0 15px 0; color: #8B4513; border-bottom: 2px solid #8B4513; padding-bottom: 8px;">Order Details:</h4>
                        <p style="margin: 0; font-size: 14px; line-height: 1.8;">
                            <strong>Order Type:</strong> 
                            <span class="status-badge" style="background: ${
                              order.orderType === 'BTB' ? '#e3f2fd' : '#f3e5f5'
                            }; color: ${
    order.orderType === 'BTB' ? '#1565c0' : '#7b1fa2'
  };">
                                ${order.orderType}
                            </span><br>
                            
                            <strong>Order Mode:</strong> 
                            <span class="status-badge" style="background: ${
                              order.orderMode === 'ONLINE'
                                ? '#e8f5e8'
                                : '#fff3e0'
                            }; color: ${
    order.orderMode === 'ONLINE' ? '#2e7d32' : '#ef6c00'
  };">
                                ${order.orderMode}
                            </span><br>
                            
                            <strong>Order Status:</strong>
                            <span class="status-badge status-${
                              order.orderStatus === 'DELIVERED'
                                ? 'delivered'
                                : order.orderStatus === 'PENDING'
                                ? 'pending'
                                : 'paid'
                            }">
                                ${order.orderStatus}
                            </span><br>
                            
                            <strong>Payment Status:</strong>
                            <span class="status-badge status-${
                              order.paymentStatus === 'PAID'
                                ? 'paid'
                                : 'pending'
                            }">
                                ${order.paymentStatus}
                            </span><br>
                            
                            <strong>Payment Method:</strong> ${
                              order.paymentMethod
                            }<br>
                            ${
                              salesAgent
                                ? `<strong>Sales Agent:</strong> ${salesAgent.name}`
                                : ''
                            }
                            ${
                              order.isWebsiteOrder
                                ? `<br><strong>Source:</strong> Website Order`
                                : ''
                            }
                        </p>
                    </div>
                </div>
                
                <!-- Items Table -->
                <div class="table-container">
                    <table class="items-table">
                        <thead>
                            <tr>
                                <th style="width: 50px;">#</th>
                                <th>Product</th>
                                <th style="width: 80px; text-align: center;">Qty</th>
                                <th style="width: 120px; text-align: right;">Unit Price</th>
                                <th style="width: 120px; text-align: right;">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemsHTML}
                        </tbody>
                    </table>
                </div>
                
                <!-- Totals Section -->
                <div class="totals-section">
                    <h4 style="margin: 0 0 20px 0; color: #8B4513;">Order Summary</h4>
                    
                    <div class="total-row">
                        <span>Subtotal:</span>
                        <span>${formatCurrency(order.subTotal)}</span>
                    </div>
                    
                    ${
                      order.discountAmount > 0
                        ? `
                    <div class="total-row">
                        <span>Discount:</span>
                        <span style="color: #d32f2f;">-${formatCurrency(
                          order.discountAmount
                        )}</span>
                    </div>
                    `
                        : ''
                    }
                    
                    ${
                      order.taxAmount > 0
                        ? `
                    <div class="total-row">
                        <span>Tax (VAT):</span>
                        <span>${formatCurrency(order.taxAmount)}</span>
                    </div>
                    `
                        : ''
                    }
                    
                    ${
                      order.shippingCost > 0
                        ? `
                    <div class="total-row">
                        <span>Shipping:</span>
                        <span>${formatCurrency(order.shippingCost)}</span>
                    </div>
                    `
                        : ''
                    }
                    
                    <div class="total-row final">
                        <span>TOTAL AMOUNT:</span>
                        <span>${formatCurrency(order.totalAmount)}</span>
                    </div>
                </div>
                
                <!-- Payment Information -->
                ${
                  order.paymentStatus === 'PENDING'
                    ? `
                <div class="payment-info">
                    <h4 style="margin: 0 0 15px 0; color: #2e7d32;">💳 Payment Information</h4>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                        <div>
                            <p style="margin: 0 0 10px 0;"><strong>Bank Name:</strong> First Bank of Nigeria</p>
                            <p style="margin: 0 0 10px 0;"><strong>Account Name:</strong> I-Coffee Nigeria Limited</p>
                            <p style="margin: 0 0 10px 0;"><strong>Account Number:</strong> 2013456789</p>
                        </div>
                        <div>
                            <p style="margin: 0 0 10px 0;"><strong>Sort Code:</strong> 011</p>
                            <p style="margin: 0 0 10px 0;"><strong>Amount to Pay:</strong> ${formatCurrency(
                              order.totalAmount
                            )}</p>
                            <p style="margin: 0;"><strong>Reference:</strong> ${
                              order.orderId
                            }</p>
                        </div>
                    </div>
                    <p style="margin: 15px 0 0 0; padding: 10px; background: #fff3cd; border-radius: 4px; font-size: 14px;">
                        <strong>Note:</strong> Please use the order ID as your payment reference and send payment confirmation to ${
                          COMPANY_INFO.email
                        }
                    </p>
                </div>
                `
                    : ''
                }
                
                <!-- Order Notes -->
                ${
                  order.notes || order.customerNotes
                    ? `
                <div style="background: #f8f9fa; padding: 20px; border-radius: 6px; margin-top: 20px;">
                    <h4 style="margin: 0 0 10px 0; color: #8B4513;">📝 Additional Notes</h4>
                    ${
                      order.notes
                        ? `<p style="margin: 0 0 10px 0;"><strong>Internal Notes:</strong> ${order.notes}</p>`
                        : ''
                    }
                    ${
                      order.customerNotes
                        ? `<p style="margin: 0;"><strong>Customer Notes:</strong> ${order.customerNotes}</p>`
                        : ''
                    }
                </div>
                `
                    : ''
                }
                
                <!-- Terms and Conditions -->
                <div style="background: #f8f9fa; padding: 20px; border-radius: 6px; margin-top: 30px; font-size: 12px; color: #666;">
                    <h4 style="margin: 0 0 10px 0; color: #8B4513;">Terms & Conditions</h4>
                    <ul style="margin: 0; padding-left: 20px; line-height: 1.6;">
                        <li>Payment is due within 30 days of invoice date</li>
                        <li>Delivery charges may apply based on location</li>
                        <li>Returns accepted within 7 days of delivery for unopened products</li>
                        <li>All prices are inclusive of applicable taxes</li>
                        <li>For any queries, please contact us at ${
                          COMPANY_INFO.email
                        }</li>
                    </ul>
                </div>
            </div>
            
            <!-- Footer -->
            <div class="footer">
                <p style="margin: 0 0 10px 0; font-size: 16px; font-weight: bold;">Thank you for choosing I-Coffee Nigeria!</p>
                <p style="margin: 0; font-size: 14px; opacity: 0.8;">
                    Premium coffee solutions for your business and home | 
                    Follow us on social media @icoffeeng | 
                    Visit our website: ${COMPANY_INFO.website}
                </p>
                <p style="margin: 15px 0 0 0; font-size: 12px; opacity: 0.7;">
                    This is a computer-generated invoice. No signature required.
                </p>
            </div>
        </div>
    </body>
    </html>
  `;
};
