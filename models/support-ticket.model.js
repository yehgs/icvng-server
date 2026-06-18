//server
import mongoose from "mongoose";

const ISSUE_CATEGORIES = [
  "Email Troubleshooting",
  "Email Password Update",
  "E-commerce",
  "Admin Application",
  // 'Network / Connectivity',
  // 'Hardware',
  "Software Installation",
  "Data Recovery",
  "Account Access",
  // 'Printer / Peripheral',
  "Other",
];

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    senderName: String,
    senderSubRole: String,
    message: { type: String, required: true },
    attachments: [{ url: String, name: String }],
  },
  { timestamps: true },
);

const supportTicketSchema = new mongoose.Schema(
  {
    ticketNumber: {
      type: String,
      unique: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    createdByName: String,
    createdBySubRole: String,
    createdByEmail: String,

    // Assigned IT staff
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    assignedToName: { type: String, default: null },

    title: { type: String, required: true },
    description: { type: String, required: true },

    category: {
      type: String,
      enum: ISSUE_CATEGORIES,
      default: "Other",
    },

    priority: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
    },

    status: {
      type: String,
      enum: ["open", "working_on", "pending", "completed", "fixed", "closed"],
      default: "open",
    },

    messages: [messageSchema],

    // IT notes (internal, not visible to the requester)
    internalNotes: { type: String, default: "" },

    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Auto-generate ticket number
supportTicketSchema.pre("save", async function (next) {
  if (!this.ticketNumber) {
    const count = await mongoose.model("SupportTicket").countDocuments();
    this.ticketNumber = `TKT-${String(count + 1).padStart(4, "0")}`;
  }
  next();
});

export { ISSUE_CATEGORIES };

const SupportTicketModel = mongoose.model("SupportTicket", supportTicketSchema);
export default SupportTicketModel;
