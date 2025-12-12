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

router.post("/join", async (req, res) => {
  try {
    const { code, userId, userName } = req.body;
    if (!code) return res.status(400).json({ error: "Missing room code" });

    const trimmedCode = String(code).trim();
    const trimmedName = userName
      ? String(userName).trim().slice(0, 64)
      : "Guest";

    // Pick canonical member id: prefer explicit userId, otherwise use name-based guest id
    const memberId = userId ? String(userId) : `guest_${Date.now()}`;

    // Atomic update: add member only if not already present using $addToSet.
    // We store minimal member structure and return the updated document.
    const update = {
      $setOnInsert: { code: trimmedCode }, // in case of odd inserts (defensive)
      $addToSet: {
        members: { id: memberId, name: trimmedName, role: "member" },
      },
    };

    // Use findOneAndUpdate atomically and return the new doc
    const updated = await Room.findOneAndUpdate({ code: trimmedCode }, update, {
      new: true,
      runValidators: true,
    }).lean();

    if (!updated) {
      return res.status(404).json({ error: "Room not found" });
    }

    // Normalize id
    const outRoom = {
      id: updated.id || updated._id?.toString() || String(updated.code),
      name: updated.name,
      code: updated.code,
      ownerId: updated.ownerId,
      allowAI: !!updated.allowAI,
      members: Array.isArray(updated.members) ? updated.members : [],
      onlineCount: updated.onlineCount || 0,
      // include other safe fields you want clients to see
    };

    // Broadcast only the updated room (sanitized) to reduce bandwidth/leak
    try {
      const io = req.app?.get?.("io");
      if (io) {
        io.emit("room_joined", {
          room: outRoom,
          joinedUser: { id: memberId, name: trimmedName },
        });

        // optionally: emit room_list_update for this single room
        io.emit("room_list_update", [outRoom]);
      }
    } catch (e) {
      console.warn("Emit failed:", e?.message || e);
    }

    return res.json(outRoom);
  } catch (err) {
    console.error("POST /api/rooms/join error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ------------------ existing messages route ------------------
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
