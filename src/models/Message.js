// src/models/Message.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const reactionSchema = new Schema(
  {
    emoji: { type: String, required: true },

    // Can be real userId or "guest-xxxx"
    userId: { type: String, required: true },

    // To show name on tooltip: "❤️ by Charan"
    displayName: { type: String, default: "Guest" },
  },
  { _id: false }
);

const messageSchema = new Schema(
  {
    // 🔹 Room reference (Room _id)
    room: { type: Schema.Types.ObjectId, ref: "Room", required: true },

    // 🔹 Who sent it
    senderUser: { type: Schema.Types.ObjectId, ref: "User" },
    senderGuestName: { type: String },

    // 🔹 "user" | "ai" | "system"
    role: {
      type: String,
      enum: ["user", "ai", "system"],
      required: true,
    },

    /**
     * MAIN MESSAGE TEXT
     *
     * For normal chat messages → the actual text.
     * For media messages → optional (you can leave empty),
     * because we have `required` depending on `mediaUrl`.
     */
    content: {
      type: String,
      required: function () {
        // `this` is the mongoose document
        return !this.mediaUrl;
      },
    },

    /**
     * OPTIONAL MEDIA FIELDS
     * Used for file / image / video messages.
     */
    mediaUrl: {
      type: String, // Cloudinary URL or similar
    },
    mediaType: {
      type: String, // e.g. "image", "video", "file"
    },

    reactions: {
      type: [reactionSchema],
      default: [],
    },
  },
  { timestamps: true }
);

/**
 * 🔁 Shape returned to frontend
 *
 * - Your RoomChat uses `text`
 * - We mirror `content` → `text`
 */
messageSchema.set("toJSON", {
  transform(doc, ret) {
    ret.id = ret._id;
    ret.text = ret.content || "";
    // mediaUrl, mediaType, reactions remain as-is
    delete ret.__v;
    return ret;
  },
});

// Reuse model if hot reload, else create
const Message =
  mongoose.models.Message || mongoose.model("Message", messageSchema);

export default Message;
