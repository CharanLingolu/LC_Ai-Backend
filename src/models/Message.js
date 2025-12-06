import mongoose from "mongoose";

const reactionSchema = new mongoose.Schema(
  {
    emoji: { type: String, required: true },

    // Can be real userId or "guest-xxxx"
    userId: { type: String, required: true },

    // To show name on tooltip: "❤️ by Charan"
    displayName: { type: String, default: "Guest" },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    room: { type: mongoose.Schema.Types.ObjectId, ref: "Room", required: true },

    senderUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    senderGuestName: { type: String },

    role: { type: String, enum: ["user", "ai", "system"], required: true },

    content: { type: String, required: true },

    reactions: {
      type: [reactionSchema],
      default: [],
    },
  },
  { timestamps: true }
);

// Use existing model if hot reload, else create
export default mongoose.models.Message ||
  mongoose.model("Message", messageSchema);
