// routes/authRoutes.js
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
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
      console.error("Failed to send OTP email:", mailErr.message);
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

export default router;
