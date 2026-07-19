// server/controllers/sitePage.controller.js
//
// CRUD + public read for the SitePage CMS (About Us, Our Story, Contact Us,
// FAQ, Shipping Policy, Returns & Refunds, Terms & Conditions, Privacy
// Policy, Partner With Us — and anything else added later by slug).
import mongoose from "mongoose";
import SitePageModel from "../models/sitePage.model.js";
import TranslationModel from "../models/translation.model.js";
import { translateSitePage, applyTranslation } from "../utils/translationService.js";
import { ALL_COUNTRY_CODES } from "../config/countries/index.js";

// ── helpers ──────────────────────────────────────────────────────────────

/** Deep-merge `override` on top of `base`. Arrays are replaced wholesale
 * (an overridden list, e.g. delivery zones, is meant to fully replace the
 * base list, not interleave with it) — only plain objects merge key-by-key. */
function deepMerge(base, override) {
  if (override === undefined) return base;
  if (
    base && typeof base === "object" && !Array.isArray(base) &&
    override && typeof override === "object" && !Array.isArray(override)
  ) {
    const out = { ...base };
    for (const key of Object.keys(override)) {
      out[key] = deepMerge(base[key], override[key]);
    }
    return out;
  }
  return override;
}

/**
 * Resolve the effective content for (slug, countryCode), applying the
 * GLOBAL → country-override → language-translation chain, and return
 * both the merged doc and the "identity" doc (the one whose _id owns the
 * translation, so edits/translation triggers land on the right record).
 */
async function resolvePageContent(slug, countryCode, language) {
  const globalDoc = await SitePageModel.findOne({ slug, countryCode: "GLOBAL" }).lean();
  let countryDoc = null;
  if (countryCode && countryCode !== "GLOBAL") {
    countryDoc = await SitePageModel.findOne({ slug, countryCode }).lean();
  }

  let winner; // the doc whose _id we translate against
  let mergedContent;
  let mergedSeo;

  if (countryDoc && countryDoc.isPublished !== false) {
    winner = countryDoc;
    if (countryDoc.inherit !== false && globalDoc) {
      mergedContent = deepMerge(globalDoc.content || {}, countryDoc.content || {});
      mergedSeo = deepMerge(globalDoc.seo || {}, countryDoc.seo || {});
    } else {
      mergedContent = countryDoc.content || {};
      mergedSeo = countryDoc.seo || {};
    }
  } else if (globalDoc) {
    winner = globalDoc;
    mergedContent = globalDoc.content || {};
    mergedSeo = globalDoc.seo || {};
  } else {
    return null;
  }

  // Apply translation on top of whichever content resolved above. The
  // Translation record is keyed to the SAME document that produced the
  // winning content (country override if it exists, otherwise GLOBAL) —
  // so a Togo editor's French translation always translates Togo's own
  // words, not HQ's, once Togo has created an override.
  if (language && language !== "en") {
    const translation = await TranslationModel.findOne({
      entityType: "page",
      entityId: winner._id,
      language,
    }).lean();
    if (translation?.fields) {
      mergedContent = applyTranslation({ content: mergedContent }, { content: translation.fields.content }).content;
      mergedSeo = applyTranslation({ seo: mergedSeo }, { seo: translation.fields.seo }).seo;
    }
  }

  return {
    slug,
    countryCode: winner.countryCode,
    resolvedFrom: winner.countryCode,
    usedGlobalFallback: winner.countryCode === "GLOBAL",
    content: mergedContent,
    seo: mergedSeo,
    updatedAt: winner.updatedAt,
    sourceId: winner._id,
    globalId: globalDoc?._id || null,
    hasCountryOverride: Boolean(countryDoc),
  };
}

