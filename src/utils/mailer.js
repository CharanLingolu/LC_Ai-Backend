// src/utils/mailer.js
import nodemailer from "nodemailer";

/**
 * Create reusable SMTP transporter
 * ✅ Render-safe
 * ✅ Gmail STARTTLS
 * ✅ Short timeouts (prevents request hanging)
 */
export function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false, // MUST be false for port 587
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    requireTLS: true,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 8000,
  });
}

/**
 * Send OTP Email (NON-BLOCKING SAFE VERSION)
 * ⚠️ This function should NOT block API responses
 */
export async function sendOtpEmail(toEmail, otpCode) {
  const transporter = createTransporter();

  const mailOptions = {
    from: `"LC_Ai" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: "Your LC_Ai OTP Code",
    text: `Your verification code is ${otpCode}. It expires in 10 minutes.`,
    html: `
      <div style="font-family:Arial,sans-serif">
        <h2>LC_Ai Verification Code</h2>
        <h1 style="letter-spacing:4px">${otpCode}</h1>
        <p>This code expires in <b>10 minutes</b>.</p>
      </div>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("✅ OTP email sent:", info.messageId || info.response);
    return info;
  } catch (err) {
    // IMPORTANT: do NOT throw — log only
    console.error("❌ OTP email failed:", err.message);
    return null;
  }
}
