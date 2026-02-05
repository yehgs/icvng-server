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
        : subject || `📧 New Contact Inquiry - ${name}`;

    // Generate HTML email body
    const htmlBody = generateEmailHTML({
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
    });

    // Email options
    const mailOptions = {
      from: {
        name: "I-Coffee Website",
        address: process.env.GMAIL_USER,
      },
      to: primaryRecipient,
      cc: ccRecipients,
      replyTo: email,
      subject: emailSubject,
      html: htmlBody,
      text: generatePlainText({
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
      }),
    };

    // Send email
    await transporter.sendMail(mailOptions);

    res.status(200).json({
      success: true,
      message: "Email sent successfully",
    });
  } catch (error) {
    console.error("Error sending email:", error);
    res.status(500).json({
      success: false,
      message: "Failed to send email. Please try again later.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
}
