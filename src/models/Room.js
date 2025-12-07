import mongoose from "mongoose";

const memberSchema = new mongoose.Schema(
  {
    id: { type: String, required: true }, // email or "guest_123"
    name: { type: String, required: true },
    role: { type: String, default: "member" }, // "owner", "member", "guest"
  },
  { _id: false } // cleaner members array
);

const roomSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },

    // ALWAYS the owner's email (we use this on server for limits / visibility)
    ownerId: { type: String, required: true },

    // 6-digit room code, must be unique
    code: { type: String, required: true, unique: true },

    // 🔹 This field already has a unique index in Mongo: inviteLinkId_1
    // so it MUST exist and be non-null when creating a room.
    inviteLinkId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // Optional pretty link / token you share (can equal inviteLinkId)
    inviteLink: { type: String, required: false },

    allowAI: { type: Boolean, default: true },

    members: [memberSchema],

    // 🎨 chat theme for this room ("default", "love", "midnight", etc.)
    theme: {
      type: String,
      default: "default",
    },
  },
  { timestamps: true }
);

// TTL Index: Deletes room automatically 5 hours after creation
roomSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 5 });

// Prevent OverwriteModelError in dev
const Room = mongoose.models.Room || mongoose.model("Room", roomSchema);

export default Room;
