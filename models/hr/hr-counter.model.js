// server/models/hr/hr-counter.model.js — atomic sequence for employee ids (ICV-NG-0001).
import mongoose from "mongoose";
const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });
export default mongoose.models.HrCounter || mongoose.model("HrCounter", counterSchema);
