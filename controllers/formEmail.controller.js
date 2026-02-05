// icvng-server/controllers/formEmail.controller.js
import {
  generateEmailHTML,
  generatePlainText,
} from "../utils/generateEmailFormTemplate.js";
import { transporter } from "../utils/nodemailer.js";

export async function formEmailController(req, res) {
  try {
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
    } = req.body;

    // Validate required fields
    if (!name || !email || !phone || !message || !howDidYouHear) {
      return res.status(400).json({
        success: false,
        message: "Please fill in all required fields",
        error: true,
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address",
        error: true,
      });
    }

    // Validate form type
    if (formType !== "partner" && formType !== "contact") {
      return res.status(400).json({
        success: false,
        message: "Invalid form type",
        error: true,
      });
    }

    // For contact form, subject is required
    if (formType === "contact" && !subject) {
      return res.status(400).json({
        success: false,
        message: "Subject is required for contact inquiries",
        error: true,
      });
    }

    // Determine primary recipient based on form type
    const primaryRecipient =
      formType === "partner"
        ? "partners@i-coffee.ng"
        : "customercare@i-coffee.ng";

    // CC recipients
    const ccRecipients = [
      "webmaster@yehgs.co.uk",
      "md@yehgs.co.uk",
      "md@i-coffee.ng",
      "admin@yehgs.co.uk",
    ];

    // Generate email subject
    const emailSubject =
      formType === "partner"
        ? `🤝 New Partnership Application - ${name}`
        : `📧 ${subject || "Contact Inquiry"} - ${name}`;

    // Prepare data for email templates
    const emailData = {
      formType,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      company: company?.trim() || "",
      subject: subject?.trim() || "",
      message: message.trim(),
      howDidYouHear: howDidYouHear.trim(),
      preferredContact: preferredContact || "email",
      // Optional fields - handle empty strings
      businessType: businessType?.trim() || "",
      productCategories: productCategories?.trim() || "",
    };

    // Generate HTML email body
    const htmlBody = generateEmailHTML(emailData);

    // Generate plain text email body
    const textBody = generatePlainText(emailData);

    // Email options
    const mailOptions = {
      from: {
        name: "I-Coffee Website",
        address: process.env.EMAIL_USER,
      },
      to: primaryRecipient,
      cc: ccRecipients,
      replyTo: emailData.email,
      subject: emailSubject,
      html: htmlBody,
      text: textBody,
    };

    // Send email
    const info = await transporter.sendMail(mailOptions);

    console.log("Email sent successfully:", {
      messageId: info.messageId,
      formType,
      recipient: primaryRecipient,
      from: emailData.email,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      success: true,
      message:
        formType === "partner"
          ? "Partnership application submitted successfully"
          : "Message sent successfully",
      error: false,
    });
  } catch (error) {
    console.error("Error sending email:", error);

    // Detailed error logging for debugging
    console.error("Email error details:", {
      error: error.message,
      code: error.code,
      command: error.command,
      response: error.response,
      responseCode: error.responseCode,
    });

    res.status(500).json({
      success: false,
      message: "Failed to send email. Please try again later.",
      error: true,
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
}
