// src/routes/streamRoutes.js
import express from "express";
import { StreamClient } from "@stream-io/node-sdk";

const router = express.Router();

const STREAM_API_KEY = process.env.STREAM_API_KEY;
const STREAM_SECRET_KEY = process.env.STREAM_SECRET_KEY;

if (!STREAM_API_KEY || !STREAM_SECRET_KEY) {
  console.warn(
    "⚠️ [Stream] Missing STREAM_API_KEY or STREAM_SECRET_KEY in .env!"
  );
}

// Only create client if keys exist
const streamClient =
  STREAM_API_KEY && STREAM_SECRET_KEY
    ? new StreamClient(STREAM_API_KEY, STREAM_SECRET_KEY)
    : null;

// POST /api/stream/token
router.post("/token", async (req, res) => {
  try {
    if (!streamClient) {
      return res
        .status(500)
        .json({ error: "Stream client not configured on server." });
    }

    const { userId, name } = req.body || {};

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    // ✅ IMPORTANT: token method expects a plain string userId
    // Depending on SDK version this is usually `createToken(userId)` or `generateUserToken(userId)`
    // If one throws / isn't defined, try the other.
    let token;
    if (typeof streamClient.createToken === "function") {
      token = streamClient.createToken(userId);
    } else if (typeof streamClient.generateUserToken === "function") {
      token = streamClient.generateUserToken(userId);
    } else {
      return res
        .status(500)
        .json({ error: "No token generation method found on Stream client." });
    }

    return res.json({
      token,
      userId,
      name: name || userId,
    });
  } catch (err) {
    console.error("❌ [Stream] token error:", err);
    res.status(500).json({ error: "Failed to generate token" });
  }
});

export default router;
