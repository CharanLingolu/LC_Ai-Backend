// src/utils/mailer.js
import nodemailer from "nodemailer";

let transporter;

function getTransporter() {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST, // smtp-relay.brevo.com
    port: 587,
    secure: false,
    requireTLS: true,
    auth: {
      user: process.env.SMTP_USER, // apikey
      pass: process.env.SMTP_PASS, // Brevo SMTP key
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
    return null; // never crash API
  }
}
