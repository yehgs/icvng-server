/**
 * utils/rateLimit.js — tiny in-memory sliding-window limiter (per instance).
 * Good enough to stop a single visitor flooding the chat/AI; for a hard global
 * limit across Cloud Run instances back it with Redis (see PRD addendum 3 §B.10).
 */
const buckets = new Map();
// Cloud Run sits behind Google's proxy: the real client is the first X-Forwarded-For hop.
export const clientIp = (req) => String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || "unknown";
let lastGc = 0;

export function rateLimit({ windowMs = 60_000, max = 20, key = (req) => clientIp(req), message = "Too many requests" } = {}) {
  return (req, res, next) => {
    const now = Date.now();
    if (now - lastGc > 5 * 60_000) {
      lastGc = now;
      for (const [k, arr] of buckets) if (!arr.length || now - arr[arr.length - 1] > 10 * 60_000) buckets.delete(k);
    }
    const k = `${req.baseUrl}${req.route?.path || ""}:${key(req)}`;
    const arr = (buckets.get(k) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      res.setHeader("Retry-After", Math.ceil(windowMs / 1000));
      return res.status(429).json({ message, error: true, success: false });
    }
    arr.push(now);
    buckets.set(k, arr);
    next();
  };
}
