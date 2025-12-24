// src/utils/mailer.js
import nodemailer from "nodemailer";

let transporter;

function getTransporter() {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: 587,
    secure: false,
    requireTLS: true,
    auth: {
      user: process.env.SMTP_USER, // MUST be "apikey"
      pass: process.env.SMTP_PASS,
    },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 8000,
  });

  return transporter;
}

export async function sendOtpEmail(toEmail, otpCode) {
  try {
    const mailer = getTransporter();

    const info = await mailer.sendMail({
      from: `"LC_Ai" <${process.env.SMTP_FROM}>`,
      to: toEmail,
      subject: "Your LC_Ai OTP Code",
      text: `Your OTP is ${otpCode}. It expires in 10 minutes.`,
      html: `
        <h2>LC_Ai Verification Code</h2>
        <h1>${otpCode}</h1>
        <p>Expires in 10 minutes.</p>
      `,
    });

    console.log("✅ OTP email sent:", info.messageId);
    return info;
  } catch (err) {
    console.error("❌ OTP email failed:", err.message);
    return null;
  }
}
