/**
 * scripts/seedTogoDemoContent.js
 *
 * Seeds demo content so i-coffee.tg (Togo) isn't empty while the real
 * editorial team populates it, and backfills the Nigeria equivalents into
 * the DB-backed content systems (previously some of this only existed as
 * client-side fallback constants, not real admin-editable rows):
 *
 *   1. ~10 dummy FOMO "just purchased" entries for Togo, French/Togolese
 *      names and products, in XOF.
 *   2. 6 Togo testimonials (French) + the 6 original Nigeria testimonials
 *      (English) as real HomeContentBlock rows.
 *   3. Trust badges — Nigeria (English, current copy) + Togo (French).
 *   4. Footer contact details — Nigeria (current) + Togo (French/local).
 *   5. Header preheader message — Nigeria (current) + Togo (French).
 *
 * Idempotent: re-running updates existing rows (matched by a natural key)
 * instead of duplicating them, EXCEPT the FOMO dummy users, which are
 * matched by name within Togo's settings doc and skipped if already present.
 *
 * Run:  node scripts/seedTogoDemoContent.js
 */

import dotenv from "dotenv";
import connectDB from "../config/connectDB.js";
import FomoModel from "../models/fomo.model.js";
import HomeContentBlockModel from "../models/homeContentBlock.model.js";

dotenv.config();

// ─────────────────────────────────────────────────────────────────────────
// 1. FOMO dummy users — Togo
// ─────────────────────────────────────────────────────────────────────────
const TOGO_FOMO_USERS = [
  { name: "Komi Adjovi",     state: "Lomé",      productName: "Nespresso Original Intenso",       price: 12500, quantity: 2 },
  { name: "Ama Kokou",       state: "Lomé",      productName: "Café Moulu Lavazza",               price: 8500,  quantity: 1 },
  { name: "Yawa Mensah",     state: "Kara",      productName: "Dolce Gusto Cappuccino",            price: 9800,  quantity: 1 },
  { name: "Kossi Amegan",    state: "Sokodé",    productName: "Machine à café Nespresso Vertuo",   price: 78000, quantity: 1 },
  { name: "Afi Dogbe",       state: "Lomé",      productName: "Capsules Barattini Cremoso",        price: 14200, quantity: 3 },
  { name: "Kodjo Agbodjan",  state: "Kpalimé",   productName: "Café en Grains 100% Arabica",       price: 21000, quantity: 1 },
  { name: "Essi Tchamie",    state: "Atakpamé",  productName: "Nespresso Vertuo Lattissima",       price: 95000, quantity: 1 },
  { name: "Sena Kpodo",      state: "Lomé",      productName: "Capsules Caffitaly Decaf",          price: 11000, quantity: 2 },
  { name: "Mawuli Klu",      state: "Dapaong",   productName: "Café Instantané Premium",           price: 6500,  quantity: 2 },
  { name: "Akosua Fiawoo",   state: "Lomé",      productName: "Senseo Dosettes Corsé",             price: 9200,  quantity: 1 },
];

