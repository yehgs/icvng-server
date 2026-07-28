/**
 * scripts/seedItalyDemoContent.js
 *
 * Item #2 — "Create a script to translate the preheader text for Italy,
 * trust badge, footer and testimonial."
 *
 * Why this is needed: TrustBadgesSection / HeaderTest / TestimonialsSection
 * are all CMS-driven per country (HomeContentBlock), with a fallback chain
 * of "this country's blocks" → "HQ's (Nigeria's) blocks" → hardcoded i18n
 * defaults. Italy (IT) currently has NO HomeContentBlock rows of its own,
 * so visitors on i-coffee.it were silently inheriting Nigeria's raw
 * English/Naira content (₦100,000, "Free shipping … within Lagos") instead
 * of anything Italian — that's the exact bug visible in the screenshots.
 *
 * This mirrors scripts/seedTogoDemoContent.js exactly, but writes IT rows
 * instead of TG. It does NOT touch NG/TG data.
 *
 * Idempotent — upserts by natural key (type + countryCode + title/customerName),
 * safe to re-run. Content is seeded as a starting point; review and edit in
 * Admin → Content → Home Content like any other market's blocks — real
 * contact details (address/phone/email) below are placeholders and should
 * be replaced with Italy's actual details once available.
 *
 * Run:  node scripts/seedItalyDemoContent.js
 */

import dotenv from "dotenv";
import connectDB from "../config/connectDB.js";
import HomeContentBlockModel from "../models/homeContentBlock.model.js";

dotenv.config();

// ─────────────────────────────────────────────────────────────────────────
// 1. Testimonials — Italy (Italian)
// ─────────────────────────────────────────────────────────────────────────
const IT_TESTIMONIALS = [
  {
    customerName: "Giulia Ferrari", customerLocation: "Milano", rating: 5,
    quote: "Ho ordinato una macchina Nespresso di martedì e l'ho ricevuta già giovedì, imballata alla perfezione. Servizio davvero rapido.",
    badge: "Consegna veloce", icon: "truck",
  },
  {
    customerName: "Marco Bianchi", customerLocation: "Roma", rating: 5,
    quote: "Era la prima volta che pagavo online per il caffè e avevo qualche dubbio, ma il tracciamento dell'ordine era reale e l'assistenza ha risposto subito.",
    badge: "Affidabile e sicuro", icon: "shield",
  },
  {
    customerName: "Sofia Romano", customerLocation: "Torino", rating: 5,
    quote: "I chicchi sono sempre freschi e la data di tostatura è stampata sul sacchetto. Si capisce che il magazzino ruota velocemente.",
    badge: "Qualità genuina", icon: "star",
  },
  {
    customerName: "Alessandro Greco", customerLocation: "Napoli", rating: 5,
    quote: "La mia macchina a capsule aveva un piccolo problema dopo due settimane e il team ha organizzato la sostituzione senza alcuna complicazione.",
    badge: "Ottimo supporto", icon: "shield",
  },
  {
    customerName: "Chiara Colombo", customerLocation: "Bologna", rating: 4,
    quote: "La consegna per ordini speciali richiede un po' più di tempo, ma sono stata aggiornata per tutto il percorso ed è arrivato esattamente quando promesso.",
    badge: "Consegna affidabile", icon: "truck",
  },
  {
    customerName: "Davide Ricci", customerLocation: "Firenze", rating: 5,
    quote: "Ordino ogni mese da quasi un anno. I prezzi sono onesti, niente sorprese al checkout, e il sito è davvero facile da usare.",
    badge: "Prezzi trasparenti", icon: "shield",
  },
];

async function upsertTestimonial(t, countryCode) {
  await HomeContentBlockModel.findOneAndUpdate(
    { type: "testimonial", countryCode, customerName: t.customerName },
    { $set: { ...t, type: "testimonial", countryCode, isActive: true } },
    { upsert: true, new: true },
  );
}

async function seedTestimonials() {
  console.log("→ Seeding IT testimonials …");
  for (const t of IT_TESTIMONIALS) await upsertTestimonial(t, "IT");
  console.log(`  + upserted ${IT_TESTIMONIALS.length} testimonial(s) for IT`);
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Trust badges — Italy (Italian, EUR)
// ─────────────────────────────────────────────────────────────────────────
const IT_TRUST_BADGES = [
  { icon: "truck",       title: "Spedizione gratuita", description: "Per ordini superiori a €80 (solo area di Milano)" },
  { icon: "repeat",      title: "Abbonamento caffè",    description: "Chicchi freschi consegnati ogni mese" },
  { icon: "help-circle", title: "Assistenza esperta",   description: "Esperti di caffè a tua disposizione" },
];

async function upsertTrustBadge(b, countryCode, order) {
  await HomeContentBlockModel.findOneAndUpdate(
    { type: "trustBadge", countryCode, title: b.title },
    { $set: { ...b, type: "trustBadge", countryCode, order, isActive: true } },
    { upsert: true, new: true },
  );
}

async function seedTrustBadges() {
  console.log("→ Seeding IT trust badges …");
  for (const [i, b] of IT_TRUST_BADGES.entries()) await upsertTrustBadge(b, "IT", i);
  console.log(`  + upserted ${IT_TRUST_BADGES.length} trust badge(s) for IT`);
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Footer contact details — Italy (placeholder; review in Admin → Content)
// ─────────────────────────────────────────────────────────────────────────
const IT_FOOTER = {
  contactAddress: "Via del Caffè 12, 20121 Milano, Italia",
  contactPhone: "+39 02 1234 5678",
  contactEmail: "info@i-coffee.it",
  contactWhatsapp: "+39 02 1234 5678",
};

async function seedFooter() {
  console.log("→ Seeding IT footer contact details …");
  await HomeContentBlockModel.findOneAndUpdate(
    { type: "footer", countryCode: "IT" },
    { $set: { ...IT_FOOTER, type: "footer", countryCode: "IT", isActive: true } },
    { upsert: true, new: true },
  );
  console.log("  + upserted footer contact details for IT");
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Header preheader message — Italy (Italian)
// ─────────────────────────────────────────────────────────────────────────
const IT_HEADER = { message: "Caffè di qualità, spedizione rapida in tutta Italia" };

async function seedHeader() {
  console.log("→ Seeding IT header preheader message …");
  await HomeContentBlockModel.findOneAndUpdate(
    { type: "header", countryCode: "IT" },
    { $set: { ...IT_HEADER, type: "header", countryCode: "IT", isActive: true } },
    { upsert: true, new: true },
  );
  console.log("  + upserted header message for IT");
}

// ─────────────────────────────────────────────────────────────────────────
async function main() {
  await connectDB();
  await seedTestimonials();
  await seedTrustBadges();
  await seedFooter();
  await seedHeader();
  console.log("✅ Done. Review/edit in Admin → Content → Home Content (switch to Italy).");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
