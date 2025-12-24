// src/utils/mailer.js
import nodemailer from "nodemailer";

export function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false, // 🚨 MUST be false for 587
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 20000,
  });
}

export async function sendOtpEmail(toEmail, otpCode) {
  const transporter = createTransporter();

  const withTimeout = (p, ms, message = "Operation timed out") =>
    Promise.race([
      p,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(message)), ms)
      ),
    ]);

  const mailOptions = {
    from: `"LC_Ai" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: "Your LC_Ai OTP Code",
    text: `Your verification code is ${otpCode}.`,
    html: `
      <div style="font-family:Arial,sans-serif">
        <h2>LC_Ai Verification Code</h2>
        <h1 style="letter-spacing:4px">${otpCode}</h1>
        <p>This code expires in 10 minutes.</p>
      </div>
    `,
  };

  try {
    const info = await withTimeout(
      transporter.sendMail(mailOptions),
      15000,
      "SMTP sendMail timed out"
    );

    console.log("✅ Mail sent:", info?.messageId || info?.response);
    return info;
  } catch (err) {
    console.error("❌ Failed to send OTP email:", err?.message || err);
    throw err;
  }
}
