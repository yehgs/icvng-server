/**
 * models/booking-request.model.js
 *
 * Persists the storefront "Barista Training" and "Rent a Coffee Machine"
 * requests so Sales / Manager / IT / Director can respond from the admin
 * panel (they were previously email-only and lost once the email was missed).
 *
 * NIGERIA-ONLY: both services are run by the Nigerian business. Every record
 * is stamped countryCode "NG" regardless of which storefront the visitor used,
 * and the admin routes additionally refuse any country-scoped admin whose
 * assignedCountry is not NG (see middleware/nigeriaOnly.js). The
 * countryScopedPlugin is applied as a second, query-level safety net.
 */
import mongoose from "mongoose";
import countryScopedPlugin from "../core/countryScopedPlugin.js";

export const BOOKING_COUNTRY = "NG";
export const BOOKING_SERVICES = ["training", "rental"];
export const BOOKING_STATUSES = ["NEW", "CONTACTED", "CONFIRMED", "COMPLETED", "CANCELLED"];

const noteSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 2000 },
    byUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    byName: { type: String, default: "" },
    byRole: { type: String, default: "" },
    at: { type: Date, default: Date.now },
  },
  { _id: true },
);

const bookingRequestSchema = new mongoose.Schema(
  {
    service: { type: String, enum: BOOKING_SERVICES, required: true, index: true },

    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    whatsapp: { type: String, default: "", trim: true },
    contactMode: { type: String, enum: ["Phone call", "WhatsApp", "Email"], required: true },

    preferredDate: { type: String, required: true }, // yyyy-MM-dd as chosen on the calendar
    timeSlot: { type: String, enum: ["Morning", "Afternoon"], required: true },

    // Service-specific answers exactly as shown on the form: [{ label, value }]
    extras: [{ _id: false, label: String, value: String }],

    submittedLanguage: { type: String, default: "en" },

    status: { type: String, enum: BOOKING_STATUSES, default: "NEW", index: true },
    notes: [noteSchema],

    // Who first responded / last touched it
    respondedAt: { type: Date, default: null },
    respondedByName: { type: String, default: "" },
    respondedByRole: { type: String, default: "" },

    // Did the notification email to the recipient array go out?
    emailSent: { type: Boolean, default: false },
  },
  { timestamps: true },
);

bookingRequestSchema.plugin(countryScopedPlugin);
bookingRequestSchema.index({ countryCode: 1, service: 1, status: 1, createdAt: -1 });

export default mongoose.model("BookingRequest", bookingRequestSchema);
