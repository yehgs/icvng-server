/**
 * scripts/seedCountryMeta.js
 *
 * Fills in the country-scoped SEO meta title/description
 * (SitePageModel.seo.{title,description}) for Togo (TG), Benin (BJ), and
 * Italy (IT) across every page slug that exists in the GLOBAL/HQ copy
 * (see scripts/seedSitePages.js).
 *
 * The gap this closes: SitePageModel already supports a per-country `seo`
 * override (deep-merged over GLOBAL, same mechanism as `content` — see
 * models/sitePage.model.js), and IT/DIRECTOR-assignable foreign roles
 * (MANAGER, via content.manage) can already edit it per country through
 * the admin panel (route/sitePage.route.js). But nobody had ever actually
 * written the TG/BJ/IT copy — every non-Nigeria storefront's <title> and
 * meta description were silently serving the Nigeria-authored GLOBAL
 * fallback ("About I-Coffee | Nigeria's Leading Coffee Trading Platform",
 * literally naming Nigeria, in English, on i-coffee.tg/.bj/.it).
 *
 * This script only sets `seo` (via $set on that one sub-field, same as
 * upsertPage in seedSitePages.js) — it does NOT touch `content`, so it's
 * safe to run alongside/after seedSitePages.js without clobbering the
 * existing TG content overrides (French copy for partner-with-us,
 * terms-conditions, etc.) that script already seeded.
 *
 * Idempotent — safe to re-run; upserts by (slug, countryCode).
 *
 * Run:  node scripts/seedCountryMeta.js
 */

import dotenv from "dotenv";
import connectDB from "../config/connectDB.js";
import SitePageModel from "../models/sitePage.model.js";

dotenv.config();

