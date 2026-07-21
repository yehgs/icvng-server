/**
 * scripts/updateMultiCountryPages.js
 *
 * Rewrites the GLOBAL (HQ/shared) copy of five pages that don't have any
 * country-specific *facts* to override — unlike Shipping Policy or Terms &
 * Conditions, nothing on these pages differs by market — so instead of
 * per-country overrides, they just need ONE shared version of the text that
 * speaks to a multi-country business, which every market then inherits and
 * can translate:
 *
 *   - About Us          ("Nigeria's Leading Coffee Trading Platform" → a
 *                         multi-country platform headquartered in Nigeria)
 *   - Our Story          (keeps the true Lagos origin story, but the "today"
 *                         framing now reflects a growing multi-country hub)
 *   - FAQ                (payment/shipping answers now explain the actual
 *                         Paystack-for-NGN / Stripe-for-everything-else
 *                         model instead of assuming Nigeria; hardcoded NG
 *                         contact details replaced with "check your
 *                         country's Contact Us page")
 *   - Returns & Refunds  (already mostly currency-neutral — light touch)
 *   - Privacy Policy     (already mentions "Nigeria and other countries
 *                         where we operate" — small clarification only)
 *
 * After each page is updated, this script immediately triggers
 * translateSitePage() for French and Italian, so both language tabs in
 * Admin → Site Pages are populated right away rather than left for someone
 * to click "Auto-translate" by hand. Machine translations are still
 * flagged autoTranslated:true and can be reviewed/edited per language in
 * the admin, same as any other auto-translated content.
 *
 * Idempotent — safe to re-run; upserts by (slug, "GLOBAL").
 *
 * Run:  node scripts/updateMultiCountryPages.js
 */

import dotenv from "dotenv";
import connectDB from "../config/connectDB.js";
import SitePageModel from "../models/sitePage.model.js";
import { translateSitePage } from "../utils/translationService.js";

dotenv.config();

