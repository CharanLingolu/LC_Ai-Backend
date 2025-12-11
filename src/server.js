import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// force the backend to load the .env from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.join(__dirname, "../.env"), // 🔥 always correct absolute path
});

console.log(
  "ENV CHECK (backend):",
  !!process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY?.slice(0, 10)
);

import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { createServer } from "http";
import { Server } from "socket.io";

import authRoutes from "./routes/authRoutes.js";
import roomRoutes from "./routes/roomRoutes.js";
import chatRoutes from "./routes/chatRoutes.js"; // Now this will see the API Key

import Room from "./models/Room.js";
import Message from "./models/Message.js";
import streamRoutes from "./routes/streamRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";

// 🔍 Debugging: Verify key is loaded
console.log(
  "🔍 DEBUG CHECK: GEMINI_API_KEY is:",
  process.env.GEMINI_API_KEY ? "LOADED ✅" : "MISSING ❌"
);

const app = express();
const PORT = process.env.PORT || 5000;

// server.js (add)
console.log("🔍 FRONTEND_URL:", process.env.FRONTEND_URL);
console.log(
  "🔍 VITE_SOCKET_URL (client-side should match):",
  process.env.VITE_SOCKET_URL
);

// --- CORS CONFIG (replace current cors setup with this) ---
const frontendLocal = "http://localhost:5173"; // or 3000, 3001 — whatever your dev server uses
const extraLocalHosts = [
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
];