// ── Public: storefront read ─────────────────────────────────────────────
// GET /api/site-pages/public/:slug
export const getPublicSitePage = async (req, res) => {
  try {
    const { slug } = req.params;
    const targetCountry = (req.query.countryCode || req.country?.code || "NG").toUpperCase();
    const language =
      (req.headers["x-language"] || req.query.lang || "").toLowerCase() ||
      req.country?.language?.default ||
      "en";

    const resolved = await resolvePageContent(slug, targetCountry, language);
    if (!resolved) {
      return res.status(404).json({ success: false, error: true, message: "Page not found" });
    }
    return res.json({ success: true, error: false, data: resolved });
  } catch (err) {
    console.error("getPublicSitePage error:", err);
    return res.status(500).json({ success: false, error: true, message: err.message });
  }
};

// ── Admin: list all slugs with per-country coverage summary ────────────
// GET /api/site-pages/admin/summary
export const getSitePagesSummary = async (req, res) => {
  try {
    const docs = await SitePageModel.find({}).select("slug countryCode isPublished updatedAt").lean();
    const bySlug = {};
    for (const d of docs) {
      if (!bySlug[d.slug]) bySlug[d.slug] = { slug: d.slug, countries: [] };
      bySlug[d.slug].countries.push({
        countryCode: d.countryCode,
        isPublished: d.isPublished,
        updatedAt: d.updatedAt,
      });
    }
    return res.json({ success: true, error: false, data: Object.values(bySlug) });
  } catch (err) {
    return res.status(500).json({ success: false, error: true, message: err.message });
  }
};

