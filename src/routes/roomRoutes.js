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

/**
 * POST /api/rooms/join
 * body: { code, userId, userName }
 *
 * Finds room by code, adds user as member if not present, saves and returns updated room.
 */
router.post("/join", async (req, res) => {
  try {
    const { code, userId, userName } = req.body;

    if (!code) {
      return res.status(400).json({ error: "Missing room code" });
    }

    // Find room by code (code may be number or string in DB)
    const room = await Room.findOne({ code: String(code) }).exec();
    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    // Ensure members array exists
    room.members = Array.isArray(room.members) ? room.members : [];

    // Determine unique identifier for member: prefer userId, then email in userId, else generated
    const memberId =
      userId || (userName ? `${userName}` : `guest_${Date.now()}`);

    // Avoid duplicates: match by id or email-like id
    const alreadyMember = room.members.some((m) => {
      try {
        return String(m.id) === String(memberId);
      } catch {
        return false;
      }
    });

    if (!alreadyMember) {
      room.members.push({
        id: memberId,
        name: userName || "Guest",
        role: "member",
      });
    }

    // Optionally update lastActive / online counters if you track those
    // room.lastActive = new Date();

    // Save and return updated room
    await room.save();

    // Prepare output similar to frontend normalizeRoom
    const out = {
      ...room.toObject(),
      id: room.id || room._id?.toString() || String(room.code),
    };

    // Broadcast room_list_update or specific events if your server uses socket.io
    try {
      // If you attach io on the app like: app.set('io', io) in server.js
      const io = req.app?.get?.("io");
      if (io) {
        // emit a generic room_list_update (frontend already listens for this)
        const rooms = await Room.find({}).lean().exec();
        // normalize rooms slightly
        const normalized = rooms.map((r) => ({
          ...r,
          id: r.id || r._id?.toString() || String(r.code),
        }));
        io.emit("room_list_update", normalized);
        // also emit an event for joined user presence if you want
        io.emit("user_joined_room", {
          roomId: out.id,
          userId: memberId,
          userName,
        });
      }
    } catch (e) {
      // ignore if io is not present
      console.warn(
        "room join: io emit failed or not present:",
        e?.message || e
      );
    }

    return res.json(out);
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
