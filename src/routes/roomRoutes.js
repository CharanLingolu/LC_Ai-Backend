import express from "express";
import Room from "../models/Room.js";
import Message from "../models/Message.js";

const router = express.Router();

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
}

function generateInviteLinkId() {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * IMPORTANT CONVENTION
 * --------------------
 * - room.ownerId  => ALWAYS the owner's EMAIL (string)
 * - room.members[].id => a stable "user id" for membership
 *      - for logged in users: Mongo _id (user.id)
 *      - for guests: "guest_<something>"
 *
 * Socket side then:
 *   - treats owner by email
 *   - treats membership by members[].id
 */

// POST /api/rooms  (create room)
router.post(
  "/",
  /* requireAuth */ async (req, res) => {
    try {
      // When you wire requireAuth, these will come from JWT:
      const jwtUserId = req.user?.id; // Mongo _id
      const jwtEmail = req.user?.email; // email

      // For now we also accept fields from body so it works without middleware
      const bodyOwnerEmail = req.body.ownerEmail || req.body.ownerId; // backward compat
      const bodyOwnerUserId = req.body.ownerUserId || req.body.ownerDbId;

      // ✅ final identity values
      const ownerEmail = jwtEmail || bodyOwnerEmail;
      const ownerUserId = jwtUserId || bodyOwnerUserId || ownerEmail; // fallback

      if (!ownerEmail) {
        return res
          .status(401)
          .json({ error: "Owner email required to create room" });
      }

      const { name, allowAI = true } = req.body;
      if (!name) {
        return res.status(400).json({ error: "Room name is required" });
      }

      const code = generateRoomCode();
      const inviteLinkId = generateInviteLinkId();

      const room = await Room.create({
        name,
        ownerId: ownerEmail, // ✅ ALWAYS EMAIL
        code,
        inviteLink: inviteLinkId,
        allowAI,
        members: [
          {
            id: ownerUserId, // ✅ membership id
            name: req.body.ownerName || "Owner",
            role: "owner",
          },
        ],
      });

      res.status(201).json(room);
    } catch (err) {
      console.error("Create room error:", err.message);
      res.status(500).json({ error: "Failed to create room" });
    }
  }
);

// POST /api/rooms/join  (join by code – logged in OR guest)
router.post("/join", async (req, res) => {
  try {
    const { code, guestName, userId, userName } = req.body;

    const room = await Room.findOne({ code });
    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    // membership id:
    //  - logged in user: userId (Mongo _id)
    //  - guest: "guest_<name or random>"
    const identityId =
      userId || `guest_${(guestName || "Guest").replace(/\s+/g, "_")}`;

    const isAlreadyMember = room.members.some(
      (m) => String(m.id) === String(identityId)
    );

    if (!isAlreadyMember) {
      room.members.push({
        id: identityId,
        name: guestName || userName || "Guest",
        role: userId ? "member" : "guest",
      });
      await room.save();
    }

    res.json(room);
  } catch (err) {
    console.error("Join room error:", err.message);
    res.status(500).json({ error: "Failed to join room" });
  }
});

// GET /api/rooms/:roomId/messages
router.get("/:roomId/messages", async (req, res) => {
  try {
    const { roomId } = req.params;
    const limit = parseInt(req.query.limit || "100", 10);

    const messages = await Message.find({ room: roomId })
      .sort({ createdAt: 1 })
      .limit(limit);

    res.json(
      messages.map((m) => ({
        _id: m._id,
        roomId: m.room.toString(),
        text: m.content,
        role: m.role,
        senderUserId: m.senderUser,
        senderGuestName: m.senderGuestName,
        createdAt: m.createdAt,
        reactions: m.reactions || [],
      }))
    );
  } catch (err) {
    console.error("Fetch messages error:", err.message);
    res.status(500).json({ error: "Failed to load room messages" });
  }
});

export default router;