// ── Admin: get one (slug, countryCode) document for editing ─────────────
// GET /api/site-pages/admin/:slug/:countryCode
export const getAdminSitePage = async (req, res) => {
  try {
    const { slug } = req.params;
    const countryCode = req.params.countryCode.toUpperCase();

    // COUNTRY-scoped editors can only ever work on GLOBAL (read-only view,
    // enforced below) or their own assigned country — never someone else's.
    if (req.countryScope && countryCode !== "GLOBAL" && countryCode !== req.countryScope) {
      return res.status(403).json({ success: false, error: true, message: "Not permitted to edit this country's content" });
    }

    let doc = await SitePageModel.findOne({ slug, countryCode }).lean();
    const globalDoc =
      countryCode === "GLOBAL" ? doc : await SitePageModel.findOne({ slug, countryCode: "GLOBAL" }).lean();

    return res.json({
      success: true,
      error: false,
      data: {
        doc, // null if this country has never created an override
        globalContent: globalDoc?.content || {},
        globalSeo: globalDoc?.seo || {},
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: true, message: err.message });
  }
};

// ── Admin: create or update (upsert) a (slug, countryCode) document ─────
// PUT /api/site-pages/admin/:slug/:countryCode
export const upsertSitePage = async (req, res) => {
  try {
    const { slug } = req.params;
    const countryCode = req.params.countryCode.toUpperCase();

    if (req.countryScope) {
      // A COUNTRY-scoped EDITOR may only write their own market's override —
      // GLOBAL (HQ master copy) stays HQ/GLOBAL-admin-only.
      if (countryCode === "GLOBAL") {
        return res.status(403).json({ success: false, error: true, message: "Only HQ (GLOBAL) admins can edit the master content" });
      }
      if (countryCode !== req.countryScope) {
        return res.status(403).json({ success: false, error: true, message: "Not permitted to edit another country's content" });
      }
    }

    if (countryCode !== "GLOBAL" && !ALL_COUNTRY_CODES.includes(countryCode)) {
      return res.status(400).json({ success: false, error: true, message: "Unknown country code" });
    }

    const { content, seo, inherit, isPublished, notes } = req.body;

    const update = {
      slug,
      countryCode,
      ...(content !== undefined && { content }),
      ...(seo !== undefined && { seo }),
      ...(inherit !== undefined && { inherit }),
      ...(isPublished !== undefined && { isPublished }),
      ...(notes !== undefined && { notes }),
      updatedBy: req.user?._id,
    };

    const doc = await SitePageModel.findOneAndUpdate(
      { slug, countryCode },
      { $set: update, $setOnInsert: { createdBy: req.user?._id } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.json({ success: true, error: false, data: doc, message: "Saved" });
  } catch (err) {
    console.error("upsertSitePage error:", err);
    return res.status(500).json({ success: false, error: true, message: err.message });
  }
};

// ── Admin: delete a country override (reverts that market to GLOBAL) ────
// DELETE /api/site-pages/admin/:slug/:countryCode
export const deleteSitePageOverride = async (req, res) => {
  try {
    const { slug } = req.params;
    const countryCode = req.params.countryCode.toUpperCase();

    if (countryCode === "GLOBAL") {
      return res.status(400).json({ success: false, error: true, message: "The GLOBAL master document cannot be deleted, only edited" });
    }
    if (req.countryScope && countryCode !== req.countryScope) {
      return res.status(403).json({ success: false, error: true, message: "Not permitted" });
    }

    const doc = await SitePageModel.findOneAndDelete({ slug, countryCode });
    if (!doc) return res.status(404).json({ success: false, error: true, message: "No override to remove" });

    // Its translations go with it — they were translations of THIS
    // document's wording, not GLOBAL's.
    await TranslationModel.deleteMany({ entityType: "page", entityId: doc._id });

    return res.json({ success: true, error: false, message: `${countryCode} now inherits GLOBAL content again` });
  } catch (err) {
    return res.status(500).json({ success: false, error: true, message: err.message });
  }
};

// ── Admin: trigger auto-translation of a (slug, countryCode) doc ────────
// POST /api/site-pages/admin/:slug/:countryCode/translate
export const triggerSitePageTranslation = async (req, res) => {
  try {
    const { slug } = req.params;
    const countryCode = req.params.countryCode.toUpperCase();
    const { targetLangs, sourceLang = "en" } = req.body || {};

    const doc = await SitePageModel.findOne({ slug, countryCode });
    if (!doc) return res.status(404).json({ success: false, error: true, message: "Save this page/country before translating" });

    translateSitePage({
      entityId: doc._id,
      document: { content: doc.content, seo: doc.seo },
      sourceLang,
      targetLangs,
    }).catch((err) => console.error("Background site-page translation error:", err.message));

    return res.json({ success: true, error: false, message: "Translation queued" });
  } catch (err) {
    return res.status(500).json({ success: false, error: true, message: err.message });
  }
};

// ── Admin: list all translations for a (slug, countryCode) doc ──────────
// GET /api/site-pages/admin/:slug/:countryCode/translations
export const getSitePageTranslations = async (req, res) => {
  try {
    const { slug } = req.params;
    const countryCode = req.params.countryCode.toUpperCase();
    const doc = await SitePageModel.findOne({ slug, countryCode }).select("_id");
    if (!doc) return res.json({ success: true, error: false, data: [] });

    const docs = await TranslationModel.find({ entityType: "page", entityId: doc._id }).lean();
    return res.json({ success: true, error: false, data: docs });
  } catch (err) {
    return res.status(500).json({ success: false, error: true, message: err.message });
  }
};

// ── Admin: manually edit/override one language's translation ────────────
// PUT /api/site-pages/admin/:slug/:countryCode/translations/:language
export const updateSitePageTranslation = async (req, res) => {
  try {
    const { slug, language } = req.params;
    const countryCode = req.params.countryCode.toUpperCase();
    const { content, seo } = req.body;

    const doc = await SitePageModel.findOne({ slug, countryCode }).select("_id");
    if (!doc) return res.status(404).json({ success: false, error: true, message: "Save this page/country before adding translations" });

    const updated = await TranslationModel.findOneAndUpdate(
      { entityType: "page", entityId: doc._id, language },
      {
        fields: { content: content || {}, seo: seo || {} },
        autoTranslated: false,
        translatedAt: new Date(),
        engine: "manual",
      },
      { upsert: true, new: true }
    );

    return res.json({ success: true, error: false, data: updated, message: "Translation saved" });
  } catch (err) {
    return res.status(500).json({ success: false, error: true, message: err.message });
  }
};
