/**
 * scripts/seedSitePages.js
 *
 * Seeds the SitePage CMS (About Us, Our Story, Partner With Us, Contact Us,
 * FAQ, Shipping Policy, Returns & Refunds, Terms & Conditions, Privacy
 * Policy) with:
 *
 *   1. One "GLOBAL" document per page — the master/HQ copy. This is exactly
 *      what the storefront has always shown, because Nigeria was the only
 *      market in mind when these pages were written. Every other country
 *      falls back to this content until it creates its own override.
 *
 *   2. A handful of Togo (TG) overrides for the pages/keys that stated a
 *      Nigeria-only fact as if it were universal — the concrete case this
 *      script exists to demonstrate: "free shipping within Lagos" cannot be
 *      implied in Togo. Only the differing keys are overridden; everything
 *      else on those pages still inherits from GLOBAL (see `inherit: true`
 *      on the SitePage model/controller).
 *
 * Idempotent — safe to re-run; upserts by (slug, countryCode).
 *
 * Run:  node scripts/seedSitePages.js
 */

import dotenv from "dotenv";
import connectDB from "../config/connectDB.js";
import SitePageModel from "../models/sitePage.model.js";

dotenv.config();

async function upsertPage(slug, countryCode, { content, seo, inherit } = {}) {
  const update = {
    slug,
    countryCode,
    ...(content && { content }),
    ...(seo && { seo }),
    ...(inherit !== undefined && { inherit }),
    isPublished: true,
  };
  await SitePageModel.findOneAndUpdate(
    { slug, countryCode },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  console.log(`  + upserted ${slug} → ${countryCode}`);
}

// ─────────────────────────────────────────────────────────────────────────
// GLOBAL (Nigeria-authored master copy) — one entry per page, content keys
// match exactly what client/src/pages/*.jsx now reads via useSitePage().
// ─────────────────────────────────────────────────────────────────────────

const GLOBAL_PAGES = {
  "about-us": {
    seo: { title: "About I-Coffee | Nigeria's Leading Coffee Trading Platform", description: "Learn about I-Coffee, Nigeria's first online coffee trading platform connecting suppliers, businesses, and coffee enthusiasts." },
    content: {
      heroTitle: "About I-Coffee",
      heroTagline: "Nigeria's Leading Coffee Trading Platform",
      heroSubtitle: "Creating Value for Your Products Since Our Inception",
      missionText: "To revolutionize the coffee industry in Nigeria by creating a seamless platform that connects coffee suppliers, businesses, and enthusiasts, while ensuring quality, transparency, and mutual growth.",
      missionQuote: "\"Creating Value for Your Products\" - We bridge the gap between coffee suppliers, buyers, and aficionados, fostering a thriving coffee culture across Nigeria.",
      whoWeAreSubtitle: "A passionate team dedicated to the coffee industry",
      whoWeAreImage: "https://images.unsplash.com/photo-1442512595331-e89e73853f31?w=600&h=400&fit=crop",
      whoWeAreParagraphs: [
        "I-Coffee is Nigeria's first online coffee trading platform - a revolutionary marketplace that emerged with a vision to transform how coffee enthusiasts and businesses connect. We are your one-stop solution for all coffee needs in Nigeria.",
        "Strategically located in Ikeja, Lagos, our delivery office serves as the hub for our extensive logistics distribution network that covers all of Nigeria. With presence in 36 states including Abuja FCT, we ensure your coffee reaches you wherever you are.",
        "Our structured international management team and 35+ dedicated staff members work tirelessly to provide you with the best coffee experience. We maintain a 97% daily successful delivery rate with 5 vehicles dedicated to ensuring your orders arrive promptly and in perfect condition.",
        "Beyond Nigeria, we've expanded our reach to serve customers in Benin, Togo, and Cameroon, making I-Coffee a truly West African coffee destination.",
      ],
      achievements: [
        { iconKey: "users", number: "797+", labelKey: "statCustomers" },
        { iconKey: "coffee", number: "858+", labelKey: "statProducts" },
        { iconKey: "handshake", number: "65+", labelKey: "statBrands" },
        { iconKey: "globe", number: "36+", labelKey: "statStates" },
      ],
      commitmentParagraphs: [
        "At I-Coffee, we're committed to maintaining the highest standards of quality and service. Every product on our platform is carefully vetted to ensure authenticity and excellence.",
        "We work closely with our supplier partners to guarantee that you receive only genuine, fresh products. Our platform facilitates transparent transactions, timely deliveries, and responsive customer support.",
        "Whether you're a coffee shop owner looking for bulk supplies, a business seeking quality machines, or an individual enthusiast exploring new flavors, I-Coffee is your trusted partner in the coffee journey.",
      ],
      ctaTitle: "Join the I-Coffee Community",
      ctaText: "Whether you're a supplier looking to expand your reach or a coffee lover seeking quality products, we're here for you.",
    },
  },

  "our-story": {
    seo: { title: "Our Story | I-Coffee", description: "The journey of how I-Coffee became a leading coffee trading platform." },
    content: {
      heroTitle: "Our Story",
      heroTagline: "From Vision to Reality",
      heroSubtitle: "The journey of how I-Coffee became Nigeria's leading coffee trading platform",
      beginningTitle: "It All Started in Lagos",
      beginningParagraphs: [
        "In the bustling city of Lagos, Nigeria, a revolutionary trading platform emerged, changing the way coffee enthusiasts and businesses connected. I-Coffee, a brainchild of passionate entrepreneurs, aimed to bridge the gap between coffee suppliers, buyers, and aficionados.",
        "The platform's visionary management team had a clear goal: to create a one-stop-shop for all things coffee, where users could seamlessly buy, sell, and trade coffee beans, machines, and accessories. With a user-friendly interface and robust features, I-Coffee quickly gained traction among Nigerian coffee lovers.",
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
        { year: "Today", title: "Nigeria's Coffee Trading Hub", description: "I-Coffee became Nigeria's go-to coffee trading platform, fostering growth, connections, and a thriving coffee culture with innovative features and unwavering quality.", iconKey: "award" },
      ],
      impactTitle: "Our Impact",
      impactSubtitle: "As word spread, I-Coffee's community grew exponentially",
      impactStats: [
        { iconKey: "coffee", title: "Premium Quality", text: "Suppliers showcase their finest beans" },
        { iconKey: "users", title: "Growing Network", text: "Buyers discover new flavors daily" },
        { iconKey: "rocket", title: "Business Growth", text: "Partners expand their reach" },
      ],
      valueTitle: "Creating Value for Your Products",
      valueSubtitle: "Our slogan reflects our commitment",
      valueParagraphs: [
        "With our slogan \"Creating Value for Your Products,\" I-Coffee continued to innovate, introducing features like coffee machine trading, educational resources, and enhanced supplier-buyer connections.",
        "The platform's impact on Nigeria's coffee industry was undeniable, fostering growth, meaningful connections, and a thriving coffee culture that extends from Lagos to every corner of the nation.",
      ],
      principles: [
        { iconKey: "coffee", title: "Quality Above All", description: "Every product on our platform meets stringent quality standards." },
        { iconKey: "handshake", title: "Building Connections", description: "We unite suppliers and buyers in a seamless marketplace." },
        { iconKey: "heart", title: "Customer Success", description: "Your growth and satisfaction are the measures of our success." },
      ],
      closingTitle: "The Journey Continues",
      closingParagraphs: [
        "Today, I-Coffee stands as Nigeria's premier coffee trading hub, but our story is far from over. We continue to innovate, expand, and create value for every member of our community.",
        "Whether you're a supplier looking to grow, a business seeking quality products, or a coffee enthusiast exploring new horizons, you're part of our story.",
      ],
    },
  },

  "partner-with-us": {
    seo: { title: "Partner With Us | I-Coffee", description: "Join I-Coffee as a supplier and grow your coffee business." },
    content: {
      heroTitle: "Partner With I-Coffee",
      heroTagline: "Join Nigeria's Leading Coffee Trading Platform",
      heroSubtitle: "Creating Value for Your Products - Connect with thousands of coffee enthusiasts and grow your business with us",
      benefits: [
        { iconKey: "chartLine", title: "Grow Your Business", description: "Reach thousands of coffee enthusiasts across Nigeria and expand your market presence." },
        { iconKey: "shield", title: "Secure Platform", description: "Our platform ensures secure transactions and timely payments within 24 hours." },
        { iconKey: "users", title: "Wide Customer Base", description: "Connect with coffee shops, businesses, and individual coffee lovers nationwide." },
        { iconKey: "rocket", title: "Easy Setup", description: "Get your products online in just 15 days with our streamlined onboarding process." },
        { iconKey: "money", title: "Competitive Rates", description: "Only 10% handling fee with transparent pricing and no hidden costs." },
        { iconKey: "truck", title: "Logistics Support", description: "Free delivery for orders above ₦100,000 within Lagos State." },
      ],
      keyFeatures: [
        "Your products listed at your own online prices",
        "Payment within 24 hours of customer payment receipt",
        "Full control over your inventory and pricing",
        "Marketing support through our platform and social media",
        "No upfront costs or listing fees",
        "Dedicated account manager for support",
      ],
      howItWorks: [
        { step: "1", title: "Submit Application", description: "Fill out the partnership form with your business details and product information." },
        { step: "2", title: "Review Process", description: "Our team reviews your products within 10 days and provides feedback." },
        { step: "3", title: "Agreement & Setup", description: "Sign the supplier agreement and upload your product catalog with images." },
        { step: "4", title: "Go Live", description: "Your products go live within 15 days and start reaching customers immediately." },
      ],
      keyTerms: [
        "10% handling fee on all orders (or agreed distributor price)",
        "Payment within 24 hours of customer payment",
        "Free delivery for orders above ₦100,000 within Lagos",
        "Products must have minimum 6 months validity",
        "Supplier delivers orders within 24 hours to I-Coffee office",
        "One-year renewable contract",
      ],
      supplierResponsibilities: [
        "Ensure compliance with all applicable laws",
        "Maintain accurate records of products and supply",
        "Provide weekly updates of stock, prices, and quantities",
        "Inform platform of promotional sales and price changes",
        "Authorize platform to use logos and brands for marketing",
        "Supply products according to specifications as advertised",
      ],
      platformResponsibilities: [
        "Provide media design specifications",
        "Review products within 10 days",
        "Post products online within 15 days",
        "Make timely payments and remittances",
        "Communicate issues and concerns",
      ],
      contactAddress: "3, Kaffi Street Alausa, Lagos State",
      contactPhone: "+234 805 242 3935",
      contactPhoneHref: "tel:+2348039827194",
      contactEmail: "partners@i-coffee.ng",
    },
  },

  "contact-us": {
    seo: { title: "Contact Us | I-Coffee", description: "Get in touch with the I-Coffee team." },
    content: {
      heroTitle: "Contact Us",
      heroSubtitle: "We'd love to hear from you. Get in touch with our team!",
      address: ["3 Kaffi Street, Alausa", "Ikeja, Lagos", "Nigeria"],
      phone: "+234 805 242 3935",
      phoneHref: "tel:+2348052423935",
      email: "customercare@i-coffee.ng",
      businessHours: ["Monday - Friday: 8:00 AM - 6:00 PM", "Saturday: 9:00 AM - 4:00 PM", "Sunday: Closed"],
      mapEmbedUrl: "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3963.2858866938844!2d3.3541295!3d6.6067082!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x103b923f5e2c6b89%3A0x6b8b9c5f7a3e2d4c!2sKaffi%20Street%2C%20Alausa%2C%20Ikeja%2C%20Lagos!5e0!3m2!1sen!2sng!4v1234567890",
      gettingHere: "We are conveniently located in the heart of Ikeja, Lagos. Easily accessible by public transportation and private vehicles. Ample parking available.",
      landmarks: ["Alausa Secretariat", "Lagos State Government Secretariat", "Ikeja City Mall"],
      facebookUrl: "https://www.facebook.com/Italiancoffeeonline/?ref=pages_you_manage",
      twitterUrl: "https://twitter.com/italiancoffee_v",
      instagramUrl: "https://www.instagram.com/italiancofeeventure/",
      faqTeaserTitle: "Have Questions?",
      faqTeaserText: "Check out our FAQ page for quick answers to common questions",
    },
  },

  faq: {
    seo: { title: "FAQ | I-Coffee", description: "Answers to common questions about ordering, shipping, payments, and more." },
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
        { category: "ordering", question: "How do I place an order on I-Coffee?", answer: "Browse our products, add items to your cart, and proceed to checkout. You can order as a guest or create an account for a faster checkout experience and order tracking." },
        { category: "ordering", question: "Can I modify or cancel my order after placing it?", answer: "Orders can be modified or cancelled within 2 hours of placement. Contact our customer service immediately at customercare@i-coffee.ng or call +234 805 242 3935." },
        { category: "ordering", question: "What payment methods do you accept?", answer: "We accept card payments (Visa, Mastercard), bank transfers, and online payment platforms. We also support multi-currency payments for international customers." },
        { category: "ordering", question: "Do you have a minimum order quantity?", answer: "There is no minimum order quantity for regular customers. However, bulk orders may qualify for special discounts. Contact us for wholesale pricing." },
        { category: "shipping", question: "Which areas do you deliver to?", answer: "We deliver to all 36 states in Nigeria including Abuja FCT. We also ship to select West African countries including Benin, Togo, and Cameroon." },
        { category: "shipping", question: "How long does delivery take?", answer: "Standard delivery within Lagos takes 1-3 business days. Other states in Nigeria: 3-7 business days. International deliveries: 7-14 business days depending on location." },
        { category: "shipping", question: "What are your shipping costs?", answer: "Shipping costs vary by location and order weight. Orders over ₦100,000 within Lagos qualify for free delivery. Check our Shipping Policy page for detailed rates." },
        { category: "shipping", question: "How can I track my order?", answer: "After your order ships, you will receive a tracking number via email and SMS. You can track your order in real-time through your account dashboard or our tracking page." },
        { category: "shipping", question: "What is your delivery success rate?", answer: "We maintain a 97% daily successful delivery rate. We have 5 dedicated vehicles and a reliable logistics network covering all of Nigeria." },
        { category: "payment", question: "Is my payment information secure?", answer: "Yes, absolutely. We use industry-standard SSL encryption and secure payment gateways. We never store your complete card details on our servers." },
        { category: "payment", question: "Do you offer payment on delivery?", answer: "Payment on delivery is available for orders within Lagos and select locations. This option will be shown at checkout if available for your delivery address." },
        { category: "payment", question: "Can I get an invoice for my purchase?", answer: "Yes, an invoice is automatically generated and sent to your email after purchase. You can also download invoices from your account dashboard." },
        { category: "returns", question: "What is your return policy?", answer: "We accept returns within 7 days of purchase. Products must be in original condition with all packaging and accessories. A 20% restocking fee applies except for manufacturing defects. See our Return Policy page for full details." },
        { category: "returns", question: "How do I initiate a return?", answer: "Contact customer service within 7 days of receiving your order. Provide your order number and reason for return. We will issue a Return Authorization Number and instructions." },
        { category: "returns", question: "When will I receive my refund?", answer: "Refunds are processed within 5-10 business days after we receive and verify the returned product. Refunds are credited to your original payment method." },
        { category: "returns", question: "Who pays for return shipping?", answer: "Customers are responsible for return shipping costs unless the return is due to our error or a defective product. We recommend using a trackable shipping service." },
        { category: "account", question: "Do I need an account to shop?", answer: "No, you can checkout as a guest. However, creating an account allows you to track orders, save addresses, view order history, and enjoy a faster checkout experience." },
        { category: "account", question: "How do I reset my password?", answer: "Click \"Forgot Password\" on the login page. Enter your email address and we will send you a password reset link. Follow the instructions in the email to set a new password." },
        { category: "account", question: "Can I update my delivery address?", answer: "Yes, you can add, edit, or delete addresses in your account settings. You can also enter a different address during checkout." },
        { category: "account", question: "How do I subscribe to your newsletter?", answer: "Enter your email in the newsletter subscription box at the bottom of any page. You will receive exclusive offers, coffee tips, and updates about new products." },
        { category: "ordering", question: "What types of coffee products do you sell?", answer: "We offer a comprehensive range including coffee beans, capsules, ground coffee, instant coffee, coffee machines, accessories, syrups, cold brew makers, and even coffee-themed beauty products. We have 858+ products from 65+ local and international brands." },
        { category: "ordering", question: "Do you offer wholesale or bulk pricing?", answer: "Yes! We offer competitive wholesale prices for bulk orders. Contact us at customercare@i-coffee.ng or call +234 805 242 3935 to discuss your requirements and pricing." },
        { category: "shipping", question: "Can I schedule a delivery time?", answer: "While we cannot guarantee specific delivery times, you can add delivery instructions in your order notes. Our team will do their best to accommodate your preferences." },
        { category: "payment", question: "Do you accept international credit cards?", answer: "Yes, we accept international credit and debit cards. We have a multi-currency payment platform to serve customers beyond Nigeria." },
      ],
      ctaTitle: "Still Have Questions?",
      ctaText: "Our customer service team is here to help",
      ctaPhone: "+2348039827194",
    },
  },

  "shipping-policy": {
    seo: { title: "Shipping Policy | I-Coffee", description: "I-Coffee's shipping methods, delivery zones, timeframes, and costs." },
    content: {
      heroTitle: "Shipping Policy",
      heroSubtitle: "Fast, reliable delivery across Nigeria and West Africa with a 97% success rate",
      stats: [
        { value: "97%", label: "Daily Success Rate" },
        { value: "5", label: "Delivery Vehicles" },
        { value: "36", label: "States Coverage" },
        { value: "4", label: "Countries Served" },
      ],
      shippingMethods: [
        { iconKey: "shippingFast", name: "Standard Shipping", delivery: "3-7 business days (domestic)", intDelivery: "7-14 business days (international)", description: "Reliable delivery at affordable rates" },
        { iconKey: "truck", name: "Express Shipping", delivery: "1-3 business days (domestic)", intDelivery: "3-5 business days (international)", description: "Faster delivery for urgent orders" },
      ],
      deliveryZones: [
        { zone: "Lagos State", time: "1-3 business days", freeShipping: "₦100,000+", color: "amber" },
        { zone: "Other Nigerian States", time: "3-7 business days", freeShipping: "N/A", color: "amber" },
        { zone: "West Africa (Benin, Togo, Cameroon)", time: "7-14 business days", freeShipping: "N/A", color: "purple" },
      ],
      processingTimeText: "Orders are typically processed within 1-5 business days, depending on the supplier's location and product availability. You will receive an email notification when your order has been processed and shipped.",
      packagingText: "All products are carefully packaged to ensure safe delivery. We use high-quality packaging materials to protect your coffee products during transit, maintaining freshness and preventing damage.",
      trackingText: "Suppliers will provide tracking information for all orders. You can track your shipment in real-time through your account dashboard or using the tracking link sent via email and SMS.",
      shippingCostNotes: [
        "Shipping costs vary depending on the shipping method, package weight, and destination",
        "Free Shipping: Available on orders over ₦100,000 within Lagos State",
        "Final shipping cost will be calculated at checkout based on your location and cart contents",
        "International shipping costs are calculated based on destination country and package weight",
      ],
      supplierResponsibilities: [
        "Fulfill orders promptly and accurately",
        "Provide regular shipping updates to customers",
        "Deliver orders within 24 hours to I-Coffee office",
        "Ensure products have minimum 6 months validity",
        "Package products securely for safe transport",
      ],
      customerResponsibilities: [
        "Provide accurate shipping addresses and contact information",
        "Receive orders promptly at the specified address",
        "Inspect products for damage or defects upon delivery",
        "Report any issues within 24 hours of delivery",
        "Be available to receive the package or arrange alternative delivery",
      ],
      importantNotes: [
        "Delivery times are estimates and may vary due to factors beyond our control",
        "We are not responsible for delays caused by incorrect shipping addresses",
        "International shipments may be subject to customs regulations and duties",
        "Products not supplied within 24 hours must be refunded by supplier",
        "Contact customer service immediately if you experience any shipping issues",
      ],
      contactPhone: "+234 805 242 3935",
      contactEmail: "customercare@i-coffee.ng",
    },
  },

  "return-policy": {
    seo: { title: "Return & Refund Policy | I-Coffee", description: "I-Coffee's return conditions, process, and refund timelines." },
    content: {
      heroTitle: "Return & Refund Policy",
      heroSubtitle: "Your satisfaction is our priority. Review our return policy to ensure a smooth experience.",
      supplierNoticeTitle: "Important Notice for Suppliers",
      supplierNoticeText: "Suppliers registered on I-Coffee platform should ensure they understand and comply with this refund policy to maintain a smooth and transparent transaction process with customers.",
      returnConditions: [
        { iconKey: "clock", title: "7-Day Return Window", description: "Customers must return products within 7 days from the date of purchase." },
        { iconKey: "box", title: "Original Condition", description: "Products must be returned in their original condition, unopened and unused with all original packaging." },
        { iconKey: "shield", title: "Proof of Purchase", description: "Original receipt or proof of purchase must be provided with the return." },
        { iconKey: "money", title: "Restocking Fee", description: "A 20% handling charge per unit and transportation costs will be deducted, except for manufacturing defects." },
      ],
      returnProcess: [
        { step: "1", title: "Contact Customer Service", description: "Reach out to our support team within 7 days of purchase via phone or email." },
        { step: "2", title: "Return Authorization", description: "Receive a Return Authorization Number and return instructions from our team." },
        { step: "3", title: "Package Your Item", description: "Carefully package the product in its original condition with all accessories and documentation." },
        { step: "4", title: "Ship the Product", description: "Send the package to the designated return address. Keep your tracking number." },
        { step: "5", title: "Verification", description: "Our team will verify the returned product condition upon receipt." },
        { step: "6", title: "Refund Processing", description: "Refund will be issued after verification, with applicable fees deducted." },
      ],
      refundTimelineText: "Refunds will be issued after verifying the returned product and deducting applicable fees. The refund process typically takes 5-10 business days after we receive and verify your return. The refund will be credited to your original payment method.",
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
        { label: "Expired Products", text: "Expired products must not be delivered to customers. If you receive an expired product, contact us immediately for a full refund." },
        { label: "Supplier Responsibility", text: "Suppliers are responsible for the quality of products they deliver. Returns due to supplier errors will not incur handling fees for customers." },
        { label: "Return Shipping", text: "Customers are responsible for return shipping costs unless the return is due to our error or product defect." },
        { label: "Exchange Policy", text: "We currently offer refunds only. If you'd like a different product, please place a new order after receiving your refund." },
      ],
      contactPhone: "+234 800 000 0000",
      contactPhoneHours: "Mon-Fri: 9AM - 6PM",
      contactEmail: "support@i-coffee.ng",
      contactEmailNote: "Response within 24 hours",
    },
  },

  "terms-conditions": {
    seo: { title: "Terms & Conditions | I-Coffee", description: "The terms governing use of the I-Coffee platform." },
    content: {
      lastUpdated: "Last Updated: November 2025",
      introTitle: "Welcome to I-Coffee",
      introParagraphs: [
        "These Terms and Conditions (\"Terms\") govern your access to and use of the I-Coffee platform, website, and services (collectively, the \"Platform\"). By accessing or using our Platform, you agree to be bound by these Terms.",
        "I-Coffee operates as Nigeria's first online coffee trading platform, connecting coffee suppliers with customers across Nigeria and West Africa. Our platform facilitates transactions between registered suppliers and end customers.",
      ],
      introAgreementNotice: "If you do not agree to these Terms, please do not use our Platform.",
      sections: [
        { iconKey: "userCheck", title: "Account Terms", content: [
          "You must be at least 18 years old to use this platform",
          "You are responsible for maintaining the security of your account and password",
          "You are responsible for all activities that occur under your account",
          "You must provide accurate and complete information when creating an account",
          "We reserve the right to refuse service or terminate accounts at our discretion",
        ]},
        { iconKey: "handshake", title: "Use of Platform", content: [
          "You may use our platform only for lawful purposes",
          "You agree not to use the platform for any fraudulent or illegal activity",
          "You will not interfere with or disrupt the platform or servers",
          "You will not attempt to gain unauthorized access to any part of the platform",
          "You agree to comply with all applicable laws and regulations",
        ]},
        { iconKey: "shield", title: "Product Information", content: [
          "We strive to provide accurate product descriptions and images",
          "Product availability and prices are subject to change without notice",
          "We do not guarantee that product descriptions are error-free",
          "Colors and specifications may vary slightly from images shown",
          "All products are supplied by registered suppliers on our platform",
        ]},
        { iconKey: "balance", title: "Pricing & Payment", content: [
          "All prices are listed in Nigerian Naira (₦) unless otherwise stated",
          "Prices include applicable taxes unless specified otherwise",
          "We reserve the right to change prices at any time",
          "Payment must be received before order processing begins",
          "We accept multiple payment methods including cards, bank transfer, and Bitcoin",
        ]},
      ],
      detailedSections: [
        { title: "Orders and Transactions", paragraphs: [
          "<strong>Order Placement:</strong> When you place an order, you are making an offer to purchase products from our registered suppliers. We reserve the right to refuse or cancel any order for any reason.",
          "<strong>Order Confirmation:</strong> Once your order is placed and payment is confirmed, you will receive an order confirmation via email. This constitutes acceptance of your order.",
          "<strong>Commission Structure:</strong> I-Coffee operates on a commission basis, charging suppliers a 10% handling fee on all orders processed through the platform.",
          "<strong>Business-to-Consumer Only:</strong> Our platform is restricted to business-to-final customer sales. Business-to-business arrangements are not permitted without prior authorization.",
        ]},
        { title: "Shipping and Delivery", paragraphs: [
          "Delivery is subject to our Shipping Policy. Delivery times are estimates and may vary. We are not liable for delays caused by circumstances beyond our control.",
          "<strong>Free Delivery:</strong> Orders with a monetary value of ₦100,000 and above within Lagos are delivered to customers at no transportation cost.",
          "<strong>Coverage:</strong> We deliver to all 36 states in Nigeria including Abuja FCT, and to select countries in West Africa (Benin, Togo, and Cameroon).",
        ]},
        { title: "Returns and Refunds", paragraphs: [
          "Returns and refunds are subject to our Return Policy. Products must be returned within 7 days of purchase in original condition.",
          "<strong>Restocking Fee:</strong> A 20% handling charge per unit and transportation costs will be deducted from refunds, except in cases of manufacturing defects or supplier error.",
          "<strong>Expired Products:</strong> Expired products must not be delivered to customers. If received, contact us immediately for a full refund.",
        ]},
        { title: "Supplier Obligations", intro: "Suppliers registered on our platform must:", list: [
          "Maintain high moral, ethical, and credibility standards",
          "Ensure all products meet the platform's quality standards",
          "Deliver orders within 24 hours to I-Coffee office",
          "Provide products with minimum 6 months validity period",
          "Supply products according to specifications as advertised",
          "Inform platform of stock changes and price updates",
          "Not contact customers directly without authorization",
          "Refund orders not supplied within 24 hours",
        ]},
        { title: "Platform Obligations", intro: "I-Coffee commits to:", list: [
          "Review supplier products within 10 days of submission",
          "Post approved products online within 15 days",
          "Process payments to suppliers within 24 hours of receipt",
          "Provide media design specifications for product listings",
          "Advertise supplier products on the platform",
          "Communicate issues and concerns promptly",
          "Maintain platform security and functionality",
        ]},
        { title: "Intellectual Property", paragraphs: [
          "All content on the Platform, including text, graphics, logos, images, and software, is the property of I-Coffee or its suppliers and is protected by intellectual property laws.",
          "Suppliers authorize I-Coffee to use their logos, brands, and product images for advertisements in the online marketing system including social media platforms.",
          "You may not reproduce, distribute, modify, or create derivative works from any content without express written permission.",
        ]},
        { title: "Limitation of Liability", paragraphs: [
          "To the maximum extent permitted by law, I-Coffee shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Platform.",
          "We do not guarantee uninterrupted or error-free operation of the Platform. The Platform is provided \"as is\" without warranties of any kind.",
          "<strong>Force Majeure:</strong> Neither party shall be liable for failure or delay in performing obligations due to circumstances beyond reasonable control, including natural disasters, wars, government actions, or supply chain disruptions.",
        ]},
        { title: "Dispute Resolution", paragraphs: [
          "Any disputes arising from these Terms or your use of the Platform shall be resolved through good faith negotiations.",
          "If disputes cannot be resolved through negotiation, they shall be subject to the dispute resolution process in accordance with the laws of the Federal Republic of Nigeria.",
          "<strong>Governing Law:</strong> These Terms shall be governed by and construed in accordance with the laws of the Federal Republic of Nigeria.",
        ]},
        { title: "Termination", paragraphs: [
          "We reserve the right to suspend or terminate your access to the Platform at any time, with or without notice, for any reason, including violation of these Terms.",
          "Supplier agreements may be terminated by either party with 15 days' written notice. Contracts are renewable annually unless notification is provided 30 days prior to expiration.",
        ]},
        { title: "Changes to Terms", paragraphs: [
          "We reserve the right to modify these Terms at any time. Changes will be effective immediately upon posting to the Platform.",
          "Your continued use of the Platform after changes constitutes acceptance of the modified Terms. We encourage you to review these Terms periodically.",
        ]},
      ],
      noticeTitle: "Important Notice",
      noticeParagraphs: [
        "These Terms constitute a legally binding agreement between you and I-Coffee. By using our Platform, you acknowledge that you have read, understood, and agree to be bound by these Terms.",
        "If you have questions about these Terms, please contact us before using the Platform.",
      ],
    },
  },

  "privacy-policy": {
    seo: { title: "Privacy Policy | I-Coffee", description: "How I-Coffee collects, uses, and protects your information." },
    content: {
      lastUpdated: "Last Updated: November 2025",
      introParagraphs: [
        "At I-Coffee, we are committed to protecting your privacy and ensuring the security of your personal information. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our platform.",
        "By using I-Coffee, you consent to the data practices described in this policy. If you do not agree with this policy, please do not use our platform.",
      ],
      dataTypes: [
        { iconKey: "userShield", title: "Personal Information", items: ["Name and contact details", "Email address", "Phone number", "Delivery address", "Company information (if applicable)"] },
        { iconKey: "database", title: "Transaction Data", items: ["Order history", "Payment information", "Purchase preferences", "Communication records", "Account activity"] },
        { iconKey: "cookie", title: "Technical Data", items: ["IP address", "Browser type and version", "Device information", "Cookies and usage data", "Location data"] },
      ],
      useCards: [
        { title: "Order Processing", text: "Process and fulfill your orders, manage payments, and provide customer support.", color: "green" },
        { title: "Communication", text: "Send order confirmations, shipping updates, and respond to your inquiries.", color: "blue" },
        { title: "Platform Improvement", text: "Analyze usage patterns to improve our services, features, and user experience.", color: "purple" },
        { title: "Marketing", text: "Send promotional offers, newsletters, and updates (with your consent).", color: "orange" },
        { title: "Security & Fraud Prevention", text: "Detect and prevent fraudulent activities, protect against security threats.", color: "red" },
        { title: "Legal Compliance", text: "Comply with legal obligations and enforce our terms and policies.", color: "indigo" },
      ],
      securityIntro: "We implement industry-standard security measures to protect your personal information:",
      securityMeasures: [
        "SSL encryption for data transmission", "Secure payment gateways", "Regular security audits",
        "Access controls and authentication", "Data backup and recovery systems", "Employee training on data protection",
      ],
      securityDisclaimer: "While we strive to protect your information, no method of transmission over the internet is 100% secure. We cannot guarantee absolute security.",
      sharingSections: [
        { title: "With Suppliers", text: "We share necessary information with suppliers to fulfill your orders, including delivery address and contact details." },
        { title: "With Service Providers", text: "We work with third-party service providers for payment processing, delivery, and analytics. These providers are contractually obligated to protect your information." },
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
        "Your information may be transferred to and processed in countries other than your country of residence. We ensure appropriate safeguards are in place to protect your information in accordance with this Privacy Policy.",
        "By using our platform, you consent to the transfer of your information to Nigeria and other countries where we operate.",
      ],
      updatesText: "We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated \"Last Updated\" date. We encourage you to review this policy periodically. Your continued use of our platform after changes constitutes acceptance of the updated policy.",
      contactEmail: "customercare@i-coffee.ng",
      contactPhone: "+234 805 242 3935",
      contactPhoneHref: "tel:+2348052423935",
      contactAddress: "3 Kaffi Street, Alausa, Ikeja, Lagos, Nigeria",
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────
// TG (Togo) overrides — ONLY the keys that stated a Nigeria-only fact.
// Everything else on these pages still inherits from GLOBAL above
// (inherit: true, the SitePage model's default). Matches the contact
// details already seeded into HomeContentBlock by seedTogoDemoContent.js.
// ─────────────────────────────────────────────────────────────────────────

const TG_OVERRIDES = {
  "contact-us": {
    content: {
      address: ["12 Rue du Commerce, Bè", "Lomé", "Togo"],
      phone: "+228 90 12 34 56",
      phoneHref: "tel:+22890123456",
      email: "clientele@i-coffee.tg",
      // No physical showroom/office to visit yet in Lomé — the map/landmarks
      // block genuinely doesn't apply, so this market unpublishes rather
      // than showing Lagos landmarks under a Togo heading. The page falls
      // back to GLOBAL's map only if this key isn't present; here we opt to
      // simply describe reachability instead of embedding Lagos's map.
      gettingHere: "Nous sommes actuellement basés à Lomé et livrons dans les principales villes du Togo. Contactez-nous par téléphone, WhatsApp ou e-mail — notre équipe locale vous répond rapidement.",
      landmarks: [],
      faqTeaserTitle: "Des questions ?",
      faqTeaserText: "Consultez notre FAQ pour des réponses rapides aux questions courantes",
    },
  },

  "shipping-policy": {
    content: {
      heroSubtitle: "Livraison fiable à Lomé et dans les grandes villes du Togo",
      // NG's "36 states / 4 countries served" stat block doesn't describe
      // Togo's operation — replaced with Togo-accurate coverage figures.
      stats: [
        { value: "Lomé", label: "Zone de livraison principale" },
        { value: "1-3j", label: "Délai à Lomé" },
        { value: "XOF", label: "Paiement en Francs CFA" },
        { value: "Stripe", label: "Paiement international" },
      ],
      // The whole NG-specific zone table (Lagos/other-states/West-Africa)
      // is replaced — Togo doesn't have a Lagos free-shipping threshold to
      // reference at all, so this isn't "translate the same fact", it's a
      // genuinely different zone structure.
      deliveryZones: [
        { zone: "Lomé", time: "1-3 jours ouvrés", freeShipping: "25 000 CFA+", color: "amber" },
        { zone: "Autres villes du Togo", time: "3-6 jours ouvrés", freeShipping: "N/A", color: "amber" },
      ],
      shippingCostNotes: [
        "Les frais de livraison varient selon le mode de livraison, le poids du colis et la destination",
        "Livraison gratuite : disponible pour les commandes de plus de 25 000 CFA à Lomé",
        "Le coût final de livraison est calculé au moment du paiement selon votre localisation",
      ],
      contactPhone: "+228 90 12 34 56",
      contactEmail: "clientele@i-coffee.tg",
    },
  },

  "partner-with-us": {
    content: {
      heroTagline: "Rejoignez la plateforme togolaise de vente de café en ligne",
      // The Lagos-specific "free delivery above ₦100,000 within Lagos"
      // benefit/term is replaced with Togo's own threshold and currency —
      // it is not simply translated, the underlying fact is different.
      benefits: [
        { iconKey: "chartLine", title: "Développez votre activité", description: "Touchez des milliers d'amateurs de café à travers le Togo et élargissez votre présence sur le marché." },
        { iconKey: "shield", title: "Plateforme sécurisée", description: "Notre plateforme garantit des transactions sécurisées et des paiements sous 24 heures." },
        { iconKey: "users", title: "Large base de clients", description: "Connectez-vous avec des cafés, entreprises et particuliers passionnés de café à Lomé et au-delà." },
        { iconKey: "rocket", title: "Mise en place facile", description: "Mettez vos produits en ligne en seulement 15 jours grâce à notre processus d'intégration simplifié." },
        { iconKey: "money", title: "Tarifs compétitifs", description: "Seulement 10% de frais de gestion, avec une tarification transparente et sans frais cachés." },
        { iconKey: "truck", title: "Support logistique", description: "Livraison gratuite pour les commandes de plus de 25 000 CFA à Lomé." },
      ],
      keyTerms: [
        "10% de frais de gestion sur toutes les commandes (ou prix distributeur convenu)",
        "Paiement sous 24 heures après réception du paiement client",
        "Livraison gratuite pour les commandes de plus de 25 000 CFA à Lomé",
        "Les produits doivent avoir une validité minimale de 6 mois",
        "Le fournisseur livre les commandes sous 24 heures au bureau I-Coffee",
        "Contrat renouvelable chaque année",
      ],
      contactAddress: "12 Rue du Commerce, Bè, Lomé, Togo",
      contactPhone: "+228 90 12 34 56",
      contactPhoneHref: "tel:+22890123456",
      contactEmail: "partenaires@i-coffee.tg",
    },
  },

  "terms-conditions": {
    content: {
      // "All prices are listed in Nigerian Naira (₦)" is flatly wrong for
      // Togo (XOF) — this is the clearest "cannot be implied" case in the
      // whole page set, so it's overridden rather than inherited.
      sections: [
        { iconKey: "userCheck", title: "Conditions du compte", content: [
          "Vous devez avoir au moins 18 ans pour utiliser cette plateforme",
          "Vous êtes responsable de la sécurité de votre compte et de votre mot de passe",
          "Vous êtes responsable de toutes les activités effectuées sous votre compte",
          "Vous devez fournir des informations exactes et complètes lors de la création d'un compte",
          "Nous nous réservons le droit de refuser un service ou de résilier des comptes à notre discrétion",
        ]},
        { iconKey: "handshake", title: "Utilisation de la plateforme", content: [
          "Vous ne pouvez utiliser notre plateforme qu'à des fins licites",
          "Vous acceptez de ne pas utiliser la plateforme à des fins frauduleuses ou illégales",
          "Vous ne perturberez pas la plateforme ou ses serveurs",
          "Vous ne tenterez pas d'accéder sans autorisation à une partie quelconque de la plateforme",
          "Vous acceptez de vous conformer à toutes les lois et réglementations applicables",
        ]},
        { iconKey: "shield", title: "Informations produit", content: [
          "Nous nous efforçons de fournir des descriptions et images de produits exactes",
          "La disponibilité et les prix des produits peuvent changer sans préavis",
          "Nous ne garantissons pas que les descriptions de produits sont sans erreur",
          "Les couleurs et spécifications peuvent varier légèrement par rapport aux images affichées",
          "Tous les produits sont fournis par des fournisseurs enregistrés sur notre plateforme",
        ]},
        { iconKey: "balance", title: "Tarifs et paiement", content: [
          "Tous les prix sont indiqués en Francs CFA (XOF) sauf mention contraire",
          "Les prix incluent les taxes applicables sauf indication contraire",
          "Nous nous réservons le droit de modifier les prix à tout moment",
          "Le paiement doit être reçu avant le début du traitement de la commande",
          "Nous acceptons plusieurs moyens de paiement, dont les cartes et Stripe",
        ]},
      ],
    },
  },
};

async function main() {
  await connectDB();

  console.log("→ Seeding GLOBAL (HQ/Nigeria-authored) site pages …");
  for (const [slug, data] of Object.entries(GLOBAL_PAGES)) {
    await upsertPage(slug, "GLOBAL", data);
  }

  console.log("→ Seeding Togo (TG) overrides for pages with Nigeria-only facts …");
  for (const [slug, data] of Object.entries(TG_OVERRIDES)) {
    await upsertPage(slug, "TG", { ...data, inherit: true });
  }

  console.log("✅ Done. GLOBAL pages seeded:", Object.keys(GLOBAL_PAGES).length, "| TG overrides:", Object.keys(TG_OVERRIDES).length);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
