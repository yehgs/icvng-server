/**
 * controllers/chat.controller.js — PUBLIC chat API used by the storefront widget and the mobile app.
 * Auth model: a conversation is addressed by id + secret token (header `x-chat-token`),
 * issued at creation and stored on the device. Logged-in customers (optionalAuth) get their
 * open conversation resumed (token rotated) and their account linked.
 */
import {
  ChatError, startConversation, resumeForUser, authVisitor, touchPresence, getMessages, publicView,
  handleVisitorMessage, visitorRequestsHuman, saveContact, rateConversation, closeConversation,
  getSettings, resolveLanguage, setConversationLanguage, EMAIL_RX,
} from "../services/chat/chatService.js";
import { chatStrings, fmt } from "../services/chat/chatStrings.js";
import { syncByCode } from "../services/countryService.js";

const fail = (res, err) => {
  const status = err instanceof ChatError ? err.status : 500;
  if (status === 500) console.error("[chat]", err);
  return res.status(status).json({ message: err.message || "Chat error", code: err.code, error: true, success: false });
};
const ok = (res, data) => res.json({ success: true, error: false, data });

async function visitorConv(req) {
  const conv = await authVisitor(req.params.id, req.headers["x-chat-token"]);
  if (!conv) throw new ChatError("Conversation not found", 404, "NOT_FOUND");
  // follow the storefront language (widget sends it on every call)
  await setConversationLanguage(conv, req.headers["x-language"] || req.body?.language || req.query?.language);
  return conv;
}

export async function getChatConfig(req, res) {
  try {
    const country = req.country || syncByCode(req.countryCode);
    const settings = await getSettings();
    const lang = resolveLanguage(req.query.language, country);
    const S = chatStrings(lang);
    const enabled = settings.enabled && !(settings.disabledCountries || []).includes(country.code);
    return ok(res, {
      enabled,
      countryCode: country.code,
      language: lang,
      brand: country.seo?.siteName || `I-Coffee ${country.name}`,
      welcome: settings.welcome?.[lang] || fmt(S.welcome, { brand: country.seo?.siteName || `I-Coffee ${country.name}` }),
      aiEnabled: settings.aiEnabled,
    });
  } catch (e) { return fail(res, e); }
}

export async function createOrResume(req, res) {
  try {
    const country = req.country || syncByCode(req.countryCode);
    const b = req.body || {};
    // 1) device already holds a conversation → resume it if the token is valid and it is still open
    if (b.resume?.id && b.resume?.token) {
      const conv = await authVisitor(b.resume.id, b.resume.token);
      if (conv && conv.status !== "closed") {
        await setConversationLanguage(conv, b.language);
        await touchPresence(conv);
        return ok(res, { conversation: publicView(conv), token: b.resume.token, messages: await getMessages(conv, { after: 0 }) });
      }
    }
    // 2) logged-in customer with an open conversation
    const resumed = await resumeForUser(req.user && req.user.role !== "ADMIN" ? req.user : null, country.code);
    if (resumed) {
      await setConversationLanguage(resumed.conversation, b.language);
      await touchPresence(resumed.conversation);
      return ok(res, { conversation: publicView(resumed.conversation), token: resumed.token, messages: await getMessages(resumed.conversation, { after: 0 }) });
    }
    // 3) new
    const { conversation, token } = await startConversation({
      country, language: b.language, channel: b.channel === "mobile" ? "mobile" : "web",
      visitor: { visitorId: b.visitorId, name: b.name, email: b.email, whatsapp: b.whatsapp, pageUrl: b.pageUrl },
      user: req.user && req.user.role !== "ADMIN" ? req.user : null,
      userAgent: req.headers["user-agent"],
    });
    return ok(res, { conversation: publicView(conversation), token, messages: await getMessages(conversation, { after: 0 }) });
  } catch (e) { return fail(res, e); }
}

export async function poll(req, res) {
  try {
    const conv = await visitorConv(req);
    await touchPresence(conv);
    const messages = await getMessages(conv, { after: req.query.after });
    return ok(res, { conversation: publicView(conv), messages });
  } catch (e) { return fail(res, e); }
}

export async function sendMessage(req, res) {
  try {
    const conv = await visitorConv(req);
    await handleVisitorMessage(conv, req.body?.text);
    const fresh = await authVisitor(req.params.id, req.headers["x-chat-token"]);
    const messages = await getMessages(fresh, { after: req.body?.after || 0 });
    return ok(res, { conversation: publicView(fresh), messages });
  } catch (e) { return fail(res, e); }
}

export async function submitLead(req, res) {
  try {
    const conv = await visitorConv(req);
    const { name, email, whatsapp } = req.body || {};
    if (email && !EMAIL_RX.test(email)) throw new ChatError("Invalid email", 400, "BAD_EMAIL");
    const saved = await saveContact(conv, { name, email, whatsapp });
    if (!saved) throw new ChatError("Nothing to save", 400, "EMPTY");
    return ok(res, { conversation: publicView(conv) });
  } catch (e) { return fail(res, e); }
}

export async function requestHuman(req, res) {
  try {
    const conv = await visitorConv(req);
    await visitorRequestsHuman(conv, "SALES");
    const fresh = await authVisitor(req.params.id, req.headers["x-chat-token"]);
    return ok(res, { conversation: publicView(fresh), messages: await getMessages(fresh, { after: req.body?.after || 0 }) });
  } catch (e) { return fail(res, e); }
}

export async function rate(req, res) {
  try {
    const conv = await visitorConv(req);
    await rateConversation(conv, req.body?.score, req.body?.comment);
    return ok(res, {});
  } catch (e) { return fail(res, e); }
}

export async function endChat(req, res) {
  try {
    const conv = await visitorConv(req);
    await closeConversation(conv, "visitor");
    return ok(res, { conversation: publicView(conv) });
  } catch (e) { return fail(res, e); }
}
