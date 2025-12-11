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

    // ✅ Password reset fields (used by /password-reset endpoints)
    resetToken: { type: String, default: undefined },
    resetTokenExpiresAt: { type: Date, default: undefined },
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

export default User;
