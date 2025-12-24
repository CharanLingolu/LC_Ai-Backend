// src/utils/mailer.js
import axios from "axios";

/**
 * Sends OTP via Brevo HTTP API (NO SMTP)
 * Returns true on success, false on failure
 */
export async function sendOtpEmail(toEmail, otpCode) {
  try {
    const res = await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: {
          name: "LC_Ai",
          email: process.env.SMTP_FROM, // must be verified in Brevo
        },
        to: [{ email: toEmail }],
        subject: "Your LC_Ai OTP Code",
        htmlContent: `
          <div style="font-family:Arial,sans-serif">
            <h2>LC_Ai Verification Code</h2>
            <h1>${otpCode}</h1>
            <p>This code expires in 10 minutes.</p>
          </div>
        `,
      },
      {
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "content-type": "application/json",
        },
        timeout: 15000,
      }
    );

    console.log("✅ OTP email sent via Brevo API:", res.data?.messageId);
    return true;
  } catch (err) {
    console.error(
      "❌ OTP email failed via Brevo API:",
      err.response?.data || err.message
    );
    return false;
  }
}
