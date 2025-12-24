// src/utils/mailer.js
import nodemailer from "nodemailer";

let cachedTransporter = null;

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  cachedTransporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    requireTLS: true,
    auth: {
      user: process.env.SMTP_USER, // your gmail
      pass: process.env.SMTP_PASS, // app password
    },
    connectionTimeout: 7000,
    greetingTimeout: 7000,
    socketTimeout: 7000,
  });

  return cachedTransporter;
}

export async function sendOtpEmail(toEmail, otpCode) {
  try {
    const transporter = getTransporter();
    await transporter.verify();
    console.log("SMTP verified with Gmail");

    const info = await transporter.sendMail({
      // ⚠️ MUST be exactly your Gmail address
      from: `"LC_Ai" <${process.env.SMTP_USER}>`,
      to: toEmail,
      subject: "Your LC_Ai OTP Code",
      text: `Your OTP is ${otpCode}. It expires in 10 minutes.`,
      html: `
        <div style="font-family:Arial,sans-serif">
          <h2>LC_Ai Verification Code</h2>
          <h1 style="letter-spacing:4px">${otpCode}</h1>
          <p>This code expires in <b>10 minutes</b>.</p>
        </div>
      `,
    });

    console.log("✅ OTP email sent:", info.messageId);
    return info;
  } catch (err) {
    console.error("❌ OTP email failed:", err.message);
    return null;
  }
}
