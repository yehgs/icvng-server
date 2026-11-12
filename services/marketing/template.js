// server/services/marketing/template.js
//
// The common e-commerce marketing e-mail: branded header, optional hero image,
// headline, body, CTA button, featured products, footer with unsubscribe.
// PURE (no DB, no I/O) so it can be unit-tested and reused by preview + send.
//
// Safety: nothing the editor types is ever emitted as raw HTML. Body text is
// escaped and a tiny markdown-lite is applied (**bold**, [label](https://link),
// "- " bullets, blank line = paragraph). URLs are validated (https or internal).
import crypto from "crypto";
import { getCountryByCode } from "../../config/countries/index.js";
import { isSafeLink } from "../../utils/campaignValidation.js";

export const escapeHtml = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Footer / button wording per language (storefront languages en / fr / it). */
export const STRINGS = {
  en: {
    why: "You are receiving this email because you have an account or subscription with",
    unsubscribe: "Unsubscribe",
    unsubscribeNote: "Don't want these emails?",
    viewProducts: "Featured for you",
    shopNow: "Shop now",
    visit: "Visit our store",
    hello: "Hello",
    friend: "coffee lover",
  },
  fr: {
    why: "Vous recevez cet e-mail car vous avez un compte ou un abonnement chez",
    unsubscribe: "Se désabonner",
    unsubscribeNote: "Vous ne souhaitez plus recevoir ces e-mails ?",
    viewProducts: "Sélectionnés pour vous",
    shopNow: "Acheter maintenant",
    visit: "Visiter notre boutique",
    hello: "Bonjour",
    friend: "amateur de café",
  },
  it: {
    why: "Ricevi questa e-mail perché hai un account o un'iscrizione presso",
    unsubscribe: "Annulla l'iscrizione",
    unsubscribeNote: "Non vuoi più ricevere queste e-mail?",
    viewProducts: "Scelti per te",
    shopNow: "Acquista ora",
    visit: "Visita il nostro negozio",
    hello: "Ciao",
    friend: "amante del caffè",
  },
};

const absUrl = (domain, link) => {
  if (!isSafeLink(link)) return "";
  return link.startsWith("/") ? `https://${domain}${link}` : link;
};

/** markdown-lite → safe HTML. Input is escaped FIRST; only our own tags are emitted. */
export function renderBody(text, domain, accent = "#8B4513") {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const inline = (s) => {
    let out = escapeHtml(s);
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    // [label](url) — escapeHtml turned quotes into entities, URLs with & stay valid
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
      const raw = url.replace(/&amp;/g, "&");
      const href = absUrl(domain, raw);
      return href ? `<a href="${escapeHtml(href)}" style="color:${accent};text-decoration:underline;">${label}</a>` : label;
    });
    return out;
  };
  const html = [];
  let list = [];
  let para = [];
  const flushPara = () => { if (para.length) { html.push(`<p style="margin:0 0 16px;line-height:1.6;">${para.map(inline).join("<br/>")}</p>`); para = []; } };
  const flushList = () => { if (list.length) { html.push(`<ul style="margin:0 0 16px;padding-left:20px;line-height:1.6;">${list.map((l) => `<li>${inline(l)}</li>`).join("")}</ul>`); list = []; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushPara(); flushList(); continue; }
    if (/^[-*]\s+/.test(line)) { flushPara(); list.push(line.replace(/^[-*]\s+/, "")); continue; }
    flushList();
    para.push(line);
  }
  flushPara(); flushList();
  return html.join("\n");
}

/** Replace {{firstName}} / {{name}} / {{shopName}} with escaped values. */
export function personalize(text, { name = "", shopName = "" } = {}) {
  const first = String(name || "").trim().split(/\s+/)[0] || "";
  return String(text || "")
    .replace(/\{\{\s*firstName\s*\}\}/gi, first)
    .replace(/\{\{\s*name\s*\}\}/gi, String(name || "").trim())
    .replace(/\{\{\s*shopName\s*\}\}/gi, shopName);
}

// ── unsubscribe token (HMAC) ─────────────────────────────────────────────────
const secret = () => process.env.MARKETING_UNSUBSCRIBE_SECRET || process.env.SECRET_KEY_ACCESS_TOKEN || "icv-marketing";
export const unsubscribeSignature = (email, countryCode) =>
  crypto.createHmac("sha256", secret()).update(`${String(email).toLowerCase()}|${countryCode}`).digest("base64url");
export const verifyUnsubscribe = (email, countryCode, sig) => {
  const expected = Buffer.from(unsubscribeSignature(email, countryCode));
  const given = Buffer.from(String(sig || ""));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
};
export function buildUnsubscribeUrl(email, countryCode) {
  const base = (process.env.SERVER_BASE_URL || process.env.API_PUBLIC_URL || "").replace(/\/$/, "");
  const q = new URLSearchParams({ e: Buffer.from(String(email).toLowerCase()).toString("base64url"), c: countryCode, t: unsubscribeSignature(email, countryCode) });
  return `${base}/api/marketing/unsubscribe?${q.toString()}`;
}

