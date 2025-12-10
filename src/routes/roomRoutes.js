// src/routes/roomRoutes.js
import express from "express";
import Room from "../models/Room.js";
import Message from "../models/Message.js";

const router = express.Router();

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateInviteLinkId() {
  return Math.random().toString(36).substring(2, 10);
}

// ... your create / join routes stay as they are ...

// ✅ GET /api/rooms/:roomId/messages
router.get("/:roomId/messages", async (req, res) => {
  try {
    const { roomId } = req.params;
    const limit = parseInt(req.query.limit || "200", 10);

    const messages = await Message.find({ room: roomId })
      .sort({ createdAt: 1 })
      .limit(limit);

    res.json(
      messages.map((m) => ({
        _id: m._id,
        roomId: m.room.toString(),
        text: m.content || "", // 👈 always defined
        role: m.role,
        senderUserId: m.senderUser,
        senderGuestName: m.senderGuestName,
        createdAt: m.createdAt,
        reactions: m.reactions || [],
        mediaUrl: m.mediaUrl || null, // 👈 include media
        mediaType: m.mediaType || null, // 👈 include media
      }))
    );
  } catch (err) {
    console.error("Fetch messages error:", err.message);
    res.status(500).json({ error: "Failed to load room messages" });
  }
});

export default router;