async function upsertSeo(slug, countryCode, seo) {
  await SitePageModel.findOneAndUpdate(
    { slug, countryCode },
    { $set: { slug, countryCode, seo, inherit: true, isPublished: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  console.log(`  + ${countryCode} ${slug}: "${seo.title}"`);
}

// ─────────────────────────────────────────────────────────────────────────
// Togo (fr-TG) — I-Coffee Togo, i-coffee.tg, XOF
// ─────────────────────────────────────────────────────────────────────────
const TG_SEO = {
  "about-us": {
    title: "À propos d'I-Coffee | Plateforme de vente de café au Togo",
    description: "Découvrez I-Coffee Togo, la plateforme en ligne qui connecte fournisseurs, entreprises et amateurs de café à Lomé et dans tout le Togo.",
  },
  "our-story": {
    title: "Notre Histoire | I-Coffee Togo",
    description: "Découvrez comment I-Coffee est devenu une plateforme de référence pour le commerce du café au Togo.",
  },
  "partner-with-us": {
    title: "Devenir Partenaire | I-Coffee Togo",
    description: "Rejoignez I-Coffee Togo en tant que fournisseur et développez votre activité café.",
  },
  "contact-us": {
    title: "Contactez-nous | I-Coffee Togo",
    description: "Contactez l'équipe I-Coffee Togo à Lomé pour toute question.",
  },
  faq: {
    title: "FAQ | I-Coffee Togo",
    description: "Réponses aux questions courantes sur les commandes, la livraison et les paiements au Togo.",
  },
  "shipping-policy": {
    title: "Politique de Livraison | I-Coffee Togo",
    description: "Découvrez les méthodes de livraison, zones desservies, délais et frais d'I-Coffee au Togo.",
  },
  "return-policy": {
    title: "Politique de Retour et Remboursement | I-Coffee Togo",
    description: "Conditions de retour, procédure et délais de remboursement d'I-Coffee Togo.",
  },
  "terms-conditions": {
    title: "Conditions Générales | I-Coffee Togo",
    description: "Conditions régissant l'utilisation de la plateforme I-Coffee au Togo — prix en Francs CFA (XOF).",
  },
  "privacy-policy": {
    title: "Politique de Confidentialité | I-Coffee Togo",
    description: "Comment I-Coffee Togo collecte, utilise et protège vos données personnelles.",
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Benin (fr-BJ) — I-Coffee Benin, i-coffee.bj, XOF
// ─────────────────────────────────────────────────────────────────────────
const BJ_SEO = {
  "about-us": {
    title: "À propos d'I-Coffee | Plateforme de vente de café au Bénin",
    description: "Découvrez I-Coffee Bénin, la plateforme en ligne qui connecte fournisseurs, entreprises et amateurs de café à Cotonou et dans tout le Bénin.",
  },
  "our-story": {
    title: "Notre Histoire | I-Coffee Bénin",
    description: "Découvrez comment I-Coffee est devenu une plateforme de référence pour le commerce du café au Bénin.",
  },
  "partner-with-us": {
    title: "Devenir Partenaire | I-Coffee Bénin",
    description: "Rejoignez I-Coffee Bénin en tant que fournisseur et développez votre activité café.",
  },
  "contact-us": {
    title: "Contactez-nous | I-Coffee Bénin",
    description: "Contactez l'équipe I-Coffee Bénin à Cotonou pour toute question.",
  },
  faq: {
    title: "FAQ | I-Coffee Bénin",
    description: "Réponses aux questions courantes sur les commandes, la livraison et les paiements au Bénin.",
  },
  "shipping-policy": {
    title: "Politique de Livraison | I-Coffee Bénin",
    description: "Découvrez les méthodes de livraison, zones desservies, délais et frais d'I-Coffee au Bénin.",
  },
  "return-policy": {
    title: "Politique de Retour et Remboursement | I-Coffee Bénin",
    description: "Conditions de retour, procédure et délais de remboursement d'I-Coffee Bénin.",
  },
  "terms-conditions": {
    title: "Conditions Générales | I-Coffee Bénin",
    description: "Conditions régissant l'utilisation de la plateforme I-Coffee au Bénin — prix en Francs CFA (XOF).",
  },
  "privacy-policy": {
    title: "Politique de Confidentialité | I-Coffee Bénin",
    description: "Comment I-Coffee Bénin collecte, utilise et protège vos données personnelles.",
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Italy (it-IT) — I-Coffee Italy, i-coffee.it, EUR
// ─────────────────────────────────────────────────────────────────────────
const IT_SEO = {
  "about-us": {
    title: "Chi Siamo | Piattaforma di Vendita Caffè in Italia | I-Coffee",
    description: "Scopri I-Coffee Italia, la piattaforma online che collega fornitori, aziende e appassionati di caffè in tutta Italia.",
  },
  "our-story": {
    title: "La Nostra Storia | I-Coffee Italia",
    description: "Scopri come I-Coffee è diventata una piattaforma leader per il commercio del caffè in Italia.",
  },
  "partner-with-us": {
    title: "Diventa Partner | I-Coffee Italia",
    description: "Unisciti a I-Coffee Italia come fornitore e fai crescere la tua attività nel settore del caffè.",
  },
  "contact-us": {
    title: "Contattaci | I-Coffee Italia",
    description: "Contatta il team di I-Coffee Italia per qualsiasi domanda.",
  },
  faq: {
    title: "Domande Frequenti | I-Coffee Italia",
    description: "Risposte alle domande più comuni su ordini, spedizioni e pagamenti in Italia.",
  },
  "shipping-policy": {
    title: "Politica di Spedizione | I-Coffee Italia",
    description: "Scopri i metodi di spedizione, le zone servite, i tempi e i costi di I-Coffee in Italia.",
  },
  "return-policy": {
    title: "Politica di Reso e Rimborso | I-Coffee Italia",
    description: "Condizioni di reso, procedura e tempistiche di rimborso di I-Coffee Italia.",
  },
  "terms-conditions": {
    title: "Termini e Condizioni | I-Coffee Italia",
    description: "Termini che regolano l'utilizzo della piattaforma I-Coffee in Italia — prezzi in Euro (EUR).",
  },
  "privacy-policy": {
    title: "Informativa sulla Privacy | I-Coffee Italia",
    description: "Come I-Coffee Italia raccoglie, utilizza e protegge i tuoi dati personali.",
  },
};

const COUNTRIES = [
  { code: "TG", seo: TG_SEO },
  { code: "BJ", seo: BJ_SEO },
  { code: "IT", seo: IT_SEO },
];

async function main() {
  await connectDB();

  for (const { code, seo } of COUNTRIES) {
    console.log(`→ Seeding SEO metadata for ${code} …`);
    for (const [slug, data] of Object.entries(seo)) {
      await upsertSeo(slug, code, data);
    }
  }

  console.log("✅ Done. Countries seeded:", COUNTRIES.map((c) => c.code).join(", "));
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
