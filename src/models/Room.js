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
    ownerId: { type: String, required: true },
    code: { type: String, required: true, unique: true },

    // Match what frontend sends
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
