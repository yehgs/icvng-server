/**
 * services/catalogue/brochurePdf.js
 *
 * Customer-facing product BROCHURE (PDF, A4 portrait, pdfkit):
 *   • Cover: brand colour, logo, title, optional "Prepared for", company details
 *     and the named sales contact (photo, role, phone/WhatsApp/email).
 *   • Product pages: image-led cards (2-up, 3-up or list), optional category
 *     sections, only the fields the admin switched on (see
 *     catalogueService.BROCHURE_FIELD_DEFS — internal data is never offered).
 *   • Back cover: "Thank you" + the contact again + price/availability note.
 *
 * All drawing uses absolute coordinates with zero document margins, so pdfkit
 * never auto-paginates; pages are only added by newPage().
 */

import PDFDocument from "pdfkit";
import axios from "axios";
import { catalogueStrings } from "./catalogueStrings.js";
import { formatMoney } from "./catalogueService.js";

const W = 595.28;
const H = 841.89;
const M = 36;
const CW = W - M * 2;
const ACCENT = "#d97706";
const INK = "#1f2937";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";
const SOFT = "#faf7f3";

const LAYOUTS = {
  grid2: { cols: 2, gap: 12, cardH: 220, imgH: 120 },
  grid3: { cols: 3, gap: 8, cardH: 176, imgH: 84 },
  list: { cols: 1, gap: 9, cardH: 100, imgH: 0 },
};

// ── images ───────────────────────────────────────────────────────────────────
const looksLikeImage = (b) =>
  !!b && b.length > 8 && ((b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47));

function cld(url, transform) {
  if (typeof url !== "string" || !url) return null;
  if (url.includes("res.cloudinary.com") && url.includes("/upload/")) return url.replace("/upload/", `/upload/${transform}/`);
  return url;
}
const productUrl = (u, big) => cld(u, big ? "f_jpg,q_75,w_560,h_560,c_fit,b_white" : "f_jpg,q_75,w_320,h_320,c_fit,b_white");
const logoUrl = (u) => cld(u, "f_png,w_600,c_fit");
const avatarUrl = (u) => cld(u, "f_jpg,w_260,h_260,c_fill,g_face");

async function fetchBuf(url, timeout = 8000) {
  if (!url) return null;
  try {
    const res = await axios.get(url, { responseType: "arraybuffer", timeout, maxContentLength: 5 * 1024 * 1024 });
    const buf = Buffer.from(res.data);
    return looksLikeImage(buf) ? buf : null;
  } catch {
    return null;
  }
}

async function prefetchProducts(rows, big) {
  const map = new Map();
  const q = rows.filter((r) => r.imageUrl);
  let i = 0;
  const worker = async () => {
    while (i < q.length) {
      const r = q[i++];
      const b = await fetchBuf(productUrl(r.imageUrl, big));
      if (b) map.set(r.id, b);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, q.length) }, worker));
  return map;
}

