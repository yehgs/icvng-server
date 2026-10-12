// models/chat-conversation.model.js
//
// One document per visitor chat. COUNTRY-SCOPED by an explicit `countryCode`
// (stamped from the storefront/app country the visitor is on). We deliberately
// do NOT attach countryScopedPlugin: visitor (public) requests have no admin
// scope context, and admin visibility has its own rule (services/chat/chatScope.js):
//   IT / DIRECTOR → every country · foreign (COUNTRY) admin → own country ·
//   other HQ roles → the HQ country only.
import mongoose from "mongoose";
import { ALL_COUNTRY_CODES, DEFAULT_COUNTRY } from "../config/countries/index.js";

export const CHAT_STATUSES = ["ai", "waiting_agent", "agent", "resolved", "closed"];
export const ESCALATION_ROLES = ["SALES", "MANAGER", "IT", "DIRECTOR"]; // target "desks"

const conversationSchema = new mongoose.Schema(
  {
    countryCode: { type: String, enum: ALL_COUNTRY_CODES, default: DEFAULT_COUNTRY, index: true },
    language: { type: String, default: "en" },
    channel: { type: String, enum: ["web", "mobile"], default: "web" },

    visitor: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
      visitorId: { type: String, default: "", index: true }, // random id kept on the device
      name: { type: String, default: "" },
      email: { type: String, default: "" },
      whatsapp: { type: String, default: "" },
      pageUrl: { type: String, default: "" },
      userAgent: { type: String, default: "" },
    },
    tokenHash: { type: String, required: true, select: false }, // sha256 of the visitor's secret token

    status: { type: String, enum: CHAT_STATUSES, default: "ai", index: true },
    aiEnabled: { type: Boolean, default: true },

    escalation: {
      requested: { type: Boolean, default: false },
      by: { type: String, enum: ["ai", "visitor", "admin", "system", null], default: null },
      targetRole: { type: String, enum: [...ESCALATION_ROLES, null], default: null },
      reason: { type: String, default: "" },
      requestedAt: { type: Date, default: null },
      overdueNotifiedAt: { type: Date, default: null },
    },
    contactAsked: { type: Boolean, default: false }, // AI already asked for email/WhatsApp once before escalating

    // Snapshot of the responding admin — what the visitor sees (name, role label, photo).
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    assignedName: { type: String, default: "" },
    assignedRole: { type: String, default: "" }, // subRole key e.g. "SALES"
    assignedRoleLabel: { type: String, default: "" }, // "Sales Agent"
    assignedImage: { type: String, default: "" },

    seq: { type: Number, default: 0 }, // last message sequence number (atomic $inc)
    messageCount: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    lastMessagePreview: { type: String, default: "" },
    lastSender: { type: String, default: "" },
    lastVisitorMessageAt: { type: Date, default: null },
    unreadForAdmin: { type: Number, default: 0 },
    firstAgentReplyAt: { type: Date, default: null },
    visitorLastSeenAt: { type: Date, default: null }, // presence → "user is on chat"

    summary: { type: String, default: "" }, // AI hand-off summary for the agent
    tags: [{ type: String }],
    priority: { type: String, enum: ["low", "normal", "high", "urgent"], default: "normal" },
    rating: { score: { type: Number, min: 1, max: 5, default: null }, comment: { type: String, default: "" } },
    closedAt: { type: Date, default: null },
    closedBy: { type: String, default: "" },
  },
  { timestamps: true },
);

conversationSchema.index({ countryCode: 1, status: 1, lastMessageAt: -1 });
conversationSchema.index({ "visitor.email": 1 });
conversationSchema.index({ "visitor.whatsapp": 1 });

export default mongoose.model("ChatConversation", conversationSchema);
