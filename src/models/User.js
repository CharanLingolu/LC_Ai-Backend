// src/models/User.js
import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    avatar: { type: String },
    provider: { type: String, enum: ["local", "google"], default: "local" },
    passwordHash: { type: String }, // only for local users

    // ✅ OTP verification fields
    isVerified: { type: Boolean, default: false },
    otpCode: { type: String }, // 6-digit code
    otpExpiresAt: { type: Date }, // expiry timestamp

    // OLD password reset fields (kept for backward compatibility)
    resetToken: { type: String, default: undefined },
    resetTokenExpiresAt: { type: Date, default: undefined },

    // NEW (preferred) password reset fields used by routes/authRoutes.js
    // These are intended to store the HASH of the token (sha256 hex)
    resetPasswordToken: { type: String, default: undefined },
    resetPasswordExpiresAt: { type: Date, default: undefined },
  },
  { timestamps: true }
);

/* Optional index to speed up token expiry lookups (won't auto-delete docs) */
userSchema.index({ resetPasswordExpiresAt: 1 });

const User = mongoose.model("User", userSchema);

export default User;
