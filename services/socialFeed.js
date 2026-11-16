// server/services/socialFeed.js — latest posts for a social page card.
//   FACEBOOK  Graph API /{page-id}/posts      (externalId + page access token)
//   INSTAGRAM Graph API /{ig-user-id}/media   (externalId + access token)
//   YOUTUBE   public channel RSS              (externalId = channel id, no token)
// Anything else, or any failure, falls back to the posts an admin entered by hand. Results are cached 15 minutes
// per page and the last good result is served if a refresh fails, so the storefront never waits on Meta twice.
import { decryptSecret } from "../utils/encryption.js";

const GRAPH = "https://graph.facebook.com/v19.0";
const TTL = 15 * 60 * 1000, TIMEOUT = 4000, DEFAULT_LIMIT = 8;
const cache = new Map(); // pageId → { at, key, posts }
export const _clearFeedCache = () => cache.clear();

const https = (u) => { try { const x = new URL(u); return x.protocol === "https:" && !x.username ? u : ""; } catch { return ""; } };
const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

async function getJson(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); } finally { clearTimeout(t); }
}
async function getText(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.text(); } finally { clearTimeout(t); }
}


const ytId = (u) => { try { const x = new URL(u); const h = x.hostname.replace(/^www\./, ""); let id = ""; if (h === "youtu.be") id = x.pathname.slice(1); else if (h.endsWith("youtube.com")) id = x.searchParams.get("v") || (/^\/(shorts|embed|live)\/([\w-]+)/.exec(x.pathname)?.[2] ?? ""); return /^[\w-]{6,20}$/.test(id) ? id : ""; } catch { return ""; } };
/** A playable embed for a post link on a platform that allows embedding, else "". Only these hosts are ever iframed. */
export function embedFor(url) {
  const u = https(url); if (!u) return "";
  const yt = ytId(u); if (yt) return `https://www.youtube-nocookie.com/embed/${yt}?rel=0&autoplay=1`;
  try {
    const x = new URL(u), h = x.hostname.replace(/^www\./, "");
    const tk = h.endsWith("tiktok.com") && /\/video\/(\d{6,25})/.exec(x.pathname)?.[1]; if (tk) return `https://www.tiktok.com/embed/v2/${tk}`;
    if (/(^|\.)facebook\.com$|^fb\.watch$/.test(h) && /\/(videos|reel|watch)\b|^\/watch/.test(x.pathname + x.search + (h === "fb.watch" ? "/videos" : ""))) return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(u)}&show_text=false&autoplay=true`;
    if (h.endsWith("instagram.com") && /^\/(p|reel|tv)\/[\w-]+/.test(x.pathname)) return `https://www.instagram.com${x.pathname.replace(/\/?$/, "/")}embed/`;
  } catch { /* none */ }
  return "";
}
const isVideoFile = (u) => /\.(mp4|webm|mov)(\?|$)/i.test(u || "");
const withVideo = (p, { video = false, videoUrl = "", embedUrl = "" } = {}) => ({ ...p, type: video ? "VIDEO" : "IMAGE", videoUrl: video ? https(videoUrl) : "", embedUrl: video ? (embedUrl || (videoUrl ? "" : embedFor(p.url))) : "" });

export function normaliseFacebook(json, limit = DEFAULT_LIMIT) {
  return (json?.data || []).map((p) => {
    const media = p.attachments?.data?.[0];
    const video = /video/i.test(media?.media_type || "") || /\/(videos|reel)\//.test(p.permalink_url || "");
    return withVideo({ id: String(p.id), imageUrl: https(p.full_picture), caption: clip(p.message || p.story, 220), url: https(p.permalink_url), postedAt: p.created_time || null }, { video, embedUrl: video ? embedFor(p.permalink_url) || `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(p.permalink_url || "")}&show_text=false&autoplay=true` : "" });
  }).filter((p) => p.url).slice(0, limit);
}
export function normaliseInstagram(json, limit = DEFAULT_LIMIT) {
  return (json?.data || []).map((p) => {
    const video = p.media_type === "VIDEO";
    return withVideo({ id: String(p.id), imageUrl: https(video ? p.thumbnail_url : p.media_url), caption: clip(p.caption, 220), url: https(p.permalink), postedAt: p.timestamp || null }, { video, videoUrl: video ? p.media_url : "" });
  }).filter((p) => p.url).slice(0, limit);
}
export function normaliseYoutube(xml, limit = DEFAULT_LIMIT) {
  const out = [];
  for (const m of String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const id = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(e)?.[1];
    if (!id || !/^[\w-]{6,20}$/.test(id)) continue;
    const title = /<title>([^<]*)<\/title>/.exec(e)?.[1] || "";
    out.push(withVideo({ id, imageUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, caption: clip(title.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"'), 220), url: `https://www.youtube.com/watch?v=${id}`, postedAt: /<published>([^<]+)<\/published>/.exec(e)?.[1] || null }, { video: true, embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0&autoplay=1` }));
    if (out.length >= limit) break;
  }
  return out;
}

const manual = (page, limit) => (page.manualPosts || []).map((p, i) => {
  const file = isVideoFile(p.videoUrl) ? p.videoUrl : "";
  const embed = embedFor(p.url);
  return withVideo({ id: `m${i}`, imageUrl: https(p.imageUrl), caption: clip(p.caption, 220), url: https(p.url), postedAt: p.postedAt || null }, { video: !!(file || embed), videoUrl: file, embedUrl: file ? "" : embed });
}).filter((p) => p.url).sort((a, b) => new Date(b.postedAt || 0) - new Date(a.postedAt || 0)).slice(0, limit);

async function live(page, limit) {
  const id = encodeURIComponent(page.externalId);
  if (page.platform === "YOUTUBE") return normaliseYoutube(await getText(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`), limit);
  let token = "";
  try { token = page.accessTokenEnc ? decryptSecret(page.accessTokenEnc) : ""; } catch { token = ""; }
  if (!token) return [];
  const q = `access_token=${encodeURIComponent(token)}&limit=${limit}`;
  if (page.platform === "FACEBOOK") return normaliseFacebook(await getJson(`${GRAPH}/${id}/posts?fields=id,message,story,full_picture,permalink_url,created_time&${q}`), limit);
  if (page.platform === "INSTAGRAM") return normaliseInstagram(await getJson(`${GRAPH}/${id}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp&${q}`), limit);
  return [];
}

/** @param page lean/doc incl. accessTokenEnc (select it explicitly). Never throws. */
export async function postsFor(page, { limit = DEFAULT_LIMIT } = {}) {
  const key = `${page.externalId}|${page.platform}|${page.updatedAt ? new Date(page.updatedAt).getTime() : 0}|${limit}`;
  const hit = cache.get(String(page._id));
  if (hit && hit.key === key && Date.now() - hit.at < TTL) return hit.posts;
  let posts = [];
  if (page.externalId && ["FACEBOOK", "INSTAGRAM", "YOUTUBE"].includes(page.platform)) {
    try { posts = await live(page, limit); }
    catch (e) { if (hit?.key === key && hit.posts.length) return hit.posts; console.error(`[social] ${page.platform} feed failed for "${page.name}": ${e.message}`); }
  }
  if (!posts.length) posts = manual(page, limit);
  cache.set(String(page._id), { at: Date.now(), key, posts });
  return posts;
}
