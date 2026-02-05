// icvng-server/utils/generateEmailFormTemplate.js

// Generate HTML email template
export function generateEmailHTML(data) {
  const {
    formType,
    name,
    email,
    phone,
    company,
    subject,
    message,
    howDidYouHear,
    preferredContact,
    businessType,
    productCategories,
  } = data;

  const isPartner = formType === "partner";
  const submissionType = isPartner
    ? "PARTNERSHIP APPLICATION"
    : "CONTACT INQUIRY";

  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                line-height: 1.6;
                color: #333;
                max-width: 600px;
                margin: 0 auto;
                padding: 0;
                background-color: #f5f5f5;
            }
            .container {
                background-color: #ffffff;
                margin: 20px auto;
                border-radius: 10px;
                overflow: hidden;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            }
            .header {
                background: linear-gradient(135deg, #15803d 0%, #16a34a 100%);
                color: white;
                padding: 30px;
                text-align: center;
            }
            .header h1 {
                margin: 0 0 10px 0;
                font-size: 24px;
            }
            .submission-type {
                background: #dcfce7;
                color: #15803d;
                padding: 8px 16px;
                border-radius: 20px;
                display: inline-block;
                font-weight: bold;
                font-size: 14px;
            }
            .content {
                padding: 30px;
            }
            .info-section {
                margin-bottom: 20px;
            }
            .info-label {
                font-weight: 600;
                color: #15803d;
                font-size: 13px;
                text-transform: uppercase;
                margin-bottom: 5px;
            }
            .info-value {
                color: #1f2937;
                font-size: 15px;
                padding: 10px 15px;
                background: #f9fafb;
                border-left: 3px solid #16a34a;
                border-radius: 4px;
                word-wrap: break-word;
            }
            .message-box {
                background: #f9fafb;
                padding: 15px;
                border-radius: 8px;
                border: 1px solid #e5e7eb;
                margin-top: 10px;
                white-space: pre-wrap;
                word-wrap: break-word;
            }
            .partner-section {
                background: #dcfce7;
                padding: 20px;
                border-radius: 8px;
                margin: 20px 0;
                border-left: 4px solid #16a34a;
            }
            .partner-section h3 {
                margin-top: 0;
                color: #15803d;
                font-size: 18px;
            }
            .action-box {
                background: #ecfdf5;
                padding: 15px;
                border-radius: 8px;
                border-left: 4px solid #10b981;
                margin-top: 20px;
            }
            .action-box strong {
                color: #065f46;
            }
            .action-box p {
                margin: 10px 0 0 0;
                color: #047857;
            }
            .footer {
                background: #1f2937;
                color: #d1d5db;
                padding: 20px;
                text-align: center;
                font-size: 13px;
            }
            .footer a {
                color: #86efac;
                text-decoration: none;
            }
            .divider {
                height: 1px;
                background: linear-gradient(to right, transparent, #16a34a, transparent);
                margin: 20px 0;
            }
            .optional-badge {
                display: inline-block;
                background: #fef3c7;
                color: #92400e;
                padding: 2px 8px;
                border-radius: 10px;
                font-size: 11px;
                font-weight: bold;
                margin-left: 5px;
            }
            .not-provided {
                color: #9ca3af;
                font-style: italic;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🔔 New Submission from I-Coffee Website</h1>
                <span class="submission-type">${submissionType}</span>
            </div>

            <div class="content">
                <div class="info-section">
                    <div class="info-label">👤 Full Name</div>
                    <div class="info-value">${name}</div>
                </div>

                <div class="info-section">
                    <div class="info-label">📧 Email Address</div>
                    <div class="info-value"><a href="mailto:${email}" style="color: #16a34a; text-decoration: none;">${email}</a></div>
                </div>

                <div class="info-section">
                    <div class="info-label">📱 Phone Number</div>
                    <div class="info-value"><a href="tel:${phone}" style="color: #16a34a; text-decoration: none;">${phone}</a></div>
                </div>

                <div class="info-section">
                    <div class="info-label">🏢 Company/Organization</div>
                    <div class="info-value">${company || '<span class="not-provided">Not provided</span>'}</div>
                </div>

                ${
                  !isPartner && subject
                    ? `
                <div class="info-section">
                    <div class="info-label">📋 Subject</div>
                    <div class="info-value">${subject}</div>
                </div>
                `
                    : ""
                }

                ${
                  isPartner
                    ? `
                <div class="partner-section">
                    <h3>🤝 Partnership Details</h3>
                    <div class="info-section">
                        <div class="info-label">Business Type <span class="optional-badge">OPTIONAL</span></div>
                        <div class="info-value">${businessType || '<span class="not-provided">Not provided</span>'}</div>
                    </div>
                    <div class="info-section">
                        <div class="info-label">Product Categories <span class="optional-badge">OPTIONAL</span></div>
                        <div class="info-value">${productCategories || '<span class="not-provided">Not provided</span>'}</div>
                    </div>
                </div>
                `
                    : ""
                }

                <div class="divider"></div>

                <div class="info-section">
                    <div class="info-label">📢 How They Heard About Us</div>
                    <div class="info-value">${howDidYouHear}</div>
                </div>

                <div class="info-section">
                    <div class="info-label">💬 Preferred Contact Method</div>
                    <div class="info-value" style="text-transform: capitalize;">${preferredContact}</div>
                </div>

                <div class="info-section">
                    <div class="info-label">✉️ Message</div>
                    <div class="message-box">${message}</div>
                </div>

                <div class="action-box">
                    <strong>⏰ Action Required:</strong>
                    <p>
                        ${
                          isPartner
                            ? `Please review this partnership application and respond within 48 hours to: <strong>${email}</strong>`
                            : `Please respond to this inquiry within 24 hours to: <strong>${email}</strong>`
                        }
                    </p>
                </div>
            </div>

            <div class="footer">
                <p style="margin: 0 0 10px 0;"><strong>I-Coffee Nigeria</strong></p>
                <p style="margin: 5px 0;">
                    3 Kaffi Street, Alausa, Ikeja, Lagos | 
                    <a href="tel:+2348039827194">+234 803 982 7194</a>
                </p>
                <p style="margin: 5px 0;">
                    <a href="mailto:${
                      isPartner
                        ? "partners@i-coffee.ng"
                        : "customercare@i-coffee.ng"
                    }">${
                      isPartner
                        ? "partners@i-coffee.ng"
                        : "customercare@i-coffee.ng"
                    }</a> | 
                    <a href="https://i-coffee.ng">www.i-coffee.ng</a>
                </p>
                <p style="margin: 15px 0 5px 0; font-size: 11px; color: #9ca3af;">
                    This email was sent from the I-Coffee contact form. 
                    Form Type: <strong>${formType}</strong> | 
                    Submitted: <strong>${new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}</strong>
                </p>
            </div>
        </div>
    </body>
    </html>
  `;
}

// Generate plain text version
export function generatePlainText(data) {
  const {
    formType,
    name,
    email,
    phone,
    company,
    subject,
    message,
    howDidYouHear,
    preferredContact,
    businessType,
    productCategories,
  } = data;

  const isPartner = formType === "partner";

  return `
New ${isPartner ? "Partnership Application" : "Contact Inquiry"} from I-Coffee Website

============================================
CONTACT INFORMATION:
============================================
Name: ${name}
Email: ${email}
Phone: ${phone}
Company: ${company || "Not provided"}

${!isPartner && subject ? `Subject: ${subject}\n` : ""}

${
  isPartner
    ? `============================================
PARTNERSHIP DETAILS (Optional Fields):
============================================
Business Type: ${businessType || "Not provided"}
Product Categories: ${productCategories || "Not provided"}
`
    : ""
}

============================================
ADDITIONAL INFORMATION:
============================================
How They Heard About Us: ${howDidYouHear}
Preferred Contact Method: ${preferredContact}

============================================
MESSAGE:
============================================
${message}

============================================
ACTION REQUIRED:
============================================
Please respond within ${isPartner ? "48" : "24"} hours
Reply to: ${email}

---
I-Coffee Nigeria
3 Kaffi Street, Alausa, Ikeja, Lagos
+234 803 982 7194
www.i-coffee.ng

Form submitted: ${new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}
  `;
}
