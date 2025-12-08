// src/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { createServer } from "http";
import { Server } from "socket.io";

import authRoutes from "./routes/authRoutes.js";
import roomRoutes from "./routes/roomRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";

import Room from "./models/Room.js";
import Message from "./models/Message.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// --- CORS CONFIG -------------------------------------------------

const allowedOrigins = [
  "http://localhost:5173",
  process.env.FRONTEND_URL,
].filter(Boolean);

const validateOrigin = (origin, callback) => {
  if (!origin) return callback(null, true);

  if (allowedOrigins.includes(origin)) {
    return callback(null, true);
  }

  if (origin.endsWith(".vercel.app") && origin.includes("lc-ai")) {
    return callback(null, true);
  }

  console.log("❌ Blocked by CORS:", origin);
  return callback(new Error("Not allowed by CORS"), false);
};

const corsOptions = {
  origin: validateOrigin,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

// --- HTTP SERVER + SOCKET.IO -------------------------------------

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: validateOrigin,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// In-memory call sessions
// Map<roomKey (string), { startedBy, startedAt, maxParticipants, participants: Map<socketId, name> }>
const callSessions = new Map();

// --- BASIC ROUTE -------------------------------------------------

app.get("/", (req, res) => {
  res.json({ message: "LC_Ai backend running ✅" });
});

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/chat", chatRoutes);

// ---------- Helpers ----------

function handleLeaveCall(io, rawRoomId, socket) {
  const roomKey = String(rawRoomId);
  const session = callSessions.get(roomKey);
  if (!session) return;

  if (session.participants.has(socket.id)) {
    const name = session.participants.get(socket.id);
    session.participants.delete(socket.id);

    const participantCount = session.participants.size;

    socket.to(roomKey).emit("user_left_call", {
      peerId: socket.id,
      name,
      participantCount,
    });

    if (participantCount === 0) {
      callSessions.delete(roomKey);
      io.to(roomKey).emit("call_ended", { roomId: roomKey });
    }
  }
}

/**
 * Get the list of rooms visible to a specific socket
 *  - owner of the room (by email or id, just in case)
 *  - OR member (userId / guestId / email) in room.members
 */
function filterRoomsForSocket(allRooms, socket) {
  const userEmail = socket.data?.userEmail || null;
  const userId = socket.data?.userId || null;

  if (!userEmail && !userId) {
    return [];
  }

  return allRooms.filter((room) => {
    const ownerId = room.ownerId;
    const members = Array.isArray(room.members) ? room.members : [];
    const memberIds = members.map((m) => String(m.id));

    const isOwnerByEmail = userEmail && ownerId === userEmail;
    const isOwnerById = userId && ownerId === String(userId);

    const isMemberByUserId = userId && memberIds.includes(String(userId));
    const isMemberByEmail = userEmail && memberIds.includes(userEmail);

    return isOwnerByEmail || isOwnerById || isMemberByUserId || isMemberByEmail;
  });
}

/**
 * Broadcast updated room list
 */
async function broadcastRoomList(targetSocket = null) {
  try {
    const rooms = await Room.find().sort({ createdAt: -1 }).lean();

    if (targetSocket) {
      const visible = filterRoomsForSocket(rooms, targetSocket);
      targetSocket.emit("room_list_update", visible);
      return;
    }

    for (const [, s] of io.sockets.sockets) {
      const visible = filterRoomsForSocket(rooms, s);
      s.emit("room_list_update", visible);
    }
  } catch (err) {
    console.error("Error fetching rooms for broadcast:", err);
  }
}

/**
 * Emit current online count for a room using Socket.IO adapter
 */
function emitActiveUsersCount(roomKey) {
  const room = io.sockets.adapter.rooms.get(String(roomKey));
  const count = room ? room.size : 0;
  io.to(String(roomKey)).emit("active_users_update", {
    roomId: String(roomKey),
    count,
  });
}

// ---------- SOCKET.IO ----------

io.on("connection", (socket) => {
  console.log("🟢 Socket connected:", socket.id);

  // 1️⃣ Register which user this socket belongs to
  socket.on("register_user", ({ userId, email }) => {
    socket.data.userId = userId ? String(userId) : null;
    socket.data.userEmail = email || null;
    console.log("🔐 register_user:", socket.data);

    broadcastRoomList(socket);
  });

  socket.on("request_room_list", () => broadcastRoomList(socket));

  // ------- ROOMS CRUD -------

  socket.on("create_room", async (roomData) => {
    try {
      const ownerEmail = roomData.ownerId;

      if (!ownerEmail) {
        console.warn("create_room called without ownerId/email");
        socket.emit("room_create_failed", {
          reason: "MISSING_OWNER",
          message: "Owner email is required to create a room.",
        });
        return;
      }

      const existingCount = await Room.countDocuments({ ownerId: ownerEmail });
      if (existingCount >= 5) {
        socket.emit("room_create_failed", {
          reason: "LIMIT_REACHED",
          message: "You can only create up to 5 rooms.",
        });
        return;
      }

      const inviteLinkId =
        roomData.inviteLinkId || Math.random().toString(36).substring(2, 10);

      console.log("Creating room with inviteLinkId =", inviteLinkId);

      await Room.create({
        name: roomData.name,
        code: roomData.code,
        ownerId: ownerEmail,
        allowAI: roomData.allowAI,
        inviteLinkId,
        inviteLink: roomData.inviteLink || inviteLinkId,
        members: roomData.members || [],
      });

      await broadcastRoomList(socket);
    } catch (err) {
      console.error("❌ ROOM SAVE FAILED:", err.message);
      socket.emit("room_create_failed", {
        reason: "SERVER_ERROR",
        message: "Failed to create room. Try again later.",
      });
    }
  });

  socket.on("delete_room", async (roomId) => {
    try {
      await Room.findByIdAndDelete(roomId);
      await Message.deleteMany({ room: roomId });
      await broadcastRoomList();
    } catch (err) {
      console.error("❌ delete_room error:", err.message);
    }
  });

  socket.on("rename_room", async ({ roomId, newName }) => {
    try {
      await Room.findByIdAndUpdate(roomId, { name: newName });
      await broadcastRoomList();
    } catch (err) {
      console.error("❌ rename_room error:", err.message);
    }
  });

  socket.on("toggle_room_ai", async (roomId) => {
    try {
      if (!roomId) return;

      const room = await Room.findById(roomId);
      if (!room) return;

      const requesterEmail = socket.data.userEmail || null;
      const requesterId = socket.data.userId || null;

      // ✅ Only the owner can toggle AI
      const isOwnerByEmail = requesterEmail && room.ownerId === requesterEmail;
      const isOwnerById = requesterId && room.ownerId === String(requesterId);

      if (!isOwnerByEmail && !isOwnerById) {
        console.warn("❌ Unauthorized toggle_room_ai attempt", {
          roomId,
          requesterEmail,
          requesterId,
        });

        socket.emit("room_ai_toggle_failed", {
          reason: "NOT_OWNER",
          message: "Only the room owner can change AI settings.",
        });
        return;
      }

      // Owner is valid → toggle
      room.allowAI = !room.allowAI;
      await room.save();

      // 1) Notify everyone in that room that AI has been toggled
      io.to(roomId).emit("room_ai_toggled", {
        roomId,
        allowAI: room.allowAI,
      });

      // 2) Refresh room list only for this socket
      await broadcastRoomList(socket);
    } catch (err) {
      console.error("❌ toggle_room_ai error:", err.message);
    }
  });

  // 🔹 ROOM THEME CHANGE
  socket.on("change_room_theme", ({ roomId, theme, changedBy }) => {
    if (!roomId || !theme) return;

    io.to(roomId).emit("room_theme_changed", { roomId, theme, changedBy });

    io.to(roomId).emit("system_message", {
      content: `${changedBy || "Someone"} changed the room theme to "${theme}"`,
      timestamp: Date.now(),
    });
  });

  socket.on("verify_room_code", async (code, callback) => {
    try {
      const room = await Room.findOne({ code }).lean();
      callback(room || null);
    } catch (err) {
      console.error("verify_room_code error:", err);
      callback(null);
    }
  });

  // ------- GUEST JOIN (by secret code) -------

  socket.on("join_room_guest", async ({ code, name, guestId }) => {
    try {
      if (!code || !name) {
        socket.emit("guest_join_failed", { reason: "MISSING_DATA" });
        return;
      }

      const room = await Room.findOne({ code });
      if (!room) {
        socket.emit("guest_join_failed", { reason: "ROOM_NOT_FOUND" });
        return;
      }

      const roomId = room._id.toString();

      const stableGuestId =
        guestId || `guest_${Math.random().toString(36).substring(2, 10)}`;

      if (!room.inviteLinkId) {
        const newId = Math.random().toString(36).substring(2, 10);
        room.inviteLinkId = newId;
        if (!room.inviteLink) room.inviteLink = newId;
      }

      if (!room.members.some((m) => String(m.id) === String(stableGuestId))) {
        room.members.push({
          id: stableGuestId,
          name,
          role: "guest",
        });
      }

      await room.save();

      socket.join(roomId);

      socket.data.userId = stableGuestId;
      socket.data.userEmail = null;

      socket.emit("guest_joined_success", {
        room: room.toObject(),
        userId: stableGuestId,
        displayName: name,
      });

      io.to(roomId).emit("system_message", {
        content: `${name} joined`,
        timestamp: Date.now(),
      });

      await broadcastRoomList(socket);
      emitActiveUsersCount(roomId);
    } catch (err) {
      console.error("join_room_guest error:", err.message);
      socket.emit("guest_join_failed", { reason: "SERVER_ERROR" });
    }
  });

  // ------- CHAT JOIN / LEAVE -------

  socket.on("join_room", ({ roomId, displayName }) => {
    if (!roomId) return;

    const roomKey = String(roomId);
    const alreadyInRoom = socket.rooms.has(roomKey);
    socket.join(roomKey);

    if (!alreadyInRoom) {
      io.to(roomKey).emit("system_message", {
        content: `${displayName || "Someone"} joined`,
        timestamp: Date.now(),
      });
    }

    const session = callSessions.get(roomKey);
    if (session) {
      socket.emit("call_started", {
        roomId: roomKey,
        startedBy: session.startedBy || "Someone",
      });
    }

    // ⭐ ONLINE COUNT: adapter-based
    emitActiveUsersCount(roomKey);
  });

  socket.on("leave_room", ({ roomId }) => {
    const roomKey = String(roomId);
    socket.leave(roomKey);
    emitActiveUsersCount(roomKey);
  });

  // ------- SEND MESSAGE + REACTIONS -------

  socket.on("send_message", async (data) => {
    try {
      const saved = await Message.create({
        room: data.roomId,
        senderUser: data.senderUserId || null,
        senderGuestName: data.senderGuestName || null,
        role: data.role,
        content: data.text,
      });

      const payload = {
        _id: saved._id.toString(),
        roomId: saved.room.toString(),
        text: saved.content,
        role: saved.role,
        senderUserId: saved.senderUser || null,
        senderGuestName: saved.senderGuestName || null,
        createdAt: saved.createdAt,
        reactions: saved.reactions || [],
      };

      io.to(data.roomId).emit("receive_message", payload);
    } catch (e) {
      console.warn("Message save error (non-fatal):", e.message);

      io.to(data.roomId).emit("receive_message", {
        ...data,
        _id: `temp-${Date.now()}`,
        createdAt: new Date().toISOString(),
        reactions: [],
      });
    }
  });

  socket.on("typing", ({ roomId, displayName }) => {
    if (!roomId || !displayName) return;
    socket.to(roomId).emit("typing", { roomId, displayName });
  });

  socket.on(
    "addReaction",
    async ({ messageId, emoji, userId, displayName }) => {
      try {
        if (!messageId || !emoji || !userId) return;

        const msg = await Message.findById(messageId);
        if (!msg) return;

        if (!Array.isArray(msg.reactions)) msg.reactions = [];

        const existingIndex = msg.reactions.findIndex(
          (r) => r.userId === userId && r.emoji === emoji
        );

        if (existingIndex !== -1) {
          msg.reactions.splice(existingIndex, 1);
        } else {
          msg.reactions = msg.reactions.filter((r) => r.userId !== userId);
          msg.reactions.push({ emoji, userId, displayName });
        }

        await msg.save();

        const roomId = msg.room.toString();
        io.to(roomId).emit("reactionUpdated", {
          messageId: msg._id.toString(),
          reactions: msg.reactions.map((r) => ({
            emoji: r.emoji,
            userId: r.userId,
            displayName: r.displayName,
          })),
        });
      } catch (err) {
        console.error("addReaction error:", err.message);
      }
    }
  );

  // ------- VOICE / VIDEO CALL -------

  socket.on("join_call", ({ roomId, isOwner, displayName }) => {
    if (!roomId) return;
    const roomKey = String(roomId);
    const name = displayName || "User";

    let session = callSessions.get(roomKey);

    if (!session) {
      session = {
        startedBy: name,
        startedAt: new Date(),
        maxParticipants: 0,
        participants: new Map(),
      };
      callSessions.set(roomKey, session);

      socket.to(roomKey).emit("call_started", {
        roomId: roomKey,
        startedBy: name,
      });
    }

    socket.join(roomKey);

    session.participants.set(socket.id, name);
    session.maxParticipants = Math.max(
      session.maxParticipants,
      session.participants.size
    );

    const peers = Array.from(session.participants.entries())
      .filter(([id]) => id !== socket.id)
      .map(([id, peerName]) => ({ peerId: id, name: peerName }));

    const participantCount = session.participants.size;

    socket.emit("existing_peers", {
      roomId: roomKey,
      peers,
      participantCount,
    });

    socket.to(roomKey).emit("user_joined_call", {
      peerId: socket.id,
      name,
      participantCount,
    });
  });

  socket.on("leave_call", ({ roomId }) => {
    handleLeaveCall(io, roomId, socket);
  });

  socket.on("webrtc_offer", (d) =>
    io.to(d.to).emit("webrtc_offer", { from: socket.id, sdp: d.sdp })
  );
  socket.on("webrtc_answer", (d) =>
    io.to(d.to).emit("webrtc_answer", { from: socket.id, sdp: d.sdp })
  );
  socket.on("webrtc_ice_candidate", (d) =>
    io
      .to(d.to)
      .emit("webrtc_ice_candidate", { from: socket.id, candidate: d.candidate })
  );

  socket.on("disconnect", () => {
    console.log("🔴 Socket disconnected:", socket.id);

    // For each room the socket was in (except its own room),
    // send updated online count
    const joinedRooms = [...socket.rooms].filter(
      (roomKey) => roomKey !== socket.id
    );
    joinedRooms.forEach((roomKey) => {
      emitActiveUsersCount(roomKey);
    });

    for (const [roomId] of callSessions.entries()) {
      handleLeaveCall(io, roomId, socket);
    }
  });
});

// ---------- START SERVER ----------

async function start() {
  try {
    await mongoose.connect(process.env.MONGO_URI, { dbName: "lc_ai" });
    console.log("✅ MongoDB connected");
    httpServer.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("❌ Error starting server:", err.message);
  }
}

start();
