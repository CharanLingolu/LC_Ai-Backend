// src/utils/mailer.js
import nodemailer from "nodemailer";

/**
 * Create nodemailer transporter.
 * Keep secure:false for port 587, and set reasonable connection timeouts.
 */
export function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false, // use TLS via STARTTLS on port 587
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    // timeouts (ms) — fail fast if the server is not reachable
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
    // helpful when TLS cert validation causes issues in dev
    tls: {
      rejectUnauthorized: false,
    },
  });
}

/**
 * sendOtpEmail(toEmail, otpCode)
 * - Verifies transporter (quick auth check)
 * - Sends mail but fails after a timeout to avoid frontend hanging forever
 */
export async function sendOtpEmail(toEmail, otpCode) {
  const transporter = createTransporter();

  // helper to timeout a promise
  const withTimeout = (p, ms, message = "Operation timed out") =>
    Promise.race([
      p,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(message)), ms)
      ),
    ]);

  try {
    // verify connection/auth first (will throw if credentials invalid)
    // verify normally returns quickly if auth fails
    await withTimeout(transporter.verify(), 8000, "SMTP verify timed out");
  } catch (err) {
    console.error(
      "SMTP verify failed:",
      err && err.message ? err.message : err
    );
    // rethrow so caller (route) will fall back to dev token
    throw err;
  }

  const mailOptions = {
    from: `"LC_Ai" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: "Your LC_Ai OTP Code",
    text: `Your verification code is ${otpCode}.`,
    html: `<h2>Your LC_Ai verification code:</h2><h1>${otpCode}</h1><p>This code expires in 10 minutes.</p>`,
  };

  try {
    // sendMail can hang in bad network conditions, so timeout it
    const info = await withTimeout(
      transporter.sendMail(mailOptions),
      10000,
      "SMTP sendMail timed out"
    );

    console.log("Mail sent:", info?.messageId || info?.response || "(no id)");
    return info;
  } catch (err) {
    console.error(
      "Failed to send OTP email:",
      err && err.message ? err.message : err
    );
    // rethrow so the route will return dev token fallback
    throw err;
  }
}
