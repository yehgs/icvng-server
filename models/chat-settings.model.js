// models/chat-settings.model.js — singleton (key: "global"), edited by IT/Director (chat.settings).
import mongoose from "mongoose";

const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "global", unique: true },
    enabled: { type: Boolean, default: true }, // master switch for the widget (web + mobile)
    aiEnabled: { type: Boolean, default: true }, // false → every chat goes straight to a human
    disabledCountries: [{ type: String }], // widget hidden in these countries
    model: { type: String, default: "" }, // blank → env OPENAI_CHAT_MODEL → gpt-5-mini
    extraInstructions: { type: String, default: "", maxlength: 4000 }, // appended to the system prompt
    requireContactForEscalation: { type: Boolean, default: true }, // AI asks for email/WhatsApp once before handing over
    slaSeconds: { type: Number, default: 120 }, // waiting_agent longer than this = OVERDUE alarm
    alarmRepeatSeconds: { type: Number, default: 30 }, // console alarm repeat interval
    welcome: { type: Map, of: String, default: {} }, // language → greeting override
  },
  { timestamps: true },
);

export default mongoose.model("ChatSettings", settingsSchema);
