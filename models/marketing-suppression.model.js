// server/models/marketing-suppression.model.js
// Addresses that must never receive marketing e-mail again (unsubscribed / bounced / complaint).
// Per country, because each market sends from its own identity.
import mongoose from "mongoose";

const suppressionSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    countryCode: { type: String, required: true },
    reason: { type: String, enum: ["UNSUBSCRIBED", "BOUNCED", "COMPLAINT", "MANUAL"], default: "UNSUBSCRIBED" },
    marketingEmailId: { type: mongoose.Schema.Types.ObjectId, ref: "MarketingEmail", default: null },
  },
  { timestamps: true },
);
suppressionSchema.index({ email: 1, countryCode: 1 }, { unique: true });

export default mongoose.models.MarketingSuppression || mongoose.model("MarketingSuppression", suppressionSchema);