async function upsertGlobal(slug, { content, seo }) {
  const doc = await SitePageModel.findOneAndUpdate(
    { slug, countryCode: "GLOBAL" },
    { $set: { content, ...(seo && { seo }), isPublished: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  console.log(`  + updated GLOBAL content for ${slug}`);
  return doc;
}

// ─────────────────────────────────────────────────────────────────────────
const UPDATED_PAGES = {
  "about-us": {
    seo: {
      title: "About I-Coffee | Multi-Country Coffee Trading Platform",
      description: "I-Coffee is a multi-country coffee trading platform headquartered in Nigeria, connecting suppliers, businesses, and coffee lovers across every market we serve.",
    },
    content: {
      heroTitle: "About I-Coffee",
      heroTagline: "A Multi-Country Coffee Trading Platform",
      heroSubtitle: "Creating Value for Your Products — In Every Market We Serve",
      missionText: "To revolutionize the coffee industry across every country we operate in by creating a seamless platform that connects coffee suppliers, businesses, and enthusiasts, while ensuring quality, transparency, and mutual growth — wherever you're shopping from.",
      missionQuote: "\"Creating Value for Your Products\" - We bridge the gap between coffee suppliers, buyers, and aficionados, fostering a thriving coffee culture in every country I-Coffee serves.",
      whoWeAreSubtitle: "A passionate team dedicated to the coffee industry across our markets",
      whoWeAreImage: "https://images.unsplash.com/photo-1442512595331-e89e73853f31?w=600&h=400&fit=crop",
      whoWeAreParagraphs: [
        "I-Coffee began as Nigeria's first online coffee trading platform and has grown into a multi-country marketplace, connecting coffee suppliers and enthusiasts across every market we serve. We're your one-stop solution for coffee, coffee machines, and accessories — no matter which I-Coffee country site you're shopping on.",
        "Our headquarters and central logistics hub are based in Ikeja, Lagos, Nigeria, coordinating a delivery network that continues to expand into new countries — Togo is already live, with more markets on the way. Each country we operate in gets pricing, payment options, and delivery tailored to local needs.",
        "Our structured international management team, together with dedicated staff in each market, works to give you the best coffee experience wherever you are. We maintain a 97% successful delivery rate in Nigeria, our most established market, and we're building that same standard of reliability as we grow into new countries.",
        "Checkout always feels local: customers paying in Nigerian Naira are served by Paystack, and customers paying in any other supported currency are served by Stripe — so however you pay, it works the way you'd expect in your own market.",
      ],
      achievements: [
        { iconKey: "users", number: "797+", labelKey: "statCustomers" },
        { iconKey: "coffee", number: "858+", labelKey: "statProducts" },
        { iconKey: "handshake", number: "65+", labelKey: "statBrands" },
        { iconKey: "globe", number: "2+", labelKey: "statStates" },
      ],
      commitmentParagraphs: [
        "At I-Coffee, we're committed to maintaining the highest standards of quality and service in every country we operate. Every product on our platform is carefully vetted to ensure authenticity and excellence, no matter which market it ships from.",
        "We work closely with our supplier partners in each market to guarantee that you receive only genuine, fresh products. Our platform facilitates transparent transactions, timely deliveries, and responsive customer support — with pricing and payment always shown in your local currency.",
        "Whether you're a coffee shop owner looking for bulk supplies, a business seeking quality machines, or an individual enthusiast exploring new flavors, I-Coffee is your trusted partner in the coffee journey, wherever you're located.",
      ],
      ctaTitle: "Join the I-Coffee Community",
      ctaText: "Whether you're a supplier looking to expand your reach or a coffee lover seeking quality products, we're here for you — in every country we serve.",
    },
  },

  "our-story": {
    seo: {
      title: "Our Story | I-Coffee",
      description: "How I-Coffee grew from a Lagos startup into a multi-country coffee trading platform.",
    },
    content: {
      heroTitle: "Our Story",
      heroTagline: "From Vision to Reality",
      heroSubtitle: "The journey of how I-Coffee grew from a Lagos startup into a multi-country coffee trading platform",
      beginningTitle: "It All Started in Lagos",
      beginningParagraphs: [
        "In the bustling city of Lagos, Nigeria, a revolutionary trading platform emerged, changing the way coffee enthusiasts and businesses connected. I-Coffee, a brainchild of passionate entrepreneurs, aimed to bridge the gap between coffee suppliers, buyers, and aficionados.",
        "The platform's visionary management team had a clear goal: to create a one-stop-shop for all things coffee, where users could seamlessly buy, sell, and trade coffee beans, machines, and accessories. With a user-friendly interface and robust features, I-Coffee quickly gained traction — and what started in Lagos was always designed to grow beyond it.",
      ],
      successStoryBadge: "Success Story",
      successStoryTitle: "Princess's Coffee Shop Transformation",
      successStoryParagraphs: [
        "One day, Princess, a young coffee shop owner, stumbled upon I-Coffee while searching for high-quality Arabica beans. She was impressed by the platform's vast selection and competitive prices.",
        "She connected with a reputable supplier, negotiated a deal, and received her beans within days. The quality exceeded her expectations, and her coffee shop's sales soared.",
        "Princess became a loyal I-Coffee customer, and her success story inspired countless others to join our community.",
      ],
      successStoryImage: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=600&h=400&fit=crop",
      timeline: [
        { year: "The Beginning", title: "A Vision Born in Lagos", description: "In the bustling city of Lagos, Nigeria, passionate entrepreneurs identified a gap in the coffee industry - the need for a platform connecting suppliers, buyers, and enthusiasts.", iconKey: "lightbulb" },
        { year: "The Launch", title: "I-Coffee Platform Goes Live", description: "Our revolutionary trading platform emerged with a clear mission: to create a one-stop-shop for all things coffee with user-friendly features and competitive pricing.", iconKey: "rocket" },
        { year: "First Success", title: "Princess Finds Her Beans", description: "Princess, a young coffee shop owner, discovered I-Coffee while searching for high-quality Arabica beans. She connected with suppliers, and her coffee shop sales soared.", iconKey: "star" },
        { year: "Growing Community", title: "Word Spreads Across Nigeria", description: "As success stories multiplied, I-Coffee's community grew. Suppliers showcased premium beans while buyers discovered new flavors and expanded their businesses.", iconKey: "users" },
        { year: "Going Multi-Country", title: "Expanding Beyond Nigeria", description: "I-Coffee launched in Togo, its first market outside Nigeria — bringing the same platform, with local pricing, payments, and delivery, to a new country.", iconKey: "award" },
      ],
      impactTitle: "Our Impact",
      impactSubtitle: "As word spread, I-Coffee's community grew — and kept growing across borders",
      impactStats: [
        { iconKey: "coffee", title: "Premium Quality", text: "Suppliers showcase their finest beans" },
        { iconKey: "users", title: "Growing Network", text: "Buyers discover new flavors daily" },
        { iconKey: "rocket", title: "Multi-Country Growth", text: "The same platform, tailored to every new market" },
      ],
      valueTitle: "Creating Value for Your Products",
      valueSubtitle: "Our slogan reflects our commitment — in every country we serve",
      valueParagraphs: [
        "With our slogan \"Creating Value for Your Products,\" I-Coffee continued to innovate, introducing features like coffee machine trading, educational resources, and enhanced supplier-buyer connections.",
        "The platform's impact reached beyond Nigeria's borders. I-Coffee is now a multi-country marketplace — bringing the same growth, connections, and thriving coffee culture to new markets like Togo, with pricing and payments tailored to each local currency.",
      ],
      principles: [
        { iconKey: "coffee", title: "Quality Above All", description: "Every product on our platform meets stringent quality standards, in every market." },
        { iconKey: "handshake", title: "Building Connections", description: "We unite suppliers and buyers in a seamless marketplace, wherever they are." },
        { iconKey: "heart", title: "Customer Success", description: "Your growth and satisfaction are the measures of our success." },
      ],
      closingTitle: "The Journey Continues",
      closingParagraphs: [
        "Today, I-Coffee is a multi-country coffee trading hub — live in Nigeria and Togo, and growing — but our story is far from over. We continue to innovate, expand, and create value for every member of our community.",
        "Whether you're a supplier looking to grow, a business seeking quality products, or a coffee enthusiast exploring new horizons, you're part of our story — wherever in the world you're reading this.",
      ],
    },
  },

  faq: {
    seo: {
      title: "FAQ | I-Coffee",
      description: "Answers to common questions about ordering, shipping, payments in your local currency, and more.",
    },
    content: {
      heroTitle: "Frequently Asked Questions",
      heroSubtitle: "Find answers to common questions about ordering, shipping, payments, and more",
      categories: [
        { id: "all", name: "All Questions" },
        { id: "ordering", name: "Ordering" },
        { id: "shipping", name: "Shipping" },
        { id: "payment", name: "Payment" },
        { id: "returns", name: "Returns" },
        { id: "account", name: "Account" },
      ],
      faqs: [
        { category: "ordering", question: "Does I-Coffee operate in more than one country?", answer: "Yes — I-Coffee is a multi-country platform. Each country has its own site (for example i-coffee.ng for Nigeria and i-coffee.tg for Togo), with pricing, delivery options, and payment methods tailored to that market, and content available in the languages relevant to that country." },
        { category: "ordering", question: "How do I place an order on I-Coffee?", answer: "Browse our products, add items to your cart, and proceed to checkout. You can order as a guest or create an account for a faster checkout experience and order tracking." },
        { category: "ordering", question: "Can I modify or cancel my order after placing it?", answer: "Orders can be modified or cancelled within 2 hours of placement. Contact our customer service team right away through the Contact Us page for your country." },
        { category: "ordering", question: "What payment methods do you accept?", answer: "Payment methods depend on your country. In Nigeria, payments are processed securely via Paystack — cards, bank transfers, and USSD, all in Naira. In every other country we serve, payments are processed via Stripe, supporting local and international cards in your local currency." },
        { category: "ordering", question: "Do you have a minimum order quantity?", answer: "There is no minimum order quantity for regular customers. However, bulk orders may qualify for special discounts. Contact us for wholesale pricing." },
        { category: "shipping", question: "Which areas do you deliver to?", answer: "We currently deliver within Nigeria and Togo, with more countries being added over time. Each I-Coffee country site only shows the delivery areas and options available in that market — check the Shipping Policy page on your local I-Coffee site for exact coverage." },
        { category: "shipping", question: "How long does delivery take?", answer: "Delivery times vary by country and by location within that country. Check the Shipping Policy page on your local I-Coffee site for exact delivery windows in your area." },
        { category: "shipping", question: "What are your shipping costs?", answer: "Shipping costs vary by country, location, and order weight, and are always shown in your local currency at checkout. Free-delivery thresholds also vary by market — check the Shipping Policy page for your country for exact details." },
        { category: "shipping", question: "How can I track my order?", answer: "After your order ships, you will receive a tracking number via email and SMS. You can track your order in real-time through your account dashboard or our tracking page." },
        { category: "shipping", question: "What is your delivery success rate?", answer: "We maintain a 97% successful delivery rate in Nigeria, our most established market, and we're building that same standard of reliability as we expand to new countries." },
        { category: "payment", question: "Is my payment information secure?", answer: "Yes, absolutely. All payments are processed through Paystack (Nigeria) or Stripe (all other countries), both of which use industry-standard SSL encryption and secure payment gateways. We never store your complete card details on our servers." },
        { category: "payment", question: "Do you offer payment on delivery?", answer: "Payment on delivery is available in select areas within some countries. Where available, this option will be shown at checkout for your delivery address." },
        { category: "payment", question: "Can I get an invoice for my purchase?", answer: "Yes, an invoice is automatically generated and sent to your email after purchase, in your local currency. You can also download invoices from your account dashboard." },
        { category: "returns", question: "What is your return policy?", answer: "We accept returns within 7 days of purchase. Products must be in original condition with all packaging and accessories. A 20% restocking fee applies except for manufacturing defects. See our Return Policy page for full details." },
        { category: "returns", question: "How do I initiate a return?", answer: "Contact customer service within 7 days of receiving your order, through the Contact Us page for your country. Provide your order number and reason for return. We will issue a Return Authorization Number and instructions." },
        { category: "returns", question: "When will I receive my refund?", answer: "Refunds are processed within 5-10 business days after we receive and verify the returned product. Refunds are credited to your original payment method, in your original currency." },
        { category: "returns", question: "Who pays for return shipping?", answer: "Customers are responsible for return shipping costs unless the return is due to our error or a defective product. We recommend using a trackable shipping service." },
        { category: "account", question: "Do I need an account to shop?", answer: "No, you can checkout as a guest. However, creating an account allows you to track orders, save addresses, view order history, and enjoy a faster checkout experience." },
        { category: "account", question: "How do I reset my password?", answer: "Click \"Forgot Password\" on the login page. Enter your email address and we will send you a password reset link. Follow the instructions in the email to set a new password." },
        { category: "account", question: "Can I update my delivery address?", answer: "Yes, you can add, edit, or delete addresses in your account settings. You can also enter a different address during checkout." },
        { category: "account", question: "How do I subscribe to your newsletter?", answer: "Enter your email in the newsletter subscription box at the bottom of any page. You will receive exclusive offers, coffee tips, and updates about new products." },
        { category: "ordering", question: "What types of coffee products do you sell?", answer: "We offer a comprehensive range including coffee beans, capsules, ground coffee, instant coffee, coffee machines, accessories, syrups, cold brew makers, and even coffee-themed beauty products — 858+ products from 65+ local and international brands, available across every country we serve." },
        { category: "ordering", question: "Do you offer wholesale or bulk pricing?", answer: "Yes! We offer competitive wholesale prices for bulk orders. Get in touch through the Contact Us page for your country to discuss your requirements and pricing." },
        { category: "shipping", question: "Can I schedule a delivery time?", answer: "While we cannot guarantee specific delivery times, you can add delivery instructions in your order notes. Our team will do their best to accommodate your preferences." },
        { category: "payment", question: "Do you accept international credit cards?", answer: "Yes. Depending on your country, payments are processed via Paystack (Nigeria) or Stripe (all other countries), and both support major international cards." },
      ],
      ctaTitle: "Still Have Questions?",
      ctaText: "Our customer service team is here to help",
      ctaPhone: "+2348039827194",
    },
  },

  "return-policy": {
    seo: {
      title: "Return & Refund Policy | I-Coffee",
      description: "I-Coffee's return conditions, process, and refund timelines — the same policy in every country we serve.",
    },
    content: {
      heroTitle: "Return & Refund Policy",
      heroSubtitle: "Your satisfaction is our priority, in every country we serve. Review our return policy to ensure a smooth experience.",
      supplierNoticeTitle: "Important Notice for Suppliers",
      supplierNoticeText: "Suppliers registered on the I-Coffee platform, in any country, should ensure they understand and comply with this refund policy to maintain a smooth and transparent transaction process with customers.",
      returnConditions: [
        { iconKey: "clock", title: "7-Day Return Window", description: "Customers must return products within 7 days from the date of purchase." },
        { iconKey: "box", title: "Original Condition", description: "Products must be returned in their original condition, unopened and unused with all original packaging." },
        { iconKey: "shield", title: "Proof of Purchase", description: "Original receipt or proof of purchase must be provided with the return." },
        { iconKey: "money", title: "Restocking Fee", description: "A 20% handling charge per unit and transportation costs will be deducted, except for manufacturing defects." },
      ],
      returnProcess: [
        { step: "1", title: "Contact Customer Service", description: "Reach out to our support team within 7 days of purchase via the Contact Us page for your country." },
        { step: "2", title: "Return Authorization", description: "Receive a Return Authorization Number and return instructions from our team." },
        { step: "3", title: "Package Your Item", description: "Carefully package the product in its original condition with all accessories and documentation." },
        { step: "4", title: "Ship the Product", description: "Send the package to the designated return address. Keep your tracking number." },
        { step: "5", title: "Verification", description: "Our team will verify the returned product condition upon receipt." },
        { step: "6", title: "Refund Processing", description: "Refund will be issued after verification, with applicable fees deducted, in your original payment currency." },
      ],
      refundTimelineText: "Refunds will be issued after verifying the returned product and deducting applicable fees. The refund process typically takes 5-10 business days after we receive and verify your return. The refund will be credited to your original payment method — via Paystack in Nigeria, or Stripe in every other country we serve.",
      deductionHandlingFee: "20% of product cost per unit",
      deductionTransportCost: "Actual shipping costs",
      deductionException: "No deductions for manufacturing defects",
      eligibleForFullRefund: [
        "Manufacturing defects discovered upon delivery",
        "Products damaged during shipping",
        "Wrong items shipped by the supplier",
        "Products significantly different from description",
        "Products with quality issues reported immediately",
      ],
      nonReturnableItems: [
        "Products with broken seals or opened packaging",
        "Used or damaged products due to customer handling",
        "Products without original packaging or accessories",
        "Expired products purchased knowingly",
        "Custom or personalized coffee blends",
        "Products beyond the 7-day return window",
      ],
      additionalInfo: [
        { label: "Expired Products", text: "Expired products must not be delivered to customers. If you receive an expired product, contact us immediately through your country's Contact Us page for a full refund." },
        { label: "Supplier Responsibility", text: "Suppliers are responsible for the quality of products they deliver. Returns due to supplier errors will not incur handling fees for customers." },
        { label: "Return Shipping", text: "Customers are responsible for return shipping costs unless the return is due to our error or product defect." },
        { label: "Exchange Policy", text: "We currently offer refunds only. If you'd like a different product, please place a new order after receiving your refund." },
      ],
      contactPhone: "+234 800 000 0000",
      contactPhoneHours: "Mon-Fri: 9AM - 6PM",
      contactEmail: "support@i-coffee.ng",
      contactEmailNote: "Response within 24 hours. This is I-Coffee's HQ support line — some countries also have their own local contact details on the Contact Us page.",
    },
  },

  "privacy-policy": {
    seo: {
      title: "Privacy Policy | I-Coffee",
      description: "How I-Coffee collects, uses, and protects your information, in every country we operate.",
    },
    content: {
      lastUpdated: "Last Updated: November 2025",
      introParagraphs: [
        "At I-Coffee, we are committed to protecting your privacy and ensuring the security of your personal information, in every country where I-Coffee operates. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our platform.",
        "By using I-Coffee — on any of our country sites — you consent to the data practices described in this policy. If you do not agree with this policy, please do not use our platform.",
      ],
      dataTypes: [
        { iconKey: "userShield", title: "Personal Information", items: ["Name and contact details", "Email address", "Phone number", "Delivery address", "Company information (if applicable)"] },
        { iconKey: "database", title: "Transaction Data", items: ["Order history", "Payment information", "Purchase preferences", "Communication records", "Account activity"] },
        { iconKey: "cookie", title: "Technical Data", items: ["IP address", "Browser type and version", "Device information", "Cookies and usage data", "Location data"] },
      ],
      useCards: [
        { title: "Order Processing", text: "Process and fulfill your orders, manage payments (via Paystack or Stripe, depending on your country), and provide customer support.", color: "green" },
        { title: "Communication", text: "Send order confirmations, shipping updates, and respond to your inquiries.", color: "blue" },
        { title: "Platform Improvement", text: "Analyze usage patterns to improve our services, features, and user experience across every market we serve.", color: "purple" },
        { title: "Marketing", text: "Send promotional offers, newsletters, and updates (with your consent).", color: "orange" },
        { title: "Security & Fraud Prevention", text: "Detect and prevent fraudulent activities, protect against security threats.", color: "red" },
        { title: "Legal Compliance", text: "Comply with legal obligations and enforce our terms and policies.", color: "indigo" },
      ],
      securityIntro: "We implement industry-standard security measures to protect your personal information, wherever you're located:",
      securityMeasures: [
        "SSL encryption for data transmission",
        "Secure payment gateways (Paystack and Stripe)",
        "Regular security audits",
        "Access controls and authentication",
        "Data backup and recovery systems",
        "Employee training on data protection",
      ],
      securityDisclaimer: "While we strive to protect your information, no method of transmission over the internet is 100% secure. We cannot guarantee absolute security.",
      sharingSections: [
        { title: "With Suppliers", text: "We share necessary information with suppliers in your country to fulfill your orders, including delivery address and contact details." },
        { title: "With Service Providers", text: "We work with third-party service providers for payment processing (Paystack, Stripe), delivery, and analytics. These providers are contractually obligated to protect your information." },
        { title: "For Legal Reasons", text: "We may disclose information when required by law, to protect our rights, or in response to legal processes." },
      ],
      sharingNotice: "We do not sell your personal information to third parties.",
      yourRights: [
        { title: "Access", description: "Request a copy of your personal data" },
        { title: "Correction", description: "Update or correct inaccurate information" },
        { title: "Deletion", description: "Request deletion of your personal data" },
        { title: "Portability", description: "Receive your data in a structured format" },
        { title: "Object", description: "Object to processing of your data" },
        { title: "Withdraw Consent", description: "Withdraw consent for data processing" },
      ],
      rightsContactEmail: "customercare@i-coffee.ng",
      cookiesIntro: "We use cookies and similar tracking technologies to enhance your experience on our platform. Cookies are small files stored on your device that help us:",
      cookiesList: ["Remember your preferences and settings", "Keep you logged into your account", "Analyze how you use our platform", "Provide personalized content and recommendations", "Improve platform performance and security"],
      cookiesOutro: "You can control cookies through your browser settings. However, disabling cookies may affect your ability to use certain features of our platform.",
      retentionIntro: "We retain your personal information for as long as necessary to:",
      retentionList: ["Fulfill the purposes outlined in this Privacy Policy", "Comply with legal obligations", "Resolve disputes and enforce agreements", "Maintain business records"],
      retentionOutro: "When we no longer need your information, we will securely delete or anonymize it in accordance with applicable laws.",
      childrenText: "Our platform is not intended for children under 18 years of age. We do not knowingly collect personal information from children. If you believe we have collected information from a child, please contact us immediately.",
      transferParagraphs: [
        "Your information may be transferred to and processed in countries other than your country of residence — including Nigeria, where I-Coffee is headquartered, and any other country where I-Coffee operates, such as Togo. We ensure appropriate safeguards are in place to protect your information in accordance with this Privacy Policy.",
        "By using our platform, you consent to the transfer of your information to Nigeria and the other countries where we operate.",
      ],
      updatesText: "We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated \"Last Updated\" date. We encourage you to review this policy periodically. Your continued use of our platform after changes constitutes acceptance of the updated policy.",
      contactEmail: "customercare@i-coffee.ng",
      contactPhone: "+234 805 242 3935",
      contactPhoneHref: "tel:+2348052423935",
      contactAddress: "3 Kaffi Street, Alausa, Ikeja, Lagos, Nigeria (I-Coffee headquarters)",
    },
  },
};

async function main() {
  await connectDB();

  console.log("→ Updating GLOBAL content for multi-country-facing pages …");
  const updatedDocs = {};
  for (const [slug, data] of Object.entries(UPDATED_PAGES)) {
    updatedDocs[slug] = await upsertGlobal(slug, data);
  }

  console.log("→ Translating updated pages into French and Italian …");
  for (const [slug, doc] of Object.entries(updatedDocs)) {
    await translateSitePage({
      entityId: doc._id,
      document: { content: doc.content, seo: doc.seo },
      sourceLang: "en",
      targetLangs: ["fr", "it"],
    });
    console.log(`  + queued/translated ${slug} → fr, it`);
  }

  console.log("✅ Done. Pages updated:", Object.keys(UPDATED_PAGES).join(", "));
  console.log("   Countries without their own override for these pages (i.e. everyone except");
  console.log("   any future TG-specific edits) now inherit this shared, multi-country copy —");
  console.log("   and it's translated. Review French/Italian in Admin → Site Pages before");
  console.log("   relying on it for production copy; machine translation is a starting point.");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Update failed:", err);
  process.exit(1);
});