/**
 * @param {object} p
 * @param {string} p.countryCode
 * @param {object} p.campaign   { subject, preheader, language, template }
 * @param {Array}  p.products   [{ _id, name, image }] already country-visible
 * @param {{name?:string,email?:string}} p.recipient
 * @param {string} p.unsubscribeUrl
 */
export function buildMarketingEmailHtml({ countryCode, campaign, products = [], recipient = {}, unsubscribeUrl = "#" }) {
  const country = getCountryByCode(countryCode) || getCountryByCode("NG");
  const domain = country.domain;
  const siteName = country.seo?.siteName || "I-Coffee";
  const lang = STRINGS[campaign.language] ? campaign.language : "en";
  const L = STRINGS[lang];
  const t = campaign.template || {};
  const accent = HEX.test(t.accentColor || "") ? t.accentColor : "#8B4513";
  const ctx = { name: recipient.name, shopName: siteName };

  const headline = escapeHtml(personalize(t.headline, ctx));
  const bodyHtml = renderBody(personalize(t.body, ctx), domain, accent);
  const hero = isSafeLink(t.heroImage) && !t.heroImage.startsWith("/") ? t.heroImage : isSafeLink(t.heroImage) ? absUrl(domain, t.heroImage) : "";
  const cta = absUrl(domain, t.ctaUrl);
  const greetName = String(recipient.name || "").trim().split(/\s+/)[0] || L.friend;
  const preheader = escapeHtml(personalize(campaign.preheader, ctx));

  const productCells = products.slice(0, 6).map((p) => {
    const href = `https://${domain}/product/${String(p.name || "").toString().replaceAll(" ", "-").replaceAll(",", "-").replaceAll("&", "-").replaceAll("/", "-").replaceAll("\\", "-").replaceAll("%", "-").replaceAll("+", "-").replaceAll("(", "-").replaceAll(")", "-").replaceAll("--", "-").toLowerCase()}-${p._id}`;
    const img = p.image && /^https:\/\//.test(p.image) ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" width="160" style="display:block;margin:0 auto 8px;max-width:100%;height:auto;border-radius:6px;" />` : "";
    return `<td align="center" valign="top" style="padding:8px;width:33%;"><a href="${escapeHtml(href)}" style="text-decoration:none;color:#333;font-size:13px;">${img}<span style="display:block;">${escapeHtml(p.name)}</span></a></td>`;
  });
  const rows = [];
  for (let i = 0; i < productCells.length; i += 3) rows.push(`<tr>${productCells.slice(i, i + 3).join("")}</tr>`);

  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>${escapeHtml(campaign.subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f0ec;font-family:Arial,Helvetica,sans-serif;color:#333;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f0ec;"><tr><td align="center" style="padding:20px 10px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;">
      <tr><td align="center" style="background:${accent};padding:22px 20px;">
        <a href="https://${domain}" style="color:#ffffff;text-decoration:none;font-size:22px;font-weight:bold;letter-spacing:.5px;">&#9749; ${escapeHtml(siteName)}</a>
      </td></tr>
      ${hero ? `<tr><td><img src="${escapeHtml(hero)}" alt="" width="600" style="display:block;width:100%;height:auto;" /></td></tr>` : ""}
      <tr><td style="padding:28px 28px 8px;">
        <p style="margin:0 0 6px;font-size:14px;color:#777;">${escapeHtml(L.hello)} ${escapeHtml(greetName)},</p>
        ${headline ? `<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#222;">${headline}</h1>` : ""}
        <div style="font-size:15px;color:#444;">${bodyHtml}</div>
        ${cta && t.ctaLabel ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 12px;"><tr><td style="background:${accent};border-radius:6px;"><a href="${escapeHtml(cta)}" style="display:inline-block;padding:13px 28px;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;">${escapeHtml(personalize(t.ctaLabel, ctx))}</a></td></tr></table>` : ""}
      </td></tr>
      ${rows.length ? `<tr><td style="padding:8px 20px 8px;"><p style="margin:12px 8px 4px;font-size:16px;font-weight:bold;color:#222;">${escapeHtml(L.viewProducts)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join("")}</table></td></tr>` : ""}
      ${t.footerNote ? `<tr><td style="padding:8px 28px 0;font-size:13px;color:#666;">${escapeHtml(personalize(t.footerNote, ctx))}</td></tr>` : ""}
      <tr><td style="padding:24px 28px;">
        <hr style="border:none;border-top:1px solid #eee;margin:0 0 16px;"/>
        <p style="margin:0 0 6px;font-size:12px;color:#888;line-height:1.5;">${escapeHtml(L.why)} <a href="https://${domain}" style="color:#888;">${escapeHtml(siteName)}</a> (${escapeHtml(country.name)}).</p>
        <p style="margin:0;font-size:12px;color:#888;">${escapeHtml(L.unsubscribeNote)} <a href="${escapeHtml(unsubscribeUrl)}" style="color:#888;text-decoration:underline;">${escapeHtml(L.unsubscribe)}</a></p>
        <p style="margin:12px 0 0;font-size:11px;color:#aaa;">&copy; ${new Date().getFullYear()} ${escapeHtml(siteName)}</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}
