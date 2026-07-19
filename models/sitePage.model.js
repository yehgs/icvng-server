// server/models/sitePage.model.js
//
// Generic, admin-editable CMS store for static/marketing pages — About Us,
// Our Story, Partner With Us, Contact Us, FAQ, Shipping Policy,
// Returns & Refunds, Terms & Conditions, Privacy Policy, and any page added
// later. Deliberately NOT modelled with a bespoke schema per page: every
// page's copy is a flat dictionary of `key -> value` where `value` is a
// string, a number, or a JSON array of objects (list items, FAQ entries,
// table rows, etc). This is what makes the CRUD system in the admin truly
// dynamic — a new country/domain/language, or a brand-new content key on an
// existing page, never requires a schema change or a deploy.
//
// Content resolution (see sitePage.controller.js#resolvePageContent):
//   1. One "GLOBAL" document per slug holds the master copy. Today that
//      master copy is exactly what Nigeria's storefront has always shown —
//      Nigeria was the only market in mind when this text was written.
//   2. A country may optionally have its OWN document for the same slug.
//      When present, its keys are deep-merged OVER the GLOBAL document, so a
//      country only needs to author the handful of keys that differ (e.g.
//      Togo doesn't repeat the entire Shipping Policy — it just overrides
//      `deliveryZones`, `contactAddress`, `freeShippingNote`, ones that
//      referenced Lagos-only facts) rather than forking the whole page.
//   3. A country document can also flip `inherit: false` to fully replace
//      (not merge with) the GLOBAL copy, for pages that genuinely have
//      nothing in common with HQ's version.
//   4. Translations layer on top of whichever resolved document wins, via
//      the existing Translation collection (entityType: "page"), so the
//      same country can serve the same facts in more than one language.
import mongoose from "mongoose";
import { ALL_COUNTRY_CODES } from "../config/countries/index.js";

const sitePageSchema = new mongoose.Schema(
  {
    // Stable identifier for the page, matches the client route, e.g.
    // "about-us", "our-story", "partner-with-us", "contact-us", "faq",
    // "shipping-policy", "return-policy", "terms-conditions",
    // "privacy-policy". New pages just need a new slug — no code change.
    slug: { type: String, required: true, trim: true, lowercase: true, index: true },

    // "GLOBAL" = the master/HQ-authored document every country falls back
    // to. Otherwise one of the live country codes overriding/extending it.
    countryCode: {
      type: String,
      required: true,
      uppercase: true,
      enum: ["GLOBAL", ...ALL_COUNTRY_CODES],
      default: "GLOBAL",
      index: true,
    },

    // When true (default), this document's `content` keys are deep-merged
    // on top of the GLOBAL document for the same slug. When false, this
    // document is served as-is with no HQ fallback for missing keys.
    inherit: { type: Boolean, default: true },

    // The actual editable copy: flat "key -> value" dictionary. Values may
    // be strings (headings/paragraphs), numbers, or arrays of plain objects
    // (FAQ items, timeline entries, contact cards, table rows, etc). Kept
    // as Mixed on purpose — this is the "no schema change per page" trick.
    content: { type: mongoose.Schema.Types.Mixed, default: {} },

    // SEO metadata for the page (also translatable/overridable).
    seo: {
      title: { type: String, default: "" },
      description: { type: String, default: "" },
    },

    isPublished: { type: Boolean, default: true },

    // Free text for editors — not shown on the storefront.
    notes: { type: String, default: "" },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// One document per (slug, countryCode) — GLOBAL counts as a "country" here.
sitePageSchema.index({ slug: 1, countryCode: 1 }, { unique: true });

const SitePageModel = mongoose.model("SitePage", sitePageSchema);
export default SitePageModel;