// ── main ─────────────────────────────────────────────────────────────────────
export async function renderBrochurePdf({ rows, fields, ctx, options = {}, contact = null, generatedAt = new Date() }) {
  const S = catalogueStrings(ctx.language);
  const layout = { ...(LAYOUTS[options.layout] || LAYOUTS.grid2) };
  const company = { ...ctx.company };
  for (const [k, v] of Object.entries(options.company || {})) if (typeof v === "string" && v.trim()) company[k] = v.trim();
  const primary = /^#[0-9a-f]{6}$/i.test(options.color || "") ? options.color : company.primaryColor || "#4a2c17";
  const title = (options.title || "").trim() || S.brochureTitle;
  const subtitle = (options.subtitle || "").trim();

  const [logo, avatar, images] = await Promise.all([
    fetchBuf(logoUrl(company.logo)),
    contact?.avatar ? fetchBuf(avatarUrl(contact.avatar)) : null,
    fields.image ? prefetchProducts(rows, layout.cols < 3) : new Map(),
  ]);

  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    autoFirstPage: false,
    bufferPages: true,
    info: { Title: `${title} – ${company.name}`, Author: company.name, Creator: company.name },
  });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const productPages = [];
  const roleLabel = (c) => (c.role && (S.contactRoles[c.role] || c.role)) || "";

  // helpers --------------------------------------------------------------------
  const label = (txt, x, y, w, color = MUTED) => {
    doc.fillColor(color).font("Helvetica-Bold").fontSize(7).text(String(txt).toUpperCase(), x, y, { width: w, characterSpacing: 0.8, lineBreak: false });
  };
  const infoBlock = (items, x, y, w, { valueColor = INK, labelColor = MUTED, size = 10.5, gap = 8 } = {}) => {
    for (const it of items) {
      if (!it.value) continue;
      label(it.label, x, y, w, labelColor);
      doc.fillColor(valueColor).font("Helvetica").fontSize(size);
      const h = doc.heightOfString(it.value, { width: w });
      doc.text(it.value, x, y + 10, { width: w });
      y += 10 + h + gap;
    }
    return y;
  };
  const avatarCircle = (cx, cy, r) => {
    if (avatar) {
      doc.save().circle(cx, cy, r).clip();
      try { doc.image(avatar, cx - r, cy - r, { width: r * 2, height: r * 2 }); } catch { /* corrupt */ }
      doc.restore();
      doc.circle(cx, cy, r).lineWidth(2).stroke("#ffffff");
    } else {
      doc.circle(cx, cy, r).fill(ACCENT);
      const ini = (contact?.name || "?").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
      doc.fillColor("#fff").font("Helvetica-Bold").fontSize(r * 0.7).text(ini, cx - r, cy - r * 0.38, { width: r * 2, align: "center", lineBreak: false });
    }
  };
  const decorate = () => {
    doc.save().fillOpacity(0.07).fillColor("#ffffff").circle(W - 50, 120, 200).fill().circle(20, H - 260, 160).fill().restore();
    doc.rect(0, 0, W, 8).fill(ACCENT);
  };
  const logoCard = (y, w = 230, h = 96) => {
    const x = (W - w) / 2;
    doc.roundedRect(x, y, w, h, 14).fill("#ffffff");
    if (logo) {
      try { doc.image(logo, x + 18, y + 14, { fit: [w - 36, h - 28], align: "center", valign: "center" }); return; } catch { /* fall back to text */ }
    }
    doc.fillColor(primary).font("Helvetica-Bold").fontSize(20).text(company.name, x + 10, y + h / 2 - 12, { width: w - 20, align: "center", lineBreak: false });
  };
  const companyItems = () => [
    { label: S.address, value: company.address },
    { label: S.phone, value: company.phone },
    { label: S.whatsapp, value: company.whatsapp },
    { label: S.email, value: company.email },
    { label: S.website, value: company.website },
  ];
  const contactItems = () => [
    { label: S.phone, value: contact?.phone },
    { label: S.whatsapp, value: contact?.whatsapp },
    { label: S.email, value: contact?.email },
  ];

  // cover ----------------------------------------------------------------------
  if (options.cover !== false) {
    doc.addPage();
    doc.rect(0, 0, W, H).fill(primary);
    decorate();
    logoCard(72);

    let y = 290;
    doc.rect(M + 4, y, 56, 4).fill(ACCENT);
    y += 22;
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(40);
    const th = doc.heightOfString(title, { width: CW - 40 });
    doc.text(title, M + 4, y, { width: CW - 40 });
    y += th + 8;
    const sub = subtitle || `${ctx.countryName} · ${new Intl.DateTimeFormat({ fr: "fr-FR", it: "it-IT", es: "es-ES", pt: "pt-PT", nl: "nl-NL" }[ctx.language] || "en-GB", { month: "long", year: "numeric" }).format(generatedAt)}`;
    doc.fillColor("#f3e6d8").font("Helvetica").fontSize(15).text(sub, M + 4, y, { width: CW - 40 });
    y += 40;
    if ((options.preparedFor || "").trim()) {
      label(S.preparedFor, M + 4, y, CW, "#fbbf77");
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(18).text(options.preparedFor.trim(), M + 4, y + 12, { width: CW - 40 });
    }

    const panelY = H - 262;
    doc.rect(0, panelY, W, 262).fill("#ffffff");
    doc.rect(0, panelY, W, 4).fill(ACCENT);
    const items = companyItems().filter((i) => i.value);
    if (contact) {
      label(S.contactUs, M, panelY + 26, 240, ACCENT);
      infoBlock(items, M, panelY + 44, 240, { size: 10 });
      const cx = W - M - 250;
      doc.roundedRect(cx, panelY + 22, 250, 212, 12).fill(SOFT);
      label(S.yourContact, cx + 16, panelY + 36, 220, ACCENT);
      avatarCircle(cx + 16 + 28, panelY + 86, 28);
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(13).text(contact.name, cx + 56 + 18, panelY + 70, { width: 160 });
      doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(roleLabel(contact), cx + 56 + 18, doc.y + 1, { width: 160 });
      infoBlock(contactItems(), cx + 16, panelY + 128, 220, { size: 10, gap: 5 });
    } else {
      label(S.contactUs, M, panelY + 26, CW, ACCENT);
      const half = items.slice(0, Math.ceil(items.length / 2));
      infoBlock(half, M, panelY + 44, CW / 2 - 10, { size: 10.5 });
      infoBlock(items.slice(half.length), M + CW / 2 + 10, panelY + 44, CW / 2 - 10, { size: 10.5 });
    }
  }

  // product pages ----------------------------------------------------------------
  const newPage = () => {
    doc.addPage();
    productPages.push(doc.bufferedPageRange().count - 1);
    doc.rect(0, 0, W, 30).fill(primary);
    doc.rect(0, 30, W, 2).fill(ACCENT);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9).text(company.name, M, 11, { width: CW / 2, lineBreak: false });
    doc.fillColor("#f3e6d8").font("Helvetica").fontSize(8).text(title, M + CW / 2, 11.5, { width: CW / 2, align: "right", lineBreak: false });
    return 50;
  };
  const LIMIT = H - 50;
  let y = 0;
  const ensure = (h) => { if (!productPages.length || y + h > LIMIT) y = newPage(); };

  const specsFor = (r) => {
    const out = [];
    if (fields.sku && r.sku) out.push(`${S.sku}: ${r.sku}`);
    if (fields.coffeeDetails) {
      if (r.roastLevel) out.push(`${S.roastLevel}: ${S.roast[r.roastLevel] || r.roastLevel}`);
      if (r.blend) out.push(`${S.blend}: ${r.blend}`);
      if (r.origin) out.push(`${S.origin}: ${r.origin}`);
      if (r.intensity) out.push(`${S.intensity}: ${r.intensity}`);
    }
    if (fields.unit && r.unit) out.push(`${S.unit}: ${r.unit}`);
    if (fields.packaging && r.packaging) out.push(`${S.packaging}: ${r.packaging}`);
    if (fields.weight && r.weight) out.push(`${S.weight}: ${r.weight}`);
    if (fields.rating && r.rating > 0) out.push(`${S.rating}: ${r.rating.toFixed(1)}/5`);
    if (fields.tags && r.tags.length) out.push(r.tags.join(", "));
    return out.join("  ·  ");
  };
  const bodyText = (r) => {
    const parts = [];
    if (fields.shortDescription && r.shortDescription) parts.push(r.shortDescription);
    if (fields.description && r.description && r.description !== r.shortDescription) parts.push(r.description);
    return parts.join(" ");
  };
  const kicker = (r) => [fields.brand && r.brand, fields.category && r.category].filter(Boolean).join("  ·  ").toUpperCase();
  const availability = (r) => (fields.availability ? { txt: r.inStock ? S.inStock : S.onRequest, ok: r.inStock } : null);
  const clampText = (txt, x, ty, w, height, font, size, color) => {
    if (!txt || height < size + 2) return 0;
    doc.fillColor(color).font(font).fontSize(size);
    const natural = doc.heightOfString(txt, { width: w });
    const used = Math.min(natural, Math.floor(height / (size * 1.17)) * size * 1.17);
    doc.text(txt, x, ty, { width: w, height: used + 1, ellipsis: true });
    return used;
  };

  const drawGridCard = (r, x, top) => {
    const { cardH, imgH } = layout;
    const w = layout.cardW;
    doc.roundedRect(x, top, w, cardH, 9).lineWidth(0.6).fillAndStroke("#ffffff", LINE);
    let ty = top + 10;
    if (fields.image) {
      doc.roundedRect(x + 0.6, top + 0.6, w - 1.2, imgH + 8, 8).fill(SOFT);
      doc.rect(x + 0.6, top + imgH, w - 1.2, 9).fill("#ffffff");
      const b = images.get(r.id);
      if (b) { try { doc.image(b, x + 10, top + 8, { fit: [w - 20, imgH - 14], align: "center", valign: "center" }); } catch { /* skip */ } }
      else doc.fillColor("#c4b8aa").font("Helvetica").fontSize(8).text(S.noImage, x, top + imgH / 2 - 4, { width: w, align: "center", lineBreak: false });
      if (fields.discount && r.discount > 0) {
        doc.roundedRect(x + 8, top + 8, 40, 17, 8.5).fill(ACCENT);
        doc.fillColor("#fff").font("Helvetica-Bold").fontSize(8.5).text(`-${r.discount}%`, x + 8, top + 12.5, { width: 40, align: "center", lineBreak: false });
      }
      ty = top + imgH + 10;
    }
    const tx = x + 11, tw = w - 22;
    const k = kicker(r);
    if (k) { doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(6.8).text(k, tx, ty, { width: tw, lineBreak: false, ellipsis: true, characterSpacing: 0.4 }); ty += 11; }
    doc.font("Helvetica-Bold").fontSize(layout.cols === 3 ? 9.2 : 10.5);
    const nh = Math.min(doc.heightOfString(r.name, { width: tw }), (layout.cols === 3 ? 9.2 : 10.5) * 1.2 * 2);
    doc.fillColor(INK).text(r.name, tx, ty, { width: tw, height: nh + 1, ellipsis: true });
    ty += nh + 4;

    const hasBottom = fields.price || fields.availability;
    const zoneTop = top + cardH - (hasBottom ? 30 : 8);
    const specs = specsFor(r);
    let specH = 0;
    if (specs) {
      doc.font("Helvetica").fontSize(6.8);
      specH = Math.min(doc.heightOfString(specs, { width: tw }), 6.8 * 1.2 * 2, Math.max(0, zoneTop - ty - 5));
      if (specH < 7) specH = 0; // no room → skip rather than overlap the title
    }
    const specY = zoneTop - specH - 3;
    clampText(bodyText(r), tx, ty, tw, specY - ty - 2, "Helvetica", layout.cols === 3 ? 7.4 : 8, "#4b5563");
    if (specH) doc.fillColor(MUTED).font("Helvetica").fontSize(6.8).text(specs, tx, specY, { width: tw, height: specH + 1, ellipsis: true });

    if (hasBottom) {
      doc.moveTo(x + 11, zoneTop + 2).lineTo(x + w - 11, zoneTop + 2).lineWidth(0.5).stroke(LINE);
      const av = availability(r);
      const priceW = av ? tw * 0.62 : tw;
      if (fields.price) doc.fillColor(primary).font("Helvetica-Bold").fontSize(layout.cols === 3 ? 11 : 13).text(r.price > 0 ? formatMoney(r.price, ctx) : "—", tx, zoneTop + 8, { width: priceW, lineBreak: false, ellipsis: true });
      if (av) doc.fillColor(av.ok ? "#15803d" : "#b45309").font("Helvetica-Bold").fontSize(7).text(av.txt, tx + priceW, zoneTop + 11, { width: tw - priceW, align: "right", lineBreak: false });
    }
  };

  const drawListCard = (r, x, top) => {
    const { cardH } = layout;
    const w = CW;
    doc.roundedRect(x, top, w, cardH, 9).lineWidth(0.6).fillAndStroke("#ffffff", LINE);
    let tx = x + 14;
    if (fields.image) {
      const s = cardH - 16;
      doc.roundedRect(x + 8, top + 8, s, s, 6).fill(SOFT);
      const b = images.get(r.id);
      if (b) { try { doc.image(b, x + 12, top + 12, { fit: [s - 8, s - 8], align: "center", valign: "center" }); } catch { /* skip */ } }
      tx = x + 8 + s + 14;
    }
    const priceCol = fields.price || fields.discount || fields.availability ? 120 : 0;
    const tw = x + w - 12 - priceCol - tx;
    let ty = top + 12;
    const k = kicker(r);
    if (k) { doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(7).text(k, tx, ty, { width: tw, lineBreak: false, ellipsis: true, characterSpacing: 0.4 }); ty += 11; }
    doc.font("Helvetica-Bold").fontSize(11.5);
    const nh = Math.min(doc.heightOfString(r.name, { width: tw }), 11.5 * 1.2 * 2);
    doc.fillColor(INK).text(r.name, tx, ty, { width: tw, height: nh + 1, ellipsis: true });
    ty += nh + 4;
    const specs = specsFor(r);
    let specH = 0;
    if (specs) {
      doc.font("Helvetica").fontSize(7);
      specH = Math.min(doc.heightOfString(specs, { width: tw }), 7 * 1.2 * 2, Math.max(0, top + cardH - 10 - ty - 3));
      if (specH < 7) specH = 0;
    }
    const specY = top + cardH - 10 - specH;
    clampText(bodyText(r), tx, ty, tw, specY - ty - 2, "Helvetica", 8.2, "#4b5563");
    if (specH) doc.fillColor(MUTED).font("Helvetica").fontSize(7).text(specs, tx, specY, { width: tw, height: specH + 1, ellipsis: true });
    if (priceCol) {
      const px = x + w - 12 - priceCol;
      let py = top + 14;
      if (fields.price) { doc.fillColor(primary).font("Helvetica-Bold").fontSize(14).text(r.price > 0 ? formatMoney(r.price, ctx) : "—", px, py, { width: priceCol, align: "right", lineBreak: false }); py += 20; }
      if (fields.discount && r.discount > 0) {
        doc.roundedRect(px + priceCol - 42, py, 42, 16, 8).fill(ACCENT);
        doc.fillColor("#fff").font("Helvetica-Bold").fontSize(8).text(`-${r.discount}%`, px + priceCol - 42, py + 4.5, { width: 42, align: "center", lineBreak: false });
        py += 22;
      }
      const av = availability(r);
      if (av) doc.fillColor(av.ok ? "#15803d" : "#b45309").font("Helvetica-Bold").fontSize(7.5).text(av.txt, px, py, { width: priceCol, align: "right", lineBreak: false });
    }
  };

  layout.cardW = layout.cols === 1 ? CW : (CW - layout.gap * (layout.cols - 1)) / layout.cols;
  const groupKey = (r) => (options.groupBy === "brand" ? r.brand : options.groupBy === "none" ? "" : r.category) || (options.groupBy === "none" ? "" : S.uncategorised);

  if (!rows.length) {
    y = newPage();
    doc.fillColor(MUTED).font("Helvetica").fontSize(12).text(S.empty, M, y + 120, { width: CW, align: "center" });
  }

  const groups = [];
  for (const r of rows) {
    const g = groupKey(r);
    const last = groups[groups.length - 1];
    if (last && last.name === g) last.rows.push(r);
    else groups.push({ name: g, rows: [r] });
  }
  for (const g of groups) {
    if (g.name) {
      ensure(34 + layout.cardH);
      doc.roundedRect(M, y, CW, 24, 6).fill(SOFT);
      doc.rect(M, y, 4, 24).fill(ACCENT);
      doc.fillColor(primary).font("Helvetica-Bold").fontSize(11).text(g.name.toUpperCase(), M + 14, y + 7, { width: CW - 80, lineBreak: false, ellipsis: true, characterSpacing: 0.6 });
      doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(String(g.rows.length), M + CW - 60, y + 8, { width: 48, align: "right", lineBreak: false });
      y += 34;
    }
    for (let i = 0; i < g.rows.length; i += layout.cols) {
      ensure(layout.cardH);
      g.rows.slice(i, i + layout.cols).forEach((r, j) => {
        const x = M + j * (layout.cardW + layout.gap);
        (layout.cols === 1 ? drawListCard : drawGridCard)(r, x, y);
      });
      y += layout.cardH + layout.gap;
    }
  }

  // back cover -------------------------------------------------------------------
  if (options.backCover !== false) {
    doc.addPage();
    doc.rect(0, 0, W, H).fill(primary);
    decorate();
    logoCard(90);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(44).text(S.thankYou, M, 245, { width: CW, align: "center" });
    doc.fillColor("#f3e6d8").font("Helvetica").fontSize(14).text(S.letsTalk, M + 40, 305, { width: CW - 80, align: "center" });
    const cw = 420, cx = (W - cw) / 2;
    let cy = 370;
    if (contact) {
      doc.roundedRect(cx, cy, cw, 170, 14).fill("#ffffff");
      avatarCircle(cx + 56, cy + 62, 34);
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(16).text(contact.name, cx + 108, cy + 40, { width: cw - 124 });
      doc.fillColor(MUTED).font("Helvetica").fontSize(10).text(roleLabel(contact), cx + 108, doc.y + 1, { width: cw - 124 });
      label(S.yourContact, cx + 108, cy + 14, cw - 124, ACCENT);
      infoBlock(contactItems(), cx + 108, cy + 90, cw - 124, { size: 11, gap: 4 });
      cy += 190;
    }
    const items = companyItems().filter((i) => i.value);
    if (items.length) {
      doc.save().fillOpacity(0.12).roundedRect(cx, cy, cw, 130, 14).fill("#ffffff").restore();
      infoBlock(items.slice(0, 3), cx + 20, cy + 16, cw / 2 - 30, { valueColor: "#ffffff", labelColor: "#fbbf77", size: 10, gap: 5 });
      infoBlock(items.slice(3), cx + cw / 2 + 10, cy + 16, cw / 2 - 30, { valueColor: "#ffffff", labelColor: "#fbbf77", size: 10, gap: 5 });
    }
    doc.fillColor("#f3e6d8").font("Helvetica").fontSize(8).text(S.pricesNote.replace("{cur}", ctx.currency.code), M + 30, H - 60, { width: CW - 60, align: "center" });
  }

  // footer on product pages ----------------------------------------------------------
  const range = doc.bufferedPageRange();
  for (const idx of productPages) {
    doc.switchToPage(range.start + idx);
    doc.moveTo(M, H - 34).lineTo(W - M, H - 34).lineWidth(0.5).stroke(LINE);
    const foot = [company.name, company.website, company.phone].filter(Boolean).join("  ·  ");
    doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(foot, M, H - 26, { width: CW * 0.7, lineBreak: false, ellipsis: true });
    doc.text(`${S.page} ${idx + 1} ${S.of} ${range.count}`, M + CW * 0.7, H - 26, { width: CW * 0.3, align: "right", lineBreak: false });
  }

  doc.end();
  return done;
}
