// server/models/hr/hr-office.model.js — an office with a geofence, used for "present in office" check-ins.
import mongoose from "mongoose";
import { countryField } from "../../config/countrySchema.js";

const officeSchema = new mongoose.Schema(
  {
    ...countryField,
    name: { type: String, required: true, trim: true, maxlength: 100 },
    address: { type: String, trim: true, maxlength: 300, default: "" },
    location: { lat: { type: Number, required: true, min: -90, max: 90 }, lng: { type: Number, required: true, min: -180, max: 180 } },
    radiusMeters: { type: Number, min: 20, max: 5000, default: 150 },
    // E-mail(s) notified every time someone marks present at this office
    notifyEmails: { type: [String], default: [] },
    // false: out-of-range check-ins are recorded and FLAGGED; true: refused
    enforceGeofence: { type: Boolean, default: false },
    timezone: { type: String, default: "Africa/Lagos" },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
officeSchema.index({ countryCode: 1, name: 1 });
export default mongoose.models.HrOffice || mongoose.model("HrOffice", officeSchema);
