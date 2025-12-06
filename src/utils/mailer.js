import nodemailer from "nodemailer";

export function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export async function sendOtpEmail(toEmail, otpCode) {
  const transporter = createTransporter();

  await transporter.sendMail({
    from: `"LC_Ai" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: "Your LC_Ai OTP Code",
    text: `Your verification code is ${otpCode}.`,
    html: `<h2>Your LC_Ai verification code:</h2><h1>${otpCode}</h1><p>This code expires in 10 minutes.</p>`,
  });
}