const allowedOrigins = new Set(
  [
    frontendLocal,
    process.env.FRONTEND_URL, // e.g. https://lc-ai-frontend.vercel.app
    process.env.VITE_SOCKET_URL &&
      process.env.VITE_SOCKET_URL.replace(/^https?:\/\//, (m) => m), // not required but kept
    ...extraLocalHosts,
  ].filter(Boolean)
);

function originAllowed(origin) {
  if (!origin) return true; // allow non-browser ws clients or null origin in dev
  // allow local hosts and a pattern for vercel
  if (allowedOrigins.has(origin)) return true;
  if (origin.endsWith(".vercel.app") && origin.includes("lc-ai")) return true;
  // allow specific rendered hostname from env
  if (process.env.FRONTEND_URL && origin === process.env.FRONTEND_URL)
    return true;
  return false;
}

const corsOptions = {
  origin: (origin, callback) => {
    if (originAllowed(origin)) return callback(null, true);
    console.log("❌ Blocked by CORS:", origin);
    return callback(new Error("Not allowed by CORS"), false);
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

app.use(cors(corsOptions));
// removed global app.options(...) because it triggers path-to-regexp error in this router version
app.use(express.json());

// ---------- IMPORTANT: create httpServer BEFORE socket.io -----------
const httpServer = createServer(app);

// socket.io: use the same origin function
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (originAllowed(origin)) return callback(null, true);
      console.log("❌ Socket blocked by CORS (socket.io):", origin);
      return callback(new Error("Not allowed by CORS"), false);
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
  allowEIO3: false, // you use EIO=4 on client; keep false. Set to true only if you need EIO3 compatibility.
});

// In-memory call sessions
const callSessions = new Map();

// --- BASIC ROUTE -------------------------------------------------

app.get("/", (req, res) => {
  res.json({ message: "LC_Ai backend running ✅" });
});

// Add this *before* app.use("/api/chat", chatRoutes);
app.use("/api/chat", express.json()); // ensure body parsed (if not already)
app.use("/api/chat", (req, res, next) => {
  console.log(
    "➡️ [CHAT REQUEST]",
    req.method,
    req.originalUrl,
    "body:",
    JSON.stringify(req.body).slice(0, 2000)
  );
  next();
});

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/stream", streamRoutes);
app.use("/api/upload", uploadRoutes);

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
 * Emit current online count for a room
 */
function emitActiveUsersCount(roomKey) {
  const key = String(roomKey);
  const room = io.sockets.adapter.rooms.get(key);
  const count = room ? room.size : 0;
  io.to(key).emit("active_users_update", {
    roomId: key,
    count,
  });
}

// ---------- SOCKET.IO ----------

io.on("connection", (socket) => {
  console.log("🟢 Socket connected:", socket.id);

  // 1️⃣ Register user
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
        socket.emit("room_create_failed", {
          reason: "MISSING_OWNER",
          message: "Owner email is required.",
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
        message: "Failed to create room.",
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

  // ------- TOGGLE ROOM AI -------

  socket.on("toggle_room_ai", async (roomId) => {
    try {
      if (!roomId) return;
      const room = await Room.findById(roomId);
      if (!room) return;

      const requesterEmail = socket.data.userEmail || null;
      const requesterId = socket.data.userId || null;
      const isOwnerByEmail = requesterEmail && room.ownerId === requesterEmail;
      const isOwnerById = requesterId && room.ownerId === String(requesterId);

      if (!isOwnerByEmail && !isOwnerById) {
        socket.emit("room_ai_toggle_failed", {
          reason: "NOT_OWNER",
          message: "Only the room owner can change AI settings.",
        });
        return;
      }

      room.allowAI = !room.allowAI;
      await room.save();

      io.to(String(roomId)).emit("room_ai_toggled", {
        roomId: String(roomId),
        allowAI: room.allowAI,
      });

      await broadcastRoomList(socket);
    } catch (err) {
      console.error("❌ toggle_room_ai error:", err.message);
    }
  });

  // 🔹 ROOM THEME CHANGE
  socket.on("change_room_theme", ({ roomId, theme, changedBy }) => {
    if (!roomId || !theme) return;
    const key = String(roomId);
    io.to(key).emit("room_theme_changed", { roomId: key, theme, changedBy });
    io.to(key).emit("system_message", {
      content: `${changedBy || "Someone"} changed the room theme to "${theme}"`,
      timestamp: Date.now(),
    });
  });

  socket.on("verify_room_code", async (code, callback) => {
    try {
      const room = await Room.findOne({ code }).lean();
      callback(room || null);
    } catch (err) {
      callback(null);
    }
  });

  // ------- New: Authenticated join by code -------
  socket.on(
    "join_room_authenticated",
    async ({ code, userId, email, userName }, callback) => {
      try {
        if (!code || (!userId && !email)) {
          return callback?.({ ok: false, error: "missing_data" });
        }

        const roomDoc = await Room.findOne({ code });
        if (!roomDoc) {
          return callback?.({ ok: false, error: "room_not_found" });
        }

        const roomId = roomDoc._id.toString();
        const memberIds = (roomDoc.members || []).map((m) => String(m.id));
        const byEmail = email && memberIds.includes(String(email));
        const byUserId = userId && memberIds.includes(String(userId));

        // Add member if not present (prefer attaching by userId if available)
        if (!byEmail && !byUserId) {
          roomDoc.members.push({
            id: userId ? String(userId) : email,
            name: userName || email || "Member",
            role: "member",
          });
          await roomDoc.save();
        }

        // Join socket to room for presence/messages
        socket.join(roomId);
        socket.data.userId = userId ? String(userId) : socket.data.userId;
        socket.data.userEmail = email || socket.data.userEmail;

        // Respond with the room document so client can update UI
        callback?.({ ok: true, room: roomDoc.toObject() });

        // Notify room and update lists/presence
        io.to(roomId).emit("system_message", {
          content: `${userName || email || "Someone"} joined the room.`,
          timestamp: Date.now(),
        });

        emitActiveUsersCount(roomId);
        await broadcastRoomList();
      } catch (err) {
        console.error("join_room_authenticated error:", err);
        callback?.({ ok: false, error: "server_error" });
      }
    }
  );

  // ------- GUEST JOIN -------
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
        room.inviteLinkId = Math.random().toString(36).substring(2, 10);
        room.inviteLink = room.inviteLinkId;
      }

      if (!room.members.some((m) => String(m.id) === String(stableGuestId))) {
        room.members.push({ id: stableGuestId, name, role: "guest" });
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
      socket.emit("guest_join_failed", { reason: "SERVER_ERROR" });
    }
  });

  // ------- CHAT JOIN / LEAVE -------
  socket.on("join_room", async ({ roomId, displayName }) => {
    if (!roomId) return;
    const roomKey = String(roomId);

    // join socket room for presence + chat
    socket.join(roomKey);

    // send a system message to everyone in the room that someone joined
    try {
      io.to(roomKey).emit("system_message", {
        content: `${displayName || "Someone"} joined`,
        timestamp: Date.now(),
        roomId: roomKey,
        type: "join", // optional: helpful for client handling
        displayName: displayName || null,
      });
    } catch (err) {
      console.error("system_message emit error:", err);
    }

    // if a call session is live tell the just-joined socket
    const session = callSessions.get(roomKey);
    if (session) {
      socket.emit("call_started", {
        roomId: roomKey,
        startedBy: session.startedBy || "Someone",
      });
    }

    // update presence counts for everyone
    emitActiveUsersCount(roomKey);

    // ensure server room list is broadcast to sockets (so members count etc refresh)
    try {
      await broadcastRoomList();
    } catch (e) {
      // ignore broadcast errors
    }
  });

  socket.on("leave_room", ({ roomId }) => {
    const roomKey = String(roomId);
    socket.leave(roomKey);
    emitActiveUsersCount(roomKey);
  });

  // ------- SEND MESSAGE -------
  socket.on("send_message", async (data) => {
    try {
      const roomKey = String(data.roomId);
      if (!roomKey) return;

      const saved = await Message.create({
        room: data.roomId,
        senderUser: data.senderUserId || null,
        senderGuestName: data.senderGuestName || null,
        role: data.role || "user",
        content: data.text || "",
        mediaUrl: data.mediaUrl || null,
        mediaType: data.mediaType || null,
        mediaName: data.mediaName || null,
        mimeType: data.mimeType || null,
      });

      const payload = {
        _id: saved._id.toString(),
        roomId: saved.room.toString(),
        text: saved.content || "",
        role: saved.role,
        senderUserId: saved.senderUser || null,
        senderGuestName: saved.senderGuestName || null,
        createdAt: saved.createdAt,
        reactions: saved.reactions || [],
        mediaUrl: saved.mediaUrl || null,
        mediaType: saved.mediaType || null,
        mediaName: saved.mediaName || null,
      };

      io.to(roomKey).emit("receive_message", payload);
    } catch (e) {
      console.warn("Message save error (non-fatal):", e.message);
      const roomKey = String(data.roomId);
      io.to(roomKey).emit("receive_message", {
        _id: `temp-${Date.now()}`,
        roomId: roomKey,
        text: data.text || "",
        role: data.role || "user",
        createdAt: new Date().toISOString(),
        mediaUrl: data.mediaUrl || null,
        mediaName: data.mediaName || null,
        reactions: [],
      });
    }
  });

  socket.on("delete_message", async (payload, ack) => {
    try {
      const {
        messageId,
        requesterUserId = null,
        requesterGuestName = null,
        createdAt: payloadCreatedAt = null,
        textSnippet = null,
        roomId: payloadRoomId = null,
      } = payload || {};

      if (!messageId) {
        return ack?.({ ok: false, error: "MISSING_MESSAGE_ID" });
      }

      const msg = await Message.findById(messageId);
      if (!msg) return ack?.({ ok: false, error: "MESSAGE_NOT_FOUND" });

      const room = await Room.findById(msg.room)
        .lean()
        .catch(() => null);

      const socketUserId = socket.data?.userId || null;
      const socketUserEmail = socket.data?.userEmail || null;

      const equals = (a, b) => a && b && String(a) === String(b);

      let allowed = false;

      // 1) sender by authenticated userId
      if (
        socketUserId &&
        msg.senderUser &&
        equals(msg.senderUser, socketUserId)
      )
        allowed = true;

      // 2) sender by payload userId
      if (
        !allowed &&
        requesterUserId &&
        msg.senderUser &&
        equals(msg.senderUser, requesterUserId)
      )
        allowed = true;

      // 3) guest sender by name
      if (
        !allowed &&
        requesterGuestName &&
        msg.senderGuestName === requesterGuestName
      ) {
        if (
          (payloadCreatedAt &&
            String(msg.createdAt) === String(payloadCreatedAt)) ||
          (textSnippet && (msg.content || "").startsWith(textSnippet))
        ) {
          allowed = true;
        } else {
          allowed = true; // allow without logging
        }
      }

      // 4) owner
      if (!allowed && room) {
        if (socketUserEmail && room.ownerId === socketUserEmail) allowed = true;
        if (socketUserId && equals(room.ownerId, socketUserId)) allowed = true;
      }

      if (!allowed) {
        return ack?.({ ok: false, error: "NOT_AUTHORIZED" });
      }

      const roomId = msg.room ? String(msg.room) : payloadRoomId;

      await msg.deleteOne();
      io.to(roomId).emit("message_deleted", { messageId: String(messageId) });

      ack?.({ ok: true });
    } catch (err) {
      console.error("❌ delete_message error:", err.message);
      ack?.({ ok: false, error: "SERVER_ERROR" });
    }
  });

  socket.on("typing", ({ roomId, displayName }) => {
    if (!roomId || !displayName) return;
    const key = String(roomId);
    socket.to(key).emit("typing", { roomId: key, displayName });
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
        io.to(msg.room.toString()).emit("reactionUpdated", {
          messageId: msg._id.toString(),
          reactions: msg.reactions,
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
      socket
        .to(roomKey)
        .emit("call_started", { roomId: roomKey, startedBy: name });
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

    socket.emit("existing_peers", {
      roomId: roomKey,
      peers,
      participantCount: session.participants.size,
    });
    socket.to(roomKey).emit("user_joined_call", {
      peerId: socket.id,
      name,
      participantCount: session.participants.size,
    });
  });

  socket.on("leave_call", ({ roomId }) => handleLeaveCall(io, roomId, socket));
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
    [...socket.rooms].forEach((roomKey) => {
      if (roomKey !== socket.id) emitActiveUsersCount(roomKey);
    });
    for (const [roomId] of callSessions.entries())
      handleLeaveCall(io, roomId, socket);
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

// Place this near the bottom of server.js (before start())
app.use((err, req, res, next) => {
  // show full stack in server console
  console.error("‼️ Unhandled error:", err && err.stack ? err.stack : err);
  // return a safe error shape to client
  res.status(err?.status || 500).json({
    ok: false,
    message: err?.message || "Internal Server Error",
    // DO NOT send stack to browser in production; for debugging only:
    ...(process.env.NODE_ENV !== "production" ? { stack: err?.stack } : {}),
  });
});

start();