async function seedTogoFomo() {
  console.log("→ Seeding Togo FOMO dummy users …");
  let settings = await FomoModel.findOne({ countryCode: "TG" });
  if (!settings) settings = await FomoModel.create({ countryCode: "TG" });

  const existingNames = new Set(settings.dummyUsers.map((u) => u.name));
  let added = 0;

  for (const [i, u] of TOGO_FOMO_USERS.entries()) {
    if (existingNames.has(u.name)) continue;
    settings.dummyUsers.push({
      name: u.name,
      state: u.state,
      isActive: true,
      productName: u.productName,
      productImage: "",
      price: u.price,
      quantity: u.quantity,
      // Stagger purchase times so the widget doesn't show them all as
      // "just now" — spread across the last few hours/days.
      purchasedAt: new Date(Date.now() - (i + 1) * 3 * 60 * 60 * 1000),
    });
    added++;
  }

  // Make sure the widget actually mixes them in.
  settings.useDummyUsers = true;
  if (!settings.notificationMessage) settings.notificationMessage = "Just purchased";

  await settings.save();
  console.log(`  + added ${added} dummy user(s) for TG (${settings.dummyUsers.length} total)`);
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Testimonials — Nigeria (original copy) + Togo (French)
// ─────────────────────────────────────────────────────────────────────────
const NG_TESTIMONIALS = [
  {
    customerName: "Fatima Tariq", customerLocation: "Lagos", rating: 5,
    quote: "Ordered a Lavazza machine on a Tuesday and it was at my door by Thursday. Faster than I expected for Lagos traffic, and it arrived perfectly packaged.",
    badge: "Fast delivery", icon: "truck",
  },
  {
    customerName: "Mia Schneider", customerLocation: "Abuja", rating: 5,
    quote: "I was nervous paying online for the first time, but everything about i-Coffee felt legitimate — order updates, real tracking, and support that actually replied.",
    badge: "Trusted & secure", icon: "shield",
  },
  {
    customerName: "Luca Francesco", customerLocation: "Port Harcourt", rating: 5,
    quote: "The coffee beans are always fresh and the roast dates are printed right on the bag. You can tell they don't let stock sit around.",
    badge: "Genuine quality", icon: "star",
  },
  {
    customerName: "Tunde Bakare", customerLocation: "Ibadan", rating: 5,
    quote: "My capsule machine had a small issue after two weeks and their team sorted a replacement without any back and forth. That's rare these days.",
    badge: "Great support", icon: "shield",
  },
  {
    customerName: "Olivia Marie", customerLocation: "Kano", rating: 4,
    quote: "Delivery to Kano usually takes a bit longer for special orders, but they kept me updated the whole way and it arrived exactly when promised.",
    badge: "Reliable delivery", icon: "truck",
  },
  {
    customerName: "Emeka Nwosu", customerLocation: "Enugu", rating: 5,
    quote: "Been ordering monthly for almost a year now. Prices are honest, nothing hidden at checkout, and the site is genuinely easy to use.",
    badge: "Honest pricing", icon: "shield",
  },
];

const TG_TESTIMONIALS = [
  {
    customerName: "Komlan Agbeko", customerLocation: "Lomé", rating: 5,
    quote: "J'ai commandé une machine Nespresso un mardi et je l'ai reçue dès le jeudi. Le colis était parfaitement emballé et tout s'est passé sans accroc.",
    badge: "Livraison rapide", icon: "truck",
  },
  {
    customerName: "Adjoa Mensah", customerLocation: "Kara", rating: 5,
    quote: "C'était ma première fois à payer en ligne au Togo et j'avais des doutes, mais le suivi de commande était réel et le support a toujours répondu rapidement.",
    badge: "Fiable et sécurisé", icon: "shield",
  },
  {
    customerName: "Yao Kodjo", customerLocation: "Sokodé", rating: 5,
    quote: "Les grains de café sont toujours frais et la date de torréfaction est indiquée sur le sac. On sent que le stock ne traîne pas en entrepôt.",
    badge: "Qualité authentique", icon: "star",
  },
  {
    customerName: "Afi Amegan", customerLocation: "Lomé", rating: 5,
    quote: "Ma machine à capsules avait un petit souci après deux semaines et l'équipe a organisé un remplacement sans complications. C'est rare de nos jours.",
    badge: "Excellent support", icon: "shield",
  },
  {
    customerName: "Kossi Dogbevi", customerLocation: "Kpalimé", rating: 4,
    quote: "La livraison à Kpalimé prend un peu plus de temps pour les commandes spéciales, mais on est tenu informé tout du long et ça arrive comme prévu.",
    badge: "Livraison fiable", icon: "truck",
  },
  {
    customerName: "Ama Tchalim", customerLocation: "Atakpamé", rating: 5,
    quote: "Je commande chaque mois depuis presque un an maintenant. Les prix sont honnêtes, rien de caché au paiement, et le site est vraiment simple à utiliser.",
    badge: "Prix honnêtes", icon: "shield",
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
  console.log("→ Seeding testimonials …");
  for (const t of NG_TESTIMONIALS) await upsertTestimonial(t, "NG");
  console.log(`  + upserted ${NG_TESTIMONIALS.length} testimonial(s) for NG`);
  for (const t of TG_TESTIMONIALS) await upsertTestimonial(t, "TG");
  console.log(`  + upserted ${TG_TESTIMONIALS.length} testimonial(s) for TG`);
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Trust badges — Nigeria (current copy) + Togo (French)
// ─────────────────────────────────────────────────────────────────────────
const NG_TRUST_BADGES = [
  { icon: "truck",        title: "Free Shipping",       description: "On orders over ₦100,000 (Within Lagos only)" },
  { icon: "repeat",       title: "Coffee Subscription",  description: "Fresh beans delivered monthly" },
  { icon: "help-circle",  title: "Expert Support",       description: "Coffee experts available" },
];

const TG_TRUST_BADGES = [
  { icon: "truck",        title: "Livraison rapide",     description: "Sur les commandes de plus de 50 000 CFA (à Lomé uniquement)" },
  { icon: "repeat",       title: "Abonnement café",      description: "Grains frais livrés chaque mois" },
  { icon: "help-circle",  title: "Support expert",       description: "Des experts café à votre écoute" },
];

async function upsertTrustBadge(b, countryCode, order) {
  await HomeContentBlockModel.findOneAndUpdate(
    { type: "trustBadge", countryCode, title: b.title },
    { $set: { ...b, type: "trustBadge", countryCode, order, isActive: true } },
    { upsert: true, new: true },
  );
}

async function seedTrustBadges() {
  console.log("→ Seeding trust badges …");
  for (const [i, b] of NG_TRUST_BADGES.entries()) await upsertTrustBadge(b, "NG", i);
  console.log(`  + upserted ${NG_TRUST_BADGES.length} trust badge(s) for NG`);
  for (const [i, b] of TG_TRUST_BADGES.entries()) await upsertTrustBadge(b, "TG", i);
  console.log(`  + upserted ${TG_TRUST_BADGES.length} trust badge(s) for TG`);
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Footer contact details — Nigeria (current) + Togo (French/local)
// ─────────────────────────────────────────────────────────────────────────
const NG_FOOTER = {
  contactAddress: "3 Kaffi Street, Alausa, Ikeja, Lagos, Nigeria",
  contactPhone: "+234 805 242 3935",
  contactEmail: "customercare@i-coffee.ng",
  contactWhatsapp: "+234 805 242 3935",
};

const TG_FOOTER = {
  contactAddress: "12 Rue du Commerce, Bè, Lomé, Togo",
  contactPhone: "+228 90 12 34 56",
  contactEmail: "clientele@i-coffee.tg",
  contactWhatsapp: "+228 90 12 34 56",
};

async function seedFooter() {
  console.log("→ Seeding footer contact details …");
  for (const [countryCode, data] of [["NG", NG_FOOTER], ["TG", TG_FOOTER]]) {
    await HomeContentBlockModel.findOneAndUpdate(
      { type: "footer", countryCode },
      { $set: { ...data, type: "footer", countryCode, isActive: true } },
      { upsert: true, new: true },
    );
    console.log(`  + upserted footer contact details for ${countryCode}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 5. Header preheader message — Nigeria (current) + Togo (French)
// ─────────────────────────────────────────────────────────────────────────
const NG_HEADER = { message: "Free shipping on orders over ₦100,000 within Lagos!" };
// Matches the message an admin had already entered manually for Togo, so
// re-running this script is a no-op there rather than overwriting it with
// something different.
const TG_HEADER = { message: "Café de qualité à bon prix, livraison dans tout le Togo" };

async function seedHeader() {
  console.log("→ Seeding header preheader message …");
  for (const [countryCode, data] of [["NG", NG_HEADER], ["TG", TG_HEADER]]) {
    await HomeContentBlockModel.findOneAndUpdate(
      { type: "header", countryCode },
      { $set: { ...data, type: "header", countryCode, isActive: true } },
      { upsert: true, new: true },
    );
    console.log(`  + upserted header message for ${countryCode}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
async function main() {
  await connectDB();
  await seedTogoFomo();
  await seedTestimonials();
  await seedTrustBadges();
  await seedFooter();
  await seedHeader();
  console.log("✅ Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
