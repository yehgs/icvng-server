// server/models/marketing-recipient.model.js
// Per-recipient delivery row: makes a bulk send resumable, auditable and retry-safe
// (a recipient is atomically claimed PENDING → SENDING so two workers can never double-send).
import mongoose from "mongoose";

const recipientSchema = new mongoose.Schema(
  {
    marketingEmailId: { type: mongoose.Schema.Types.ObjectId, ref: "MarketingEmail", required: true, index: true },
    countryCode: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, default: "" },
    source: { type: String, default: "" },
    status: { type: String, enum: ["PENDING", "SENDING", "SENT", "FAILED", "SKIPPED"], default: "PENDING" },
    attempts: { type: Number, default: 0 },
    error: { type: String, default: "" },
    claimedAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    messageId: { type: String, default: "" },
  },
  { timestamps: true },
);
recipientSchema.index({ marketingEmailId: 1, email: 1 }, { unique: true });
recipientSchema.index({ marketingEmailId: 1, status: 1 });

export default mongoose.models.MarketingRecipient || mongoose.model("MarketingRecipient", recipientSchema);
