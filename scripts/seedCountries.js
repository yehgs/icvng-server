/**
 * scripts/seedCountries.js
 *
 * PHASE 3 — seeds/updates the Country collection from config/countries/index.js.
 * Idempotent. Nigeria is marked HQ. Never deletes countries.
 *
 * Run:  node scripts/seedCountries.js
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import connectDB from "../config/connectDB.js";
import CountryModel from "../models/country.model.js";
import { COUNTRY_CONFIG, DEFAULT_COUNTRY } from "../config/countries/index.js";

dotenv.config();

async function seedCountries() {
  await connectDB();
  console.log("→ Seeding countries from config/countries/index.js …");

  let created = 0;
  let updated = 0;

  for (const [code, cfg] of Object.entries(COUNTRY_CONFIG)) {
    const isHQ = code === DEFAULT_COUNTRY; // Nigeria = HQ
    const payload = {
      code,
      name: cfg.name,
      status: "ACTIVE",
      isHQ,
      domain: cfg.domain || "",
      domains: [cfg.domain, `www.${cfg.domain}`].filter(Boolean),
      adminDomain: cfg.adminDomain || "",
      currency: cfg.currency || {},
      language: cfg.language || { default: "en", supported: ["en"] },
      timezone: cfg.timezone || "",
      phonePrefix: cfg.phonePrefix || "",
      flagEmoji: cfg.flagEmoji || "",
      payments: cfg.payments || {},
      seo: cfg.seo || {},
    };

    const existing = await CountryModel.findOne({ code });
    if (!existing) {
      await CountryModel.create(payload);
      created++;
      console.log(`  + created ${code} (${cfg.name})${isHQ ? " [HQ]" : ""}`);
    } else {
      // Update config-derived fields only; preserve admin-edited tax/shipping/
      // branding/contacts/featureFlags/invoiceSeries.
      existing.name = payload.name;
      existing.domain = payload.domain;
      existing.domains = Array.from(new Set([...(existing.domains || []), ...payload.domains]));
      existing.adminDomain = payload.adminDomain;
      existing.currency = payload.currency;
      existing.language = payload.language;
      existing.timezone = payload.timezone;
      existing.phonePrefix = payload.phonePrefix;
      existing.flagEmoji = payload.flagEmoji;
      existing.payments = payload.payments;
      existing.seo = payload.seo;
      existing.isHQ = isHQ;
      await existing.save();
      updated++;
      console.log(`  ~ updated ${code} (${cfg.name})${isHQ ? " [HQ]" : ""}`);
    }
  }

  console.log(`✓ Countries seeded. created=${created} updated=${updated}`);
  await mongoose.disconnect();
  process.exit(0);
}

seedCountries().catch((err) => {
  console.error("Country seeding failed:", err);
  process.exit(1);
});
