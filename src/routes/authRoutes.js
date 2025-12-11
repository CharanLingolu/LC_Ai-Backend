// src/routes/authRoutes.js
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import User from "../models/User.js";
import { generateOtpCode } from "../utils/otp.js";
import { sendOtpEmail } from "../utils/mailer.js";

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { userId: user._id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

// --------------- STEP 1: Signup - Request OTP ---------------
router.post("/signup/request-otp", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ error: "Name, email and password are required" });
    }

    let user = await User.findOne({ email });

    if (user && user.isVerified) {
      return res
        .status(400)
        .json({ error: "Email is already registered and verified" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const otpCode = generateOtpCode();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    if (!user) {
      user = await User.create({
        name,
        email,
        passwordHash,
        provider: "local",
        isVerified: false,
        otpCode,
        otpExpiresAt,
      });
    } else {
      user.name = name;
      user.passwordHash = passwordHash;
      user.otpCode = otpCode;
      user.otpExpiresAt = otpExpiresAt;
      await user.save();
    }

    try {
      await sendOtpEmail(email, otpCode);
    } catch (mailErr) {
      console.error("Failed to send OTP email:", mailErr?.message || mailErr);
      // return dev OTP so signup flow can be tested locally
      return res.json({
        message: "OTP generated (email failed). Using dev mode.",
        devOtp: otpCode,
      });
    }

    res.json({ message: "OTP sent to your email" });
  } catch (err) {
    console.error("Signup request-otp error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// --------------- STEP 2: Signup - Verify OTP ---------------
router.post("/signup/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ error: "Email and OTP are required" });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({ error: "User not found" });
    }

    if (!user.otpCode || !user.otpExpiresAt) {
      return res.status(400).json({ error: "No OTP requested" });
    }

    if (user.otpCode !== otp) {
      return res.status(400).json({ error: "Invalid OTP" });
    }

    if (user.otpExpiresAt < new Date()) {
      return res.status(400).json({ error: "OTP expired" });
    }

    user.isVerified = true;
    user.otpCode = undefined;
    user.otpExpiresAt = undefined;
    await user.save();

    const token = signToken(user);

    res.json({
      token,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        provider: user.provider,
      },
    });
  } catch (err) {
    console.error("Verify OTP error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// --------------- LOGIN (email/password) ---------------
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    if (user.provider !== "local") {
      return res.status(400).json({
        error:
          user.provider === "google"
            ? "Please sign in with Google"
            : "Use your original sign-in method",
      });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(400).json({ error: "Invalid credentials" });

    if (!user.isVerified)
      return res.status(403).json({ error: "Email not verified" });

    const token = signToken(user);

    res.json({
      token,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        provider: user.provider,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// --------------- GOOGLE LOGIN (no OTP needed) ---------------
router.post("/google", async (req, res) => {
  try {
    const { email, name, picture } = req.body;

    if (!email) {
      return res
        .status(400)
        .json({ error: "Email is required from Google profile" });
    }

    let user = await User.findOne({ email });

    if (!user) {
      user = await User.create({
        name: name || email.split("@")[0],
        email,
        avatar: picture,
        provider: "google",
        isVerified: true, // consider Google email as verified
      });
    } else {
      if (user.provider !== "google") user.provider = "google";
      if (picture && user.avatar !== picture) user.avatar = picture;
      if (!user.isVerified) user.isVerified = true;
      await user.save();
    }

    const token = signToken(user);

    res.json({
      token,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        provider: user.provider,
      },
    });
  } catch (err) {
    console.error("Google auth error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// --------------- PASSWORD RESET (request + confirm) ---------------

/**
 * POST /api/auth/password-reset/request
 * - Accepts { email }
 * - Generates a short numeric OTP (6 digits), stores a SHA256 hash in DB and an expiry (10 minutes)
 * - Sends raw OTP to user's email via sendOtpEmail
 * - For dev (mail not delivered) returns devResetToken so you can test
 */
router.post("/password-reset/request", async (req, res) => {
  try {
    const { email } = req.body || {};
    console.log(
      "➡️ [PASSWORD RESET REQUEST] body:",
      JSON.stringify(req.body).slice(0, 1000)
    );

    if (!email) {
      console.log("↩️ [PASSWORD RESET] missing email");
      return res.status(400).json({ ok: false, error: "Email is required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      // Do not reveal existence — still return OK
      console.log("↩️ [PASSWORD RESET] user not found for:", email);
      return res.json({
        ok: true,
        message: "If an account exists, password reset instructions were sent.",
      });
    }

    // generate a user-friendly 6-digit OTP
    const rawToken = generateOtpCode(); // expects your util returns 6-digit string
    const hashedToken = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // store hashed token, expiry and reset attempt metadata
    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpiresAt = expiresAt;
    user.resetAttempts = 0;
    user.resetLockedUntil = undefined;
    await user.save();

    try {
      await sendOtpEmail(email, rawToken);
      console.log("✅ [PASSWORD RESET] email (OTP) sent to:", email);
      return res.json({
        ok: true,
        message: "Password reset token sent to email.",
      });
    } catch (mailErr) {
      // Mail failed — log and return dev token so frontend can continue testing
      console.error(
        "❌ [PASSWORD RESET] sendOtpEmail failed:",
        mailErr && mailErr.message ? mailErr.message : mailErr
      );
      return res.json({
        ok: true,
        message: "Reset token generated (email failed). Use dev token.",
        devResetToken: rawToken,
      });
    }
  } catch (err) {
    console.error(
      "❌ [PASSWORD RESET] error:",
      err && err.stack ? err.stack : err
    );
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/**
 * POST /api/auth/password-reset/confirm
 * - Accepts { email, token, newPassword }
 * - Validates attempts/lockouts, hashes token and finds user by hashed token + expiry
 * - Replaces passwordHash and clears reset fields
 * - Returns a new JWT + user object (auto-login)
 *
 * Attempt-limiting:
 * - up to 5 failed attempts, then lock for 15 minutes.
 */
router.post("/password-reset/confirm", async (req, res) => {
  try {
    const { email, token, newPassword } = req.body || {};
    if (!email || !token || !newPassword) {
      return res
        .status(400)
        .json({ error: "Email, token and new password are required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      // avoid revealing existence
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    // Check lockout
    if (user.resetLockedUntil && user.resetLockedUntil > new Date()) {
      const mins = Math.ceil((user.resetLockedUntil - new Date()) / 60000);
      return res
        .status(429)
        .json({ error: `Too many attempts. Try again in ${mins} minute(s).` });
    }

    // hash provided token and lookup
    const hashedProvided = crypto
      .createHash("sha256")
      .update(String(token))
      .digest("hex");

    // ensure token and expiry match
    const tokenMatches =
      user.resetPasswordToken && user.resetPasswordToken === hashedProvided;
    const notExpired =
      user.resetPasswordExpiresAt && user.resetPasswordExpiresAt > new Date();

    if (!tokenMatches || !notExpired) {
      // increment attempts and possibly lock
      user.resetAttempts = (user.resetAttempts || 0) + 1;

      // If attempts exceed limit, lock for 15 minutes
      const MAX_ATTEMPTS = 5;
      if (user.resetAttempts >= MAX_ATTEMPTS) {
        user.resetLockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes lock
        user.resetAttempts = 0; // reset attempts counter after locking
        await user.save();
        return res
          .status(429)
          .json({ error: "Too many invalid attempts. Try again later." });
      }

      await user.save();
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    // Valid token: update password and clear reset fields
    const passwordHash = await bcrypt.hash(newPassword, 10);
    user.passwordHash = passwordHash;

    user.resetPasswordToken = undefined;
    user.resetPasswordExpiresAt = undefined;
    user.resetAttempts = 0;
    user.resetLockedUntil = undefined;

    if (!user.isVerified) user.isVerified = true;

    await user.save();

    const tokenJwt = signToken(user);

    return res.json({
      message: "Password updated successfully",
      token: tokenJwt,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        provider: user.provider,
      },
    });
  } catch (err) {
    console.error("password-reset/confirm error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
