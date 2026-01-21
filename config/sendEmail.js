//server
//config/sendEmail.js
import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD) {
  console.log("Provide EMAIL_USER and EMAIL_APP_PASSWORD in the .env file");
}

// Create reusable transporter using Gmail
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

// Verify transporter configuration
transporter.verify((error, success) => {
  if (error) {
    console.error("Email transporter error:", error);
  } else {
    console.log("Server is ready to send emails");
  }
});

const sendEmail = async ({ sendTo, subject, html }) => {
  try {
    const info = await transporter.sendMail({
      from: `"Femi" <${process.env.EMAIL_USER}>`, // sender address
      to: sendTo, // list of receivers
      subject: subject, // Subject line
      html: html, // html body
    });

    console.log("Message sent: %s", info.messageId);
    return info;
  } catch (error) {
    console.error("Error sending email:", error);
    throw error;
  }
};

export default sendEmail;
