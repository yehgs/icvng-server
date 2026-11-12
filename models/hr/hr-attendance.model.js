// server/models/hr/hr-attendance.model.js — one row per staff member per local day.
import mongoose from "mongoose";
import { countryField } from "../../config/countrySchema.js";

export const ATTENDANCE_TYPES = ["OFFICE", "REMOTE", "LEAVE", "HOLIDAY", "ABSENT"];

const attendanceSchema = new mongoose.Schema(
  {
    ...countryField,
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: "HrStaff", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    date: { type: String, required: true }, // YYYY-MM-DD in the office/country timezone
    type: { type: String, enum: ATTENDANCE_TYPES, required: true },
    workModeAtTime: { type: String, default: "" },
    officeId: { type: mongoose.Schema.Types.ObjectId, ref: "HrOffice", default: null },
    checkInAt: { type: Date, default: null },
    checkOutAt: { type: Date, default: null },
    // Geolocation captured at the moment of marking present
    geo: {
      lat: Number, lng: Number, accuracyMeters: Number,
      distanceMeters: Number, withinGeofence: Boolean,
      address: { type: String, default: "" }, // reverse-geocoded address (best effort) or the office address
      addressSource: { type: String, enum: ["REVERSE_GEOCODE", "OFFICE", ""], default: "" },
    },
    flags: { type: [String], default: [] }, // OUTSIDE_GEOFENCE, LOW_ACCURACY, MANUAL_ENTRY
    notifiedAt: { type: Date, default: null },
    manual: { type: Boolean, default: false },
    note: { type: String, maxlength: 300, default: "" },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
attendanceSchema.index({ staffId: 1, date: 1 }, { unique: true });
attendanceSchema.index({ countryCode: 1, date: 1 });
export default mongoose.models.HrAttendance || mongoose.model("HrAttendance", attendanceSchema);
