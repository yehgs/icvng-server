// models/chat-message.model.js
import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: "ChatConversation", required: true },
    seq: { type: Number, required: true }, // per-conversation, strictly increasing (cursor for polling)
    senderType: { type: String, enum: ["visitor", "ai", "agent", "system"], required: true },
    sender: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      name: { type: String, default: "" },
      role: { type: String, default: "" }, // e.g. "Sales Agent"
      image: { type: String, default: "" },
    },
    text: { type: String, required: true, maxlength: 4000 },
    kind: { type: String, enum: ["text", "escalation", "handoff", "joined", "closed", "contact_request"], default: "text" },
    internal: { type: Boolean, default: false }, // admin-only note, never sent to the visitor
    language: { type: String, default: "" },
  },
  { timestamps: true },
);
messageSchema.index({ conversation: 1, seq: 1 }, { unique: true });

export default mongoose.model("ChatMessage", messageSchema);
