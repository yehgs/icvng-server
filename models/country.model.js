/**
 * models/country.model.js
 *
 * PHASE 3 — COUNTRY AS A FIRST-CLASS ENTITY
 *
 * Countries become real business entities instead of a static config file.
 * Seeded from config/countries/index.js (COUNTRY_CONFIG), which remains the
 * fallback so the app works before/without seeding — same pattern as roles.
 *
 * HQ resolution:
 *   isHQ: true  → Nigeria (headquarters). Owns global config, warehouses,
 *                 stock, procurement, master catalog, system settings.
 *   Only one country should be HQ.
 *
 * Adding a country becomes: create a Country doc + map its domain. No deploy.
 */

import mongoose from "mongoose";

const currencySchema = new mongoose.Schema(
  {
    code: { type: String, required: true },      // "NGN"
    symbol: { type: String, default: "" },        // "₦"
    name: { type: String, default: "" },          // "Nigerian Naira"
    decimals: { type: Number, default: 2 },
  },
  { _id: false }
);

const languageSchema = new mongoose.Schema(
  {
    default: { type: String, default: "en" },
    supported: { type: [String], default: ["en"] },
    locale: { type: String, default: "en-NG" },
  },
  { _id: false }
);

const countrySchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },

    // Lifecycle: only ACTIVE countries serve storefronts and accept orders.
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "COMING_SOON"],
      default: "ACTIVE",
      index: true,
    },

    // Headquarters flag. Exactly one country should be HQ (Nigeria).
    isHQ: { type: Boolean, default: false, index: true },

    // Primary domain + any additional domains that map to this country.
    domain: { type: String, default: "" },
    domains: { type: [String], default: [] },
    adminDomain: { type: String, default: "" },

    currency: { type: currencySchema, default: () => ({}) },
    language: { type: languageSchema, default: () => ({}) },

    timezone: { type: String, default: "Africa/Lagos" },
    phonePrefix: { type: String, default: "" },
    flagEmoji: { type: String, default: "" },

    payments: {
      paystack: { type: Boolean, default: false },
      stripe: { type: Boolean, default: false },
    },

    // Per-country tax configuration (used by invoices/checkout later phases).
    tax: {
      enabled: { type: Boolean, default: false },
      rate: { type: Number, default: 0 },       // percent
      label: { type: String, default: "VAT" },
      inclusive: { type: Boolean, default: false },
    },

    // Per-country shipping defaults (informational scaffold for later phases).
    shipping: {
      freeThreshold: { type: Number, default: null },
      defaultFee: { type: Number, default: 0 },
    },

    // Branding assets (logo/colors) with HQ fallback handled in resolver.
    branding: {
      logo: { type: String, default: "" },
      primaryColor: { type: String, default: "" },
    },

    // Support / contact details surfaced on the storefront.
    contacts: {
      email: { type: String, default: "" },
      phone: { type: String, default: "" },
      whatsapp: { type: String, default: "" },
      address: { type: String, default: "" },
    },

    // Editable storefront content (header/footer copy) that doesn't belong
    // in a translated entity of its own — content-managed here per country,
    // with translations stored in the Translation collection
    // (entityType: "country", field keys "content.preheaderMessage", "contacts.address").
    content: {
      preheaderMessage: { type: String, default: "" },
    },

    // Per-country Tawk.to live-chat widget. Each market can run its own
    // Tawk.to property (e.g. a Togo agent queue for i-coffee.tg) instead of
    // sharing a single hardcoded widget across every domain.
    tawk: {
      propertyId: { type: String, default: "" },
      widgetId: { type: String, default: "" },
    },

    seo: {
      siteName: { type: String, default: "" },
      tld: { type: String, default: "" },
    },

    // Per-country feature flags — enable/disable modules without code.
    featureFlags: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Invoice numbering series per country.
    invoiceSeries: {
      prefix: { type: String, default: "INV" },
      nextNumber: { type: Number, default: 1 },
    },
  },
  { timestamps: true }
);

const CountryModel = mongoose.model("Country", countrySchema);

export default CountryModel;
