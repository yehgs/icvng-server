// server/models/hr/hr-holiday.model.js — public holidays / company closures per country.
import mongoose from "mongoose";
import { countryField } from "../../config/countrySchema.js";

const holidaySchema = new mongoose.Schema(
  { ...countryField, name: { type: String, required: true, trim: true, maxlength: 100 }, date: { type: String, required: true }, createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" } },
  { timestamps: true },
);
holidaySchema.index({ countryCode: 1, date: 1 }, { unique: true });
export default mongoose.models.HrHoliday || mongoose.model("HrHoliday", holidaySchema);
