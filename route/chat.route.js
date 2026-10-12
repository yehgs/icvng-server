// route/chat.route.js — PUBLIC chat API, mounted at /api/chat (storefront widget + mobile app)
import { Router } from "express";
import { optionalAuth } from "../middleware/auth.js";
import { rateLimit, clientIp } from "../utils/rateLimit.js";
import {
  getChatConfig, createOrResume, poll, sendMessage, submitLead, requestHuman, rate, endChat,
} from "../controllers/chat.controller.js";

const r = Router();
const byConv = (req) => `${req.params.id || "new"}:${clientIp(req)}`;

r.get("/config", getChatConfig);
r.post("/conversations", rateLimit({ windowMs: 60_000, max: 10 }), optionalAuth, createOrResume);
r.get("/conversations/:id", rateLimit({ windowMs: 60_000, max: 90, key: byConv }), poll);
r.post("/conversations/:id/messages", rateLimit({ windowMs: 60_000, max: 12, key: byConv, message: "You are sending messages too fast" }), sendMessage);
r.post("/conversations/:id/lead", rateLimit({ windowMs: 60_000, max: 10, key: byConv }), submitLead);
r.post("/conversations/:id/human", rateLimit({ windowMs: 60_000, max: 5, key: byConv }), requestHuman);
r.post("/conversations/:id/rate", rateLimit({ windowMs: 60_000, max: 5, key: byConv }), rate);
r.post("/conversations/:id/close", rateLimit({ windowMs: 60_000, max: 5, key: byConv }), endChat);

export default r;
