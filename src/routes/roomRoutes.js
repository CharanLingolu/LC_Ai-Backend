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
 * body: { code, userId, userName, guestId? }
 *
 * Adds (or ensures) a member for the given code and returns the updated room.
 * Emits a full room_list_update to keep clients in sync.
 */
router.post("/join", async (req, res) => {
  try {
    const { code, userId, userName, guestId } = req.body;

    if (!code) return res.status(400).json({ error: "Missing room code" });

    const trimmedCode = String(code).trim();
    const nameCandidate = userName
      ? String(userName).trim().slice(0, 64)
      : null;

    // Prefer explicit userId, then guestId from client, otherwise generate one
    const memberId = userId
      ? String(userId)
      : guestId
      ? String(guestId)
      : `guest_${Date.now()}`;

    const memberName = nameCandidate || (userId ? "Member" : "Guest");

    // Find room first (so we can check membership by id)
    const roomDoc = await Room.findOne({ code: trimmedCode });

    if (!roomDoc) {
      return res.status(404).json({ error: "Room not found" });
    }

    // Ensure members array exists
    roomDoc.members = Array.isArray(roomDoc.members) ? roomDoc.members : [];

    // Check if member already exists (match by id)
    const already = roomDoc.members.some(
      (m) => String(m.id) === String(memberId)
    );

    if (!already) {
      // push new member object
      roomDoc.members.push({
        id: memberId,
        name: memberName,
        role: userId ? "member" : "guest",
      });

      // Save the room
      await roomDoc.save();
    }

    // Build sanitized output room object
    const outRoom = {
      id: roomDoc.id || roomDoc._id?.toString() || String(roomDoc.code),
      name: roomDoc.name,
      code: roomDoc.code,
      ownerId: roomDoc.ownerId,
      allowAI: !!roomDoc.allowAI,
      members: Array.isArray(roomDoc.members) ? roomDoc.members : [],
      onlineCount: roomDoc.onlineCount || 0,
    };

    // Broadcast: emit the single joined event and then a full room_list_update
    try {
      const io = req.app?.get?.("io");
      if (io) {
        // notify listeners a user joined this room
        io.emit("room_joined", {
          room: outRoom,
          joinedUser: { id: memberId, name: memberName },
        });

        // Fetch full rooms list and emit normalized list so clients' filter logic works
        const rooms = await Room.find().lean();
        const normalized = rooms.map((r) => ({
          ...r,
          id: r.id || r._id?.toString() || String(r.code),
        }));

        io.emit("room_list_update", normalized);
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
        text: m.content || "",
        role: m.role,
        senderUserId: m.senderUser,
        senderGuestName: m.senderGuestName,
        createdAt: m.createdAt,
        reactions: m.reactions || [],
        mediaUrl: m.mediaUrl || null,
        mediaType: m.mediaType || null,
      }))
    );
  } catch (err) {
    console.error("Fetch messages error:", err.message);
    res.status(500).json({ error: "Failed to load room messages" });
  }
});

// GET /api/rooms/for-guest/:guestId
router.get("/for-guest/:guestId", async (req, res) => {
  try {
    const { guestId } = req.params;
    if (!guestId) return res.status(400).json({ error: "Missing guestId" });

    // Lookup rooms containing a member with id == guestId
    const rooms = await Room.find({ "members.id": guestId }).lean();

    const out = (rooms || []).map((r) => ({
      id: r.id || r._id?.toString() || String(r.code),
      name: r.name,
      code: r.code,
      ownerId: r.ownerId,
      allowAI: !!r.allowAI,
      members: Array.isArray(r.members) ? r.members : [],
      onlineCount: r.onlineCount || 0,
    }));

    return res.json(out);
  } catch (err) {
    console.error("GET /api/rooms/for-guest error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
