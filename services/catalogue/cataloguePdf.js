/**
 * services/catalogue/cataloguePdf.js
 *
 * Renders catalogue rows (see catalogueService.loadCatalogueRows) to a PDF
 * Buffer with pdfkit. Layout: A4 portrait, branded header on page 1, optional
 * category section bars, one "card row" per product (image · details · price
 * column), "Page X of Y" footer on every page.
 *
 * Only fields switched on in `fields` are drawn. Rows never split across pages.
 */

import PDFDocument from "pdfkit";
import axios from "axios";
import { catalogueStrings } from "./catalogueStrings.js";
import { formatMoney, pdfImageUrl } from "./catalogueService.js";

const COLORS = {
  brand: "#4a2c17",
  accent: "#b8860b",
  text: "#222222",
  muted: "#6b7280",
  line: "#e5e7eb",
  band: "#f5efe8",
  ok: "#15803d",
  warn: "#b45309",
};
const PAGE = { w: 595.28, h: 841.89, margin: 36 };
const IMG = 84;
const PRICE_COL = 118;
const GAP = 10;

// ── Image prefetch (bounded concurrency, tolerant of failures) ───────────────

function looksLikeImage(buf) {
  if (!buf || buf.length < 8) return false;
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  return jpeg || png;
}

export async function prefetchImages(rows, { concurrency = 8, timeout = 7000 } = {}) {
  const map = new Map();
  const queue = rows.filter((r) => r.imageUrl);
  let i = 0;
  async function worker() {
    while (i < queue.length) {
      const row = queue[i++];
      const url = pdfImageUrl(row.imageUrl);
      if (!url) continue;
      try {
        const res = await axios.get(url, {
          responseType: "arraybuffer",
          timeout,
          maxContentLength: 4 * 1024 * 1024,
        });
        const buf = Buffer.from(res.data);
        if (looksLikeImage(buf)) map.set(row.id, buf);
      } catch {
        /* missing image → placeholder box */
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return map;
}

// ── Rendering ────────────────────────────────────────────────────────────────

export async function renderCataloguePdf({ rows, fields, ctx, groupBy = "category", generatedAt = new Date() }) {
  const S = catalogueStrings(ctx.language);
  const images = fields.image ? await prefetchImages(rows) : new Map();

  const doc = new PDFDocument({
    size: "A4",
    margin: PAGE.margin,
    bufferPages: true,
    info: { Title: `${S.title} – ${ctx.countryName}`, Author: ctx.brandName, Creator: ctx.brandName },
  });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = PAGE.margin;
  const contentW = PAGE.w - PAGE.margin * 2;
  const bottom = PAGE.h - PAGE.margin - 18; // leave room for footer

  // Header ------------------------------------------------------------------
  doc.rect(0, 0, PAGE.w, 96).fill(COLORS.brand);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(22).text(ctx.brandName, left, 26, { width: contentW });
  doc.font("Helvetica").fontSize(13).text(`${S.title} · ${ctx.countryName}`, left, 56, { width: contentW });
  const dateStr = new Intl.DateTimeFormat(
    { fr: "fr-FR", it: "it-IT", es: "es-ES", pt: "pt-PT", nl: "nl-NL" }[ctx.language] || "en-GB",
    { dateStyle: "long" },
  ).format(generatedAt);
  doc.fontSize(9).fillColor("#e8d8c8").text(
    `${S.generated}: ${dateStr}   ·   ${S.currency} ${ctx.currency.code}   ·   ${rows.length} ${S.products}`,
    left, 76, { width: contentW },
  );
  doc.y = 112;

  const ensure = (h) => {
    if (doc.y + h > bottom) {
      doc.addPage();
      doc.y = PAGE.margin;
    }
  };

  if (!rows.length) {
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(12).text(S.empty, left, doc.y + 30, { width: contentW, align: "center" });
  }

  let currentGroup = null;
  for (const r of rows) {
    // Section bar --------------------------------------------------------------
    if (groupBy === "category" || groupBy === "brand") {
      const g = (groupBy === "category" ? r.category : r.brand) || S.uncategorised;
      if (g !== currentGroup) {
        ensure(26 + (fields.image ? 150 : 70));
        doc.rect(left, doc.y, contentW, 20).fill(COLORS.band);
        doc.fillColor(COLORS.brand).font("Helvetica-Bold").fontSize(11).text(g.toUpperCase(), left + 8, doc.y + 5, { width: contentW - 16 });
        doc.y += 26;
        currentGroup = g;
      }
    }

    // Measure ------------------------------------------------------------------
    const hasImg = !!fields.image;
    const textX = left + (hasImg ? IMG + GAP : 0);
    const hasPriceCol = fields.price || fields.deliveryPrices || fields.btbPrice || fields.discount;
    const textW = contentW - (hasImg ? IMG + GAP : 0) - (hasPriceCol ? PRICE_COL + GAP : 0);

    const meta = [];
    if (fields.sku && r.sku) meta.push(`${S.sku}: ${r.sku}`);
    if (fields.brand && r.brand) meta.push(`${S.brand}: ${r.brand}`);
    if (fields.category && r.category) meta.push(r.category);
    if (fields.subCategory && r.subCategory) meta.push(r.subCategory);
    if (fields.productType && r.productType) meta.push(S.types[r.productType] || r.productType);
    const metaTxt = meta.join("  ·  ");

    const specs = [];
    if (fields.coffeeDetails) {
      if (r.roastLevel) specs.push(`${S.roastLevel}: ${S.roast[r.roastLevel] || r.roastLevel}`);
      if (r.blend) specs.push(`${S.blend}: ${r.blend}`);
      if (r.origin) specs.push(`${S.origin}: ${r.origin}`);
      if (r.intensity) specs.push(`${S.intensity}: ${r.intensity}`);
      if (r.aroma) specs.push(`${S.aroma}: ${r.aroma}`);
    }
    if (fields.unit && r.unit) specs.push(`${S.unit}: ${r.unit}`);
    if (fields.packaging && r.packaging) specs.push(`${S.packaging}: ${r.packaging}`);
    if (fields.weight && r.weight) specs.push(`${S.weight}: ${r.weight}`);
    if (fields.tags && r.tags.length) specs.push(`${S.tags}: ${r.tags.join(", ")}`);
    if (fields.rating && r.rating > 0) specs.push(`${S.rating}: ${r.rating.toFixed(1)}/5`);
    const specTxt = specs.join("   ·   ");

    const desc = fields.description && r.description ? r.description : fields.shortDescription && r.shortDescription ? r.shortDescription : "";
    const shortAlso = fields.shortDescription && fields.description && r.shortDescription && r.description && r.shortDescription !== r.description ? r.shortDescription : "";

    const m = (txt, font, size, w = textW) => {
      doc.font(font).fontSize(size);
      return txt ? doc.heightOfString(txt, { width: w }) : 0;
    };
    const hName = m(r.name, "Helvetica-Bold", 11);
    const hMeta = m(metaTxt, "Helvetica", 7.5);
    const hShort = m(shortAlso, "Helvetica-Oblique", 8.5);
    const hDesc = m(desc, "Helvetica", 8.5);
    const hSpec = m(specTxt, "Helvetica", 8);
    const hAvail = fields.availability || fields.stockQty ? 12 : 0;
    const textH = hName + (hMeta ? hMeta + 2 : 0) + (hShort ? hShort + 3 : 0) + (hDesc ? hDesc + 3 : 0) + (hSpec ? hSpec + 3 : 0) + (hAvail ? hAvail + 3 : 0);
    const rowH = Math.max(hasImg ? IMG : 0, textH, hasPriceCol ? 62 : 0) + 12;

    ensure(rowH);
    const top = doc.y;

    // Image --------------------------------------------------------------------
    if (hasImg) {
      const buf = images.get(r.id);
      doc.save().roundedRect(left, top, IMG, IMG, 4).lineWidth(0.5).stroke(COLORS.line).restore();
      if (buf) {
        try {
          doc.image(buf, left + 2, top + 2, { fit: [IMG - 4, IMG - 4], align: "center", valign: "center" });
        } catch {
          /* corrupt image */
        }
      } else {
        doc.fillColor(COLORS.muted).font("Helvetica").fontSize(7).text(S.noImage, left, top + IMG / 2 - 4, { width: IMG, align: "center" });
      }
    }

    // Text column --------------------------------------------------------------
    let y = top;
    doc.fillColor(COLORS.text).font("Helvetica-Bold").fontSize(11).text(r.name, textX, y, { width: textW });
    y += hName;
    if (metaTxt) {
      doc.fillColor(COLORS.muted).font("Helvetica").fontSize(7.5).text(metaTxt, textX, y + 2, { width: textW });
      y += hMeta + 2;
    }
    if (shortAlso) {
      doc.fillColor(COLORS.text).font("Helvetica-Oblique").fontSize(8.5).text(shortAlso, textX, y + 3, { width: textW });
      y += hShort + 3;
    }
    if (desc) {
      doc.fillColor(COLORS.text).font("Helvetica").fontSize(8.5).text(desc, textX, y + 3, { width: textW });
      y += hDesc + 3;
    }
    if (specTxt) {
      doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8).text(specTxt, textX, y + 3, { width: textW });
      y += hSpec + 3;
    }
    if (hAvail) {
      const label = r.inStock ? S.inStock : S.onRequest;
      const qty = fields.stockQty && r.stockQty > 0 ? `  (${S.stockQty}: ${r.stockQty})` : "";
      const shown = fields.availability ? `${label}${qty}` : `${S.stockQty}: ${r.stockQty}`;
      doc.fillColor(r.inStock ? COLORS.ok : COLORS.warn).font("Helvetica-Bold").fontSize(8).text(shown, textX, y + 3, { width: textW });
    }

    // Price column -------------------------------------------------------------
    if (hasPriceCol) {
      const px = left + contentW - PRICE_COL;
      let py = top;
      if (fields.price) {
        doc.fillColor(COLORS.brand).font("Helvetica-Bold").fontSize(13).text(r.price > 0 ? formatMoney(r.price, ctx) : "—", px, py, { width: PRICE_COL, align: "right" });
        py += 18;
      }
      if (fields.discount && r.discount > 0) {
        doc.fillColor(COLORS.accent).font("Helvetica-Bold").fontSize(8.5).text(`${S.discount}: -${r.discount}%`, px, py, { width: PRICE_COL, align: "right" });
        py += 12;
      }
      if (fields.deliveryPrices) {
        doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8);
        if (r.delivery3 > 0) { doc.text(`${S.delivery3}: ${formatMoney(r.delivery3, ctx)}`, px - 20, py, { width: PRICE_COL + 20, align: "right" }); py += 11; }
        if (r.delivery5 > 0) { doc.text(`${S.delivery5}: ${formatMoney(r.delivery5, ctx)}`, px - 20, py, { width: PRICE_COL + 20, align: "right" }); py += 11; }
      }
      if (fields.btbPrice && !ctx.isCountryScoped && r.btbPrice > 0) {
        doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8).text(`${S.btbPrice}: ${formatMoney(r.btbPrice, ctx)}`, px - 20, py, { width: PRICE_COL + 20, align: "right" });
      }
    }

    // Row divider --------------------------------------------------------------
    const endY = top + rowH - 6;
    doc.moveTo(left, endY).lineTo(left + contentW, endY).lineWidth(0.5).stroke(COLORS.line);
    doc.y = top + rowH;
  }

  // Footer on every page -------------------------------------------------------
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0; // footer sits inside the bottom margin; avoid auto page-add
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8);
    // Footer text must not trigger auto page-add: draw with lineBreak off.
    doc.text(`${ctx.brandName} · ${S.title}`, left, PAGE.h - PAGE.margin + 4, { width: contentW / 2, lineBreak: false });
    doc.text(`${S.page} ${i + 1} ${S.of} ${range.count}`, left + contentW / 2, PAGE.h - PAGE.margin + 4, { width: contentW / 2, align: "right", lineBreak: false });
  }

  doc.end();
  return done;
}
