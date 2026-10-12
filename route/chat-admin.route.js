// route/chat-admin.route.js — admin chat console API, mounted at /api/admin/chat
import { Router } from "express";
import auth from "../middleware/auth.js";
import adminAuth from "../middleware/adminAuth.js";
import { countryScope } from "../middleware/countryScope.js";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  getAlerts, listConversations, getConversation, reply, doTakeover, doHandBack, doTransfer, doClose,
  patchConversation, getStats, exportLeads, getChatSettings, updateChatSettings,
} from "../controllers/chat-admin.controller.js";

const r = Router();
r.use(auth, adminAuth, countryScope);

// read
r.get("/alerts", requirePermission("chat.view"), getAlerts);
r.get("/stats", requirePermission("chat.view"), getStats);
r.get("/conversations", requirePermission("chat.view"), listConversations);
r.get("/conversations/export.csv", requirePermission("chat.view"), exportLeads);
r.get("/conversations/:id", requirePermission("chat.view"), getConversation);
r.get("/settings", requirePermission("chat.view"), getChatSettings);

// act
const manage = requirePermission("chat.manage");
r.post("/conversations/:id/messages", manage, reply);
r.post("/conversations/:id/takeover", manage, doTakeover);
r.post("/conversations/:id/hand-back", manage, doHandBack);
r.post("/conversations/:id/transfer", manage, doTransfer);
r.post("/conversations/:id/close", manage, doClose);
r.patch("/conversations/:id", manage, patchConversation);

// configure (IT / Director)
r.put("/settings", requirePermission("chat.settings"), updateChatSettings);

export default r;
