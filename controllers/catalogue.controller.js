/**
 * controllers/catalogue.controller.js
 *
 * Admin product-catalogue PDF.
 *   GET  /api/admin/catalogue/options  → filter dropdowns, field toggles, printable countries, resolved context
 *   POST /api/admin/catalogue/preview  → count + first rows (localized, converted) for the on-screen preview
 *   POST /api/admin/catalogue/pdf      → the PDF (application/pdf attachment)
 *
 * Access (route-level): catalogue.download permission (SALES, SALES_MANAGER,
 * MANAGER, IT, DIRECTOR) AND catalogueAccess() — a country-scoped (foreign)
 * admin must be a MANAGER. Country scoping/lang/currency: catalogueService.
 */

import {
  resolveCatalogueContext,
  printableCountries,
  loadFilterOptions,
  fieldDefsFor,
  resolveFields,
  loadCatalogueRows,
  CatalogueError,
  BROCHURE_FIELD_DEFS,
  BROCHURE_LAYOUTS,
  resolveBrochureFields,
  loadSalesContacts,
  resolveBrochureContact,
  MAX_PRODUCTS,
  MAX_PRODUCTS_WITH_IMAGES,
} from "../services/catalogue/catalogueService.js";
import { renderCataloguePdf } from "../services/catalogue/cataloguePdf.js";
import { renderBrochurePdf } from "../services/catalogue/brochurePdf.js";
import { catalogueStrings } from "../services/catalogue/catalogueStrings.js";
import { logActivity } from "../utils/activityLogger.js";

const fail = (res, err) => {
  const status = err instanceof CatalogueError ? err.status : 500;
  if (status === 500) console.error("[catalogue]", err);
  return res.status(status).json({
    message: err.message || "Catalogue error",
    code: err.code || "CATALOGUE_ERROR",
    error: true,
    success: false,
  });
};

export async function getCatalogueOptions(req, res) {
  try {
    const ctx = await resolveCatalogueContext({
      countryScope: req.countryScope,
      country: req.query.country,
      language: req.query.language,
    });
    const [filters, countries, contacts] = await Promise.all([
      loadFilterOptions(),
      printableCountries(req.countryScope),
      loadSalesContacts(ctx),
    ]);
    const me = ["SALES", "SALES_MANAGER", "MANAGER"].includes(req.user?.subRole)
      ? contacts.find((c) => c.id === String(req.user._id)) || null
      : null;
    return res.json({
      success: true,
      error: false,
      data: {
        filters,
        countries,
        fields: fieldDefsFor(ctx.isCountryScoped),
        brochure: {
          fields: BROCHURE_FIELD_DEFS,
          layouts: BROCHURE_LAYOUTS,
          company: ctx.company,
          contacts,
          defaultContactId: me?.id || "",
        },
        limits: { maxProducts: MAX_PRODUCTS, maxProductsWithImages: MAX_PRODUCTS_WITH_IMAGES },
        context: {
          countryCode: ctx.countryCode,
          countryName: ctx.countryName,
          language: ctx.language,
          languageFellBack: ctx.languageFellBack,
          supportedLanguages: ctx.supportedLanguages,
          currency: ctx.currency,
          rate: ctx.rate,
          locked: ctx.isCountryScoped, // foreign admins cannot change country/language
        },
      },
    });
  } catch (err) {
    return fail(res, err);
  }
}

async function build(req) {
  const { filters = {}, fields: reqFields, country, language, sort, groupBy } = req.body || {};
  const ctx = await resolveCatalogueContext({ countryScope: req.countryScope, country, language });
  const fields = resolveFields(reqFields, ctx.isCountryScoped);
  const { rows, matched } = await loadCatalogueRows({ filters, fields, ctx, sort });
  const group = ["category", "brand", "none"].includes(groupBy) ? groupBy : "category";
  return { ctx, fields, rows, matched, group };
}

export async function previewCatalogue(req, res) {
  try {
    const { ctx, rows } = await build(req);
    return res.json({
      success: true,
      error: false,
      data: {
        total: rows.length,
        sample: rows.slice(0, 8).map((r) => ({
          id: r.id,
          name: r.name,
          sku: r.sku,
          imageUrl: r.imageUrl,
          category: r.category,
          price: r.price,
          inStock: r.inStock,
        })),
        context: { countryCode: ctx.countryCode, language: ctx.language, currency: ctx.currency, rate: ctx.rate },
      },
    });
  } catch (err) {
    return fail(res, err);
  }
}

export async function downloadCataloguePdf(req, res) {
  try {
    const { ctx, fields, rows, group } = await build(req);
    const pdf = await renderCataloguePdf({ rows, fields, ctx, groupBy: group });
    const S = catalogueStrings(ctx.language);
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `catalogue-${ctx.countryCode}-${ctx.language}-${stamp}.pdf`;

    logActivity({
      userId: req.user?._id,
      action: "CATALOGUE_PDF",
      description: `${S.title}: ${rows.length} products, ${ctx.countryCode}/${ctx.language}/${ctx.currency.code}`,
      resourceType: "Other",
      resourceName: "Product catalogue",
      req,
    }).catch(() => {});

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdf.length);
    res.setHeader("X-Catalogue-Count", String(rows.length));
    return res.end(pdf);
  } catch (err) {
    return fail(res, err);
  }
}

// ── Brochure (customer-facing) ───────────────────────────────────────────────
//   POST /api/admin/catalogue/brochure          → PDF attachment
//   POST /api/admin/catalogue/brochure?inline=1 → same PDF, inline (on-page preview)
export async function brochurePdf(req, res) {
  try {
    const body = req.body || {};
    const ctx = await resolveCatalogueContext({ countryScope: req.countryScope, country: body.country, language: body.language });
    const fields = resolveBrochureFields(body.fields);
    const { rows } = await loadCatalogueRows({ filters: body.filters || {}, fields, ctx, sort: body.sort });
    const contact = await resolveBrochureContact({
      ctx,
      contactUserId: body.contactUserId,
      override: body.contact || {},
      requester: req.user,
    });
    const b = body.brochure || {};
    const options = {
      title: String(b.title || "").slice(0, 80),
      subtitle: String(b.subtitle || "").slice(0, 120),
      preparedFor: String(b.preparedFor || "").slice(0, 80),
      layout: BROCHURE_LAYOUTS.includes(b.layout) ? b.layout : "grid2",
      cover: b.cover !== false,
      backCover: b.backCover !== false,
      groupBy: ["category", "brand", "none"].includes(body.groupBy) ? body.groupBy : "category",
      color: b.color,
      company: Object.fromEntries(
        ["name", "address", "phone", "whatsapp", "email", "website"].map((k) => [k, String(b.company?.[k] || "").slice(0, 200)]),
      ),
    };
    const pdf = await renderBrochurePdf({ rows, fields, ctx, options, contact });
    const stamp = new Date().toISOString().slice(0, 10);
    const inline = req.query.inline === "1";

    if (!inline) {
      logActivity({
        userId: req.user?._id,
        action: "CATALOGUE_PDF",
        description: `Brochure: ${rows.length} products, ${ctx.countryCode}/${ctx.language}/${ctx.currency.code}`,
        resourceType: "Other",
        resourceName: "Product brochure",
        req,
      }).catch(() => {});
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="brochure-${ctx.countryCode}-${ctx.language}-${stamp}.pdf"`);
    res.setHeader("Content-Length", pdf.length);
    res.setHeader("X-Catalogue-Count", String(rows.length));
    return res.end(pdf);
  } catch (err) {
    return fail(res, err);
  }
}
