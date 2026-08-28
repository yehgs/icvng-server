/**
 * utils/countryEmailTemplates.js
 *
 * Country-aware, LANGUAGE-aware HTML email templates.
 *
 * ── What changed (2026-08-28) ────────────────────────────────────────────────
 * Previously every template here was hardcoded English, so a Togo or Italy
 * customer received an English email from a French/Italian storefront. Every
 * customer-visible string now goes through STRINGS[lang], resolved from the
 * ORDER's country (not the admin's), so:
 *
 *   NG → en   TG → fr   BJ → fr   IT → it
 *
 * Also adds the three templates that did not exist at all, which is why no
 * customer ever received an email when a payment or order status changed:
 *
 *   paymentStatusEmail   — payment_status transitions (webhook OR manual)
 *   orderStatusEmail     — order_status transitions (admin-driven)
 *   deliveryStatusEmail  — logistics/tracking transitions
 *
 * Usage:
 *   import { orderConfirmationEmail, resolveEmailCountry } from '../utils/countryEmailTemplates.js';
 *   import { sendCountryEmail } from '../config/emailService.js';
 *
 *   const country = resolveEmailCountry(order.countryCode);
 *   const html = orderConfirmationEmail({ order, user, items, country });
 *   await sendCountryEmail({ countryCode: country.code, sendTo: user.email,
 *                            subject: subjectFor('orderConfirmed', country, order), html });
 *
 * RULE: always pass the ORDER's countryCode, never req.countryCode. A GLOBAL
 * admin (IT/DIRECTOR) in Lagos updating a Togo order must send the customer a
 * French, Togo-branded, XOF-denominated email.
 */

import { getCountryByCode, DEFAULT_COUNTRY } from "../config/countries/index.js";

const BRAND_COLOR = "#8B4513";
const BRAND_LIGHT = "#D2691E";

/**
 * Resolve a full country config from any loose country code, always
 * returning something usable. Central so every caller behaves identically
 * when countryCode is missing on a legacy (pre-backfill) order.
 */
export function resolveEmailCountry(countryCode) {
  return getCountryByCode(countryCode || DEFAULT_COUNTRY) || getCountryByCode(DEFAULT_COUNTRY);
}

/** The language an email to this country should be written in. */
function langOf(country) {
  return country?.language?.default || "en";
}

// ── Localized copy ───────────────────────────────────────────────────────────
// Only customer-visible strings live here. Keys are stable; add a language by
// adding a block — anything missing falls back to English automatically.

const STRINGS = {
  en: {
    hi: "Hi",
    there: "there",
    valuedCustomer: "valued customer",
    orderNumber: "Order Number",
    date: "Date",
    orderSummary: "Order Summary",
    product: "Product",
    qty: "Qty",
    price: "Price",
    total: "Total",
    deliveryAddress: "Delivery Address",
    trackYourOrder: "Track Your Order",
    trackOrder: "Track Order",
    viewOrder: "View Order",
    questions: "Questions?",
    contactUs: "Contact us",
    seeAccountForItems: "See your account for item details",

    orderConfirmedTitle: "Order Confirmed!",
    orderConfirmedBody: "Thank you, {name}. We have received your order.",
    paymentConfirmed: "✓ Payment confirmed",
    awaitingPayment: "⏳ Awaiting payment",

    paymentUpdateTitle: "Payment Update",
    paymentStatusLabel: "Payment Status",
    amountLabel: "Amount",
    paymentMethodLabel: "Payment Method",
    payment: {
      PAID: "Your payment has been received and confirmed. We are preparing your order now.",
      PENDING: "We have not yet received your payment. Your order is on hold until payment clears.",
      PENDING_BANK_TRANSFER:
        "We are waiting for your bank transfer to arrive. Your order will be processed as soon as it clears.",
      FAILED:
        "Unfortunately your payment did not go through. No money has been taken. You can retry from your account.",
      REFUNDED: "Your payment has been refunded. Please allow a few working days for it to reach your account.",
      PARTIAL: "We have received part of your payment. The remaining balance is still outstanding.",
    },
    paymentStatusName: {
      PAID: "Paid",
      PENDING: "Pending",
      PENDING_BANK_TRANSFER: "Awaiting bank transfer",
      FAILED: "Failed",
      REFUNDED: "Refunded",
      PARTIAL: "Partially paid",
    },

    orderUpdateTitle: "Order Update",
    orderStatusLabel: "Order Status",
    order: {
      PENDING: "Your order has been received and is awaiting confirmation.",
      CONFIRMED: "Your order is confirmed. We are getting it ready for you.",
      PROCESSING: "Your order is being prepared and packed.",
      SHIPPED: "Your order has left our warehouse and is on its way.",
      DELIVERED: "Your order has been delivered. We hope you enjoy it!",
      CANCELLED: "Your order has been cancelled. If this is unexpected, please get in touch.",
      RETURNED: "Your order has been marked as returned.",
    },
    orderStatusName: {
      PENDING: "Pending",
      CONFIRMED: "Confirmed",
      PROCESSING: "Processing",
      SHIPPED: "Shipped",
      DELIVERED: "Delivered",
      CANCELLED: "Cancelled",
      RETURNED: "Returned",
    },

    shippedTitle: "Your order is on its way!",
    shippedBody: "Hi {name}, your order has shipped.",
    trackingNumber: "Tracking Number",
    via: "via",
    deliveryUpdateTitle: "Delivery Update",
    estimatedDelivery: "Estimated Delivery",
    delivery: {
      PENDING: "Your shipment has been registered and is awaiting pickup.",
      PROCESSING: "Your shipment is being prepared at our warehouse.",
      PICKED_UP: "Your parcel has been picked up by the carrier.",
      IN_TRANSIT: "Your parcel is in transit.",
      OUT_FOR_DELIVERY: "Your parcel is out for delivery and should arrive today.",
      DELIVERED: "Your parcel has been delivered. Enjoy!",
      ATTEMPTED: "We attempted delivery but could not reach you. We will try again.",
      RETURNED: "Your parcel is being returned to us.",
      LOST: "We have lost contact with your parcel. Our team is investigating and will contact you.",
      CANCELLED: "This shipment has been cancelled.",
    },

    verifyTitle: "Verify your email",
    verifyBody: "Hi {name}, welcome! Please confirm your email to get started.",
    verifyBtn: "Verify Email Address",
    verifyNote: "Link expires in 24 hours. If you didn't sign up, ignore this.",

    resetTitle: "Reset your password",
    resetBody: "Hi {name}, we received a password reset request.",
    yourOtp: "Your OTP",
    otpValid: "Valid for 15 minutes",
    resetBtn: "Reset Password",
    resetExpires: "Expires in 1 hour.",
    ignoreEmail: "If you didn't request this, ignore this email.",

    welcomeTitle: "Welcome to {site}!",
    welcomeBody: "Hi {name}, your account is ready.",
    welcomeBlurb:
      "Explore our curated selection of premium coffees, machines and accessories — delivered in {country}.",
    startShopping: "Start Shopping",
  },

  fr: {
    hi: "Bonjour",
    there: "à vous",
    valuedCustomer: "cher client",
    orderNumber: "Numéro de commande",
    date: "Date",
    orderSummary: "Récapitulatif de la commande",
    product: "Produit",
    qty: "Qté",
    price: "Prix",
    total: "Total",
    deliveryAddress: "Adresse de livraison",
    trackYourOrder: "Suivre ma commande",
    trackOrder: "Suivre la commande",
    viewOrder: "Voir la commande",
    questions: "Des questions ?",
    contactUs: "Contactez-nous",
    seeAccountForItems: "Consultez votre compte pour le détail des articles",

    orderConfirmedTitle: "Commande confirmée !",
    orderConfirmedBody: "Merci, {name}. Nous avons bien reçu votre commande.",
    paymentConfirmed: "✓ Paiement confirmé",
    awaitingPayment: "⏳ En attente de paiement",

    paymentUpdateTitle: "Mise à jour du paiement",
    paymentStatusLabel: "Statut du paiement",
    amountLabel: "Montant",
    paymentMethodLabel: "Moyen de paiement",
    payment: {
      PAID: "Votre paiement a bien été reçu et confirmé. Nous préparons votre commande.",
      PENDING: "Nous n'avons pas encore reçu votre paiement. Votre commande est en attente.",
      PENDING_BANK_TRANSFER:
        "Nous attendons votre virement bancaire. Votre commande sera traitée dès sa réception.",
      FAILED:
        "Votre paiement n'a malheureusement pas abouti. Aucun montant n'a été prélevé. Vous pouvez réessayer depuis votre compte.",
      REFUNDED:
        "Votre paiement a été remboursé. Comptez quelques jours ouvrés avant réception sur votre compte.",
      PARTIAL: "Nous avons reçu une partie de votre paiement. Le solde reste dû.",
    },
    paymentStatusName: {
      PAID: "Payé",
      PENDING: "En attente",
      PENDING_BANK_TRANSFER: "Virement en attente",
      FAILED: "Échoué",
      REFUNDED: "Remboursé",
      PARTIAL: "Partiellement payé",
    },

    orderUpdateTitle: "Mise à jour de la commande",
    orderStatusLabel: "Statut de la commande",
    order: {
      PENDING: "Votre commande a été reçue et attend confirmation.",
      CONFIRMED: "Votre commande est confirmée. Nous la préparons pour vous.",
      PROCESSING: "Votre commande est en cours de préparation et d'emballage.",
      SHIPPED: "Votre commande a quitté notre entrepôt et est en route.",
      DELIVERED: "Votre commande a été livrée. Nous espérons qu'elle vous plaira !",
      CANCELLED: "Votre commande a été annulée. Si c'est inattendu, contactez-nous.",
      RETURNED: "Votre commande a été marquée comme retournée.",
    },
    orderStatusName: {
      PENDING: "En attente",
      CONFIRMED: "Confirmée",
      PROCESSING: "En préparation",
      SHIPPED: "Expédiée",
      DELIVERED: "Livrée",
      CANCELLED: "Annulée",
      RETURNED: "Retournée",
    },

    shippedTitle: "Votre commande est en route !",
    shippedBody: "Bonjour {name}, votre commande a été expédiée.",
    trackingNumber: "Numéro de suivi",
    via: "via",
    deliveryUpdateTitle: "Mise à jour de la livraison",
    estimatedDelivery: "Livraison estimée",
    delivery: {
      PENDING: "Votre envoi a été enregistré et attend son enlèvement.",
      PROCESSING: "Votre envoi est en cours de préparation dans notre entrepôt.",
      PICKED_UP: "Votre colis a été récupéré par le transporteur.",
      IN_TRANSIT: "Votre colis est en transit.",
      OUT_FOR_DELIVERY: "Votre colis est en cours de livraison et devrait arriver aujourd'hui.",
      DELIVERED: "Votre colis a été livré. Bonne dégustation !",
      ATTEMPTED: "Nous avons tenté la livraison sans succès. Nous réessaierons.",
      RETURNED: "Votre colis nous est retourné.",
      LOST: "Nous avons perdu la trace de votre colis. Notre équipe enquête et vous contactera.",
      CANCELLED: "Cet envoi a été annulé.",
    },

    verifyTitle: "Vérifiez votre e-mail",
    verifyBody: "Bonjour {name}, bienvenue ! Confirmez votre e-mail pour commencer.",
    verifyBtn: "Vérifier mon e-mail",
    verifyNote: "Le lien expire dans 24 heures. Si vous n'êtes pas à l'origine de cette inscription, ignorez ce message.",

    resetTitle: "Réinitialisez votre mot de passe",
    resetBody: "Bonjour {name}, nous avons reçu une demande de réinitialisation.",
    yourOtp: "Votre code",
    otpValid: "Valable 15 minutes",
    resetBtn: "Réinitialiser le mot de passe",
    resetExpires: "Expire dans 1 heure.",
    ignoreEmail: "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.",

    welcomeTitle: "Bienvenue chez {site} !",
    welcomeBody: "Bonjour {name}, votre compte est prêt.",
    welcomeBlurb:
      "Découvrez notre sélection de cafés, machines et accessoires premium — livrés au {country}.",
    startShopping: "Commencer mes achats",
  },

  it: {
    hi: "Ciao",
    there: "a te",
    valuedCustomer: "cliente affezionato",
    orderNumber: "Numero d'ordine",
    date: "Data",
    orderSummary: "Riepilogo ordine",
    product: "Prodotto",
    qty: "Qtà",
    price: "Prezzo",
    total: "Totale",
    deliveryAddress: "Indirizzo di consegna",
    trackYourOrder: "Traccia il tuo ordine",
    trackOrder: "Traccia ordine",
    viewOrder: "Vedi ordine",
    questions: "Domande?",
    contactUs: "Contattaci",
    seeAccountForItems: "Consulta il tuo account per il dettaglio degli articoli",

    orderConfirmedTitle: "Ordine confermato!",
    orderConfirmedBody: "Grazie, {name}. Abbiamo ricevuto il tuo ordine.",
    paymentConfirmed: "✓ Pagamento confermato",
    awaitingPayment: "⏳ In attesa di pagamento",

    paymentUpdateTitle: "Aggiornamento pagamento",
    paymentStatusLabel: "Stato del pagamento",
    amountLabel: "Importo",
    paymentMethodLabel: "Metodo di pagamento",
    payment: {
      PAID: "Il tuo pagamento è stato ricevuto e confermato. Stiamo preparando il tuo ordine.",
      PENDING: "Non abbiamo ancora ricevuto il pagamento. Il tuo ordine è in sospeso.",
      PENDING_BANK_TRANSFER:
        "Attendiamo il tuo bonifico bancario. L'ordine sarà elaborato non appena arriverà.",
      FAILED:
        "Purtroppo il pagamento non è andato a buon fine. Nessun importo è stato addebitato. Puoi riprovare dal tuo account.",
      REFUNDED: "Il tuo pagamento è stato rimborsato. Attendi qualche giorno lavorativo per l'accredito.",
      PARTIAL: "Abbiamo ricevuto una parte del pagamento. Il saldo resta da versare.",
    },
    paymentStatusName: {
      PAID: "Pagato",
      PENDING: "In attesa",
      PENDING_BANK_TRANSFER: "Bonifico in attesa",
      FAILED: "Fallito",
      REFUNDED: "Rimborsato",
      PARTIAL: "Parzialmente pagato",
    },

    orderUpdateTitle: "Aggiornamento ordine",
    orderStatusLabel: "Stato dell'ordine",
    order: {
      PENDING: "Il tuo ordine è stato ricevuto ed è in attesa di conferma.",
      CONFIRMED: "Il tuo ordine è confermato. Lo stiamo preparando.",
      PROCESSING: "Il tuo ordine è in preparazione e imballaggio.",
      SHIPPED: "Il tuo ordine ha lasciato il nostro magazzino ed è in viaggio.",
      DELIVERED: "Il tuo ordine è stato consegnato. Buona degustazione!",
      CANCELLED: "Il tuo ordine è stato annullato. Se non era previsto, contattaci.",
      RETURNED: "Il tuo ordine è stato contrassegnato come reso.",
    },
    orderStatusName: {
      PENDING: "In attesa",
      CONFIRMED: "Confermato",
      PROCESSING: "In lavorazione",
      SHIPPED: "Spedito",
      DELIVERED: "Consegnato",
      CANCELLED: "Annullato",
      RETURNED: "Reso",
    },

    shippedTitle: "Il tuo ordine è in viaggio!",
    shippedBody: "Ciao {name}, il tuo ordine è stato spedito.",
    trackingNumber: "Numero di tracciamento",
    via: "tramite",
    deliveryUpdateTitle: "Aggiornamento consegna",
    estimatedDelivery: "Consegna stimata",
    delivery: {
      PENDING: "La tua spedizione è stata registrata ed è in attesa di ritiro.",
      PROCESSING: "La tua spedizione è in preparazione nel nostro magazzino.",
      PICKED_UP: "Il tuo pacco è stato ritirato dal corriere.",
      IN_TRANSIT: "Il tuo pacco è in transito.",
      OUT_FOR_DELIVERY: "Il tuo pacco è in consegna e dovrebbe arrivare oggi.",
      DELIVERED: "Il tuo pacco è stato consegnato. Buona degustazione!",
      ATTEMPTED: "Abbiamo tentato la consegna senza successo. Riproveremo.",
      RETURNED: "Il tuo pacco ci sta tornando indietro.",
      LOST: "Abbiamo perso traccia del tuo pacco. Il nostro team sta indagando e ti contatterà.",
      CANCELLED: "Questa spedizione è stata annullata.",
    },

    verifyTitle: "Verifica la tua email",
    verifyBody: "Ciao {name}, benvenuto! Conferma la tua email per iniziare.",
    verifyBtn: "Verifica indirizzo email",
    verifyNote: "Il link scade tra 24 ore. Se non ti sei registrato, ignora questo messaggio.",

    resetTitle: "Reimposta la password",
    resetBody: "Ciao {name}, abbiamo ricevuto una richiesta di reimpostazione.",
    yourOtp: "Il tuo codice",
    otpValid: "Valido per 15 minuti",
    resetBtn: "Reimposta password",
    resetExpires: "Scade tra 1 ora.",
    ignoreEmail: "Se non hai richiesto questo, ignora l'email.",

    welcomeTitle: "Benvenuto in {site}!",
    welcomeBody: "Ciao {name}, il tuo account è pronto.",
    welcomeBlurb:
      "Scopri la nostra selezione di caffè, macchine e accessori premium — consegnati in {country}.",
    startShopping: "Inizia lo shopping",
  },
};

/** Look up a (possibly dotted) string key for a country's language, with EN fallback. */
function tr(country, key, vars = {}) {
  const lang = langOf(country);
  const pick = (dict) => key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), dict);
  const raw = pick(STRINGS[lang]) ?? pick(STRINGS.en) ?? key;
  if (typeof raw !== "string") return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
}

// ── Shell + formatting ───────────────────────────────────────────────────────

function emailShell(country, bodyHtml) {
  const c = resolveEmailCountry(country?.code);
  const domain = `https://${c.domain}`;
  const siteName = c.seo?.siteName || "I-Coffee";
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="${langOf(c)}">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${siteName}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#F9FAFB;color:#374151}
.wrap{max-width:600px;margin:0 auto;background:#fff}
.hdr{background:linear-gradient(135deg,${BRAND_COLOR},${BRAND_LIGHT});padding:32px 24px;text-align:center}
.hdr h1{color:#fff;font-size:24px;font-weight:700}
.hdr p{color:rgba(255,255,255,.8);font-size:13px;margin-top:6px}
.body{padding:32px 24px}
.ftr{background:#1F2937;color:#9CA3AF;text-align:center;padding:24px;font-size:12px}
.ftr a{color:#D1D5DB;text-decoration:none}
.btn{display:inline-block;background:${BRAND_COLOR};color:#fff!important;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin:16px 0}
.card{background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;padding:20px;margin:16px 0}
.lbl{font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:#6B7280;font-weight:600;margin-bottom:4px}
.val{font-size:15px;color:#374151;font-weight:500}
.divider{border:none;border-top:1px solid #E5E7EB;margin:20px 0}
table.items{width:100%;border-collapse:collapse;font-size:13px}
table.items th{text-align:left;padding:8px 10px;background:#F3F4F6;color:#6B7280;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
table.items td{padding:10px;border-bottom:1px solid #F3F4F6;vertical-align:top}
.total td{font-weight:700;font-size:15px;border-top:2px solid #E5E7EB}
.badge{display:inline-block;padding:4px 10px;border-radius:99px;font-size:12px;font-weight:600}
.green{background:#D1FAE5;color:#065F46}
.amber{background:#FEF3C7;color:#92400E}
.red{background:#FEE2E2;color:#991B1B}
.blue{background:#DBEAFE;color:#1E40AF}
</style>
</head><body>
<div class="wrap">
<div class="hdr"><h1>☕ ${siteName}</h1><p>${c.flagEmoji} ${c.name}</p></div>
<div class="body">${bodyHtml}</div>
<div class="ftr">
<p>© ${year} ${siteName} · <a href="${domain}">${domain}</a></p>
<p style="margin-top:8px"><a href="${domain}/privacy">Privacy</a> &nbsp;·&nbsp; <a href="${domain}/contact">${tr(c, "contactUs")}</a></p>
</div></div></body></html>`;
}

/**
 * Format money in the ORDER's currency, not a hardcoded NGN. Accepts an
 * explicit currency override so an order paid in EUR on the Nigerian site
 * still renders as EUR.
 */
function fmt(amount, country, currencyOverride) {
  const c = resolveEmailCountry(country?.code);
  const currency = currencyOverride || c.currency?.code || "NGN";
  try {
    return new Intl.NumberFormat(c.language?.locale || "en-NG", {
      style: "currency",
      currency,
      minimumFractionDigits: c.currency?.decimals ?? 2,
      maximumFractionDigits: c.currency?.decimals ?? 2,
    }).format(amount ?? 0);
  } catch {
    return `${c.currency?.symbol || ""}${Number(amount ?? 0).toFixed(2)}`;
  }
}

function badgeClassForPayment(status) {
  if (status === "PAID") return "green";
  if (status === "FAILED") return "red";
  if (status === "REFUNDED") return "blue";
  return "amber";
}

function badgeClassForOrder(status) {
  if (status === "DELIVERED") return "green";
  if (status === "CANCELLED" || status === "RETURNED") return "red";
  if (status === "SHIPPED" || status === "PROCESSING") return "blue";
  return "amber";
}

/**
 * Build a localized, country-branded subject line. Kept here (rather than
 * inline at each call site) so subjects are localized too — previously every
 * subject was English regardless of the customer's country.
 */
export function subjectFor(kind, country, ctx = {}) {
  const c = resolveEmailCountry(country?.code || country);
  const site = c.seo?.siteName || "I-Coffee";
  const ref = ctx.orderId || ctx.reference || "";
  const map = {
    orderConfirmed: {
      en: `Order ${ref} confirmed`,
      fr: `Commande ${ref} confirmée`,
      it: `Ordine ${ref} confermato`,
    },
    paymentStatus: {
      en: `Payment ${tr(c, `paymentStatusName.${ctx.status}`)} — order ${ref}`,
      fr: `Paiement ${tr(c, `paymentStatusName.${ctx.status}`)} — commande ${ref}`,
      it: `Pagamento ${tr(c, `paymentStatusName.${ctx.status}`)} — ordine ${ref}`,
    },
    orderStatus: {
      en: `Order ${ref} — ${tr(c, `orderStatusName.${ctx.status}`)}`,
      fr: `Commande ${ref} — ${tr(c, `orderStatusName.${ctx.status}`)}`,
      it: `Ordine ${ref} — ${tr(c, `orderStatusName.${ctx.status}`)}`,
    },
    deliveryStatus: {
      en: `Delivery update — order ${ref}`,
      fr: `Mise à jour de livraison — commande ${ref}`,
      it: `Aggiornamento consegna — ordine ${ref}`,
    },
  };
  const lang = langOf(c);
  const line = map[kind]?.[lang] || map[kind]?.en || kind;
  return `${line} | ${site}`;
}

// ── Templates ────────────────────────────────────────────────────────────────

export function verificationEmail({ name, verificationUrl, country }) {
  const c = resolveEmailCountry(country?.code);
  return emailShell(c, `
    <h2 style="font-size:22px;font-weight:700;margin-bottom:8px">${tr(c, "verifyTitle")}</h2>
    <p style="color:#6B7280;margin-bottom:24px">${tr(c, "verifyBody", { name: name || tr(c, "there") })}</p>
    <div style="text-align:center"><a href="${verificationUrl}" class="btn">${tr(c, "verifyBtn")}</a></div>
    <p style="font-size:12px;color:#9CA3AF;margin-top:24px;text-align:center">${tr(c, "verifyNote")}</p>
  `);
}

export function passwordResetEmail({ name, otp, resetUrl, country }) {
  const c = resolveEmailCountry(country?.code);
  const inner = otp
    ? `<div class="card" style="text-align:center">
         <p class="lbl">${tr(c, "yourOtp")}</p>
         <p style="font-size:36px;font-weight:800;letter-spacing:8px;color:${BRAND_COLOR};margin:12px 0">${otp}</p>
         <p style="font-size:12px;color:#9CA3AF">${tr(c, "otpValid")}</p>
       </div>`
    : `<div style="text-align:center"><a href="${resetUrl}" class="btn">${tr(c, "resetBtn")}</a></div>
       <p style="font-size:12px;color:#9CA3AF;margin-top:16px;text-align:center">${tr(c, "resetExpires")}</p>`;
  return emailShell(c, `
    <h2 style="font-size:22px;font-weight:700;margin-bottom:8px">${tr(c, "resetTitle")}</h2>
    <p style="color:#6B7280;margin-bottom:24px">${tr(c, "resetBody", { name: name || tr(c, "there") })}</p>
    ${inner}
    <p style="font-size:12px;color:#9CA3AF;margin-top:24px">${tr(c, "ignoreEmail")}</p>
  `);
}

export function orderConfirmationEmail({ order, user, items = [], country }) {
  const c = resolveEmailCountry(country?.code || order?.countryCode);
  const currency = order?.currency;
  const dateStr = new Date(order.createdAt || Date.now()).toLocaleDateString(
    c.language?.locale || "en-NG",
    { weekday: "long", day: "numeric", month: "long", year: "numeric" },
  );

  const rows = items.length
    ? items
        .map(
          (i) =>
            `<tr><td>${i.productId?.name || i.product_details?.name || i.name || tr(c, "product")}</td>` +
            `<td style="text-align:center">${i.quantity || 1}</td>` +
            `<td style="text-align:right">${fmt(i.price ?? i.subTotalAmt, c, currency)}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="3" style="color:#9CA3AF;text-align:center">${tr(c, "seeAccountForItems")}</td></tr>`;

  // BUGFIX: the model field is `payment_status` / `delivery_address`, not the
  // camelCase names this template used to read — so the badge always said
  // "Awaiting payment" and the address block never rendered, on every order.
  const paid = order.payment_status === "PAID";
  const addr = order.delivery_address || order.shippingAddress;
  const grand = order.groupTotals?.grandTotal ?? order.totalAmt ?? order.subTotalAmt;

  return emailShell(c, `
    <div style="text-align:center;margin-bottom:28px">
      <div style="font-size:40px;margin-bottom:8px">🎉</div>
      <h2 style="font-size:22px;font-weight:700">${tr(c, "orderConfirmedTitle")}</h2>
      <p style="color:#6B7280;margin-top:6px">${tr(c, "orderConfirmedBody", { name: user?.name || tr(c, "valuedCustomer") })}</p>
    </div>
    <div class="card">
      <p class="lbl">${tr(c, "orderNumber")}</p>
      <p class="val" style="font-family:monospace;font-size:16px">${order.orderId || order._id}</p>
      <hr class="divider"/>
      <p class="lbl">${tr(c, "date")}</p><p class="val">${dateStr}</p>
      <hr class="divider"/>
      <span class="badge ${paid ? "green" : "amber"}">${paid ? tr(c, "paymentConfirmed") : tr(c, "awaitingPayment")}</span>
    </div>
    <h3 style="font-size:14px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.5px;margin:20px 0 10px">${tr(c, "orderSummary")}</h3>
    <table class="items">
      <thead><tr><th>${tr(c, "product")}</th><th style="text-align:center">${tr(c, "qty")}</th><th style="text-align:right">${tr(c, "price")}</th></tr></thead>
      <tbody>
        ${rows}
        <tr class="total"><td colspan="2">${tr(c, "total")}</td><td style="text-align:right">${fmt(grand, c, currency)}</td></tr>
      </tbody>
    </table>
    ${addr ? `
      <h3 style="font-size:14px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.5px;margin:20px 0 10px">${tr(c, "deliveryAddress")}</h3>
      <div class="card"><p style="font-size:14px;line-height:1.6">${addr.address_line || ""}<br/>${addr.city || ""}, ${addr.state || ""}<br/>${addr.country || c.name}</p></div>
    ` : ""}
    <div style="text-align:center;margin-top:28px">
      <a href="https://${c.domain}/dashboard/myorders" class="btn">${tr(c, "trackYourOrder")}</a>
    </div>
    <p style="font-size:13px;color:#6B7280;text-align:center;margin-top:20px">
      ${tr(c, "questions")} <a href="https://${c.domain}/contact" style="color:${BRAND_COLOR}">${tr(c, "contactUs")}</a>
    </p>
  `);
}

/**
 * NEW — sent on every payment_status transition, whether it came from a
 * Paystack/Stripe webhook or an admin flipping the status by hand.
 */
export function paymentStatusEmail({ order, user, status, country, amount, currency }) {
  const c = resolveEmailCountry(country?.code || order?.countryCode);
  const st = status || order?.payment_status || "PENDING";
  const cur = currency || order?.currency;
  const amt = amount ?? order?.groupTotals?.grandTotal ?? order?.totalAmt;

  return emailShell(c, `
    <div style="text-align:center;margin-bottom:28px">
      <div style="font-size:40px;margin-bottom:8px">${st === "PAID" ? "✅" : st === "FAILED" ? "⚠️" : st === "REFUNDED" ? "↩️" : "⏳"}</div>
      <h2 style="font-size:22px;font-weight:700">${tr(c, "paymentUpdateTitle")}</h2>
      <p style="color:#6B7280;margin-top:6px">${tr(c, "hi")} ${user?.name || tr(c, "there")} — ${tr(c, `payment.${st}`)}</p>
    </div>
    <div class="card">
      <p class="lbl">${tr(c, "orderNumber")}</p>
      <p class="val" style="font-family:monospace;font-size:16px">${order?.orderId || ""}</p>
      <hr class="divider"/>
      <p class="lbl">${tr(c, "paymentStatusLabel")}</p>
      <p><span class="badge ${badgeClassForPayment(st)}">${tr(c, `paymentStatusName.${st}`)}</span></p>
      ${amt != null ? `<hr class="divider"/><p class="lbl">${tr(c, "amountLabel")}</p><p class="val">${fmt(amt, c, cur)}</p>` : ""}
      ${order?.payment_method ? `<hr class="divider"/><p class="lbl">${tr(c, "paymentMethodLabel")}</p><p class="val">${order.payment_method}</p>` : ""}
    </div>
    <div style="text-align:center;margin-top:24px">
      <a href="https://${c.domain}/dashboard/myorders" class="btn">${tr(c, "viewOrder")}</a>
    </div>
    <p style="font-size:13px;color:#6B7280;text-align:center;margin-top:20px">
      ${tr(c, "questions")} <a href="https://${c.domain}/contact" style="color:${BRAND_COLOR}">${tr(c, "contactUs")}</a>
    </p>
  `);
}

/** NEW — sent on every order_status transition driven from the admin panel. */
export function orderStatusEmail({ order, user, status, country, note }) {
  const c = resolveEmailCountry(country?.code || order?.countryCode);
  const st = status || order?.order_status || "PENDING";

  return emailShell(c, `
    <div style="text-align:center;margin-bottom:28px">
      <div style="font-size:40px;margin-bottom:8px">${st === "DELIVERED" ? "📬" : st === "SHIPPED" ? "🚚" : st === "CANCELLED" ? "⚠️" : "📦"}</div>
      <h2 style="font-size:22px;font-weight:700">${tr(c, "orderUpdateTitle")}</h2>
      <p style="color:#6B7280;margin-top:6px">${tr(c, "hi")} ${user?.name || tr(c, "there")} — ${tr(c, `order.${st}`)}</p>
    </div>
    <div class="card">
      <p class="lbl">${tr(c, "orderNumber")}</p>
      <p class="val" style="font-family:monospace;font-size:16px">${order?.orderId || ""}</p>
      <hr class="divider"/>
      <p class="lbl">${tr(c, "orderStatusLabel")}</p>
      <p><span class="badge ${badgeClassForOrder(st)}">${tr(c, `orderStatusName.${st}`)}</span></p>
      ${note ? `<hr class="divider"/><p style="font-size:14px;line-height:1.6;color:#4B5563">${note}</p>` : ""}
    </div>
    <div style="text-align:center;margin-top:24px">
      <a href="https://${c.domain}/dashboard/myorders" class="btn">${tr(c, "trackOrder")}</a>
    </div>
  `);
}

/**
 * NEW — richer delivery/logistics update. shippingNotificationEmail (below)
 * is kept as a thin alias so the existing shipping.controller.js call site
 * keeps working unchanged.
 */
export function deliveryStatusEmail({ order, tracking, user, country, status }) {
  const c = resolveEmailCountry(country?.code || order?.countryCode || tracking?.countryCode);
  const st = status || tracking?.status || "IN_TRANSIT";
  const eta = tracking?.estimatedDelivery
    ? new Date(tracking.estimatedDelivery).toLocaleDateString(c.language?.locale || "en-NG", {
        day: "numeric", month: "long", year: "numeric",
      })
    : null;

  return emailShell(c, `
    <div style="text-align:center;margin-bottom:28px">
      <div style="font-size:40px;margin-bottom:8px">${st === "DELIVERED" ? "📬" : st === "OUT_FOR_DELIVERY" ? "🛵" : "📦"}</div>
      <h2 style="font-size:22px;font-weight:700">${st === "DELIVERED" ? tr(c, "deliveryUpdateTitle") : tr(c, "shippedTitle")}</h2>
      <p style="color:#6B7280;margin-top:6px">${tr(c, "hi")} ${user?.name || tr(c, "there")} — ${tr(c, `delivery.${st}`)}</p>
    </div>
    <div class="card">
      <p class="lbl">${tr(c, "orderNumber")}</p>
      <p class="val" style="font-family:monospace">${order?.orderId || ""}</p>
      ${tracking?.trackingNumber ? `
        <hr class="divider"/>
        <p class="lbl">${tr(c, "trackingNumber")}</p>
        <p class="val" style="font-family:monospace;font-size:18px">${tracking.trackingNumber}</p>
        ${tracking.carrier?.name ? `<p style="color:#6B7280;font-size:13px;margin-top:4px">${tr(c, "via")} ${tracking.carrier.name}</p>` : ""}
      ` : ""}
      ${eta ? `<hr class="divider"/><p class="lbl">${tr(c, "estimatedDelivery")}</p><p class="val">${eta}</p>` : ""}
    </div>
    <div style="text-align:center;margin-top:24px">
      <a href="https://${c.domain}/tracking${tracking?.trackingNumber ? `?number=${tracking.trackingNumber}` : ""}" class="btn">${tr(c, "trackOrder")}</a>
    </div>
  `);
}

/** Backwards-compatible alias — existing shipping.controller.js imports this name. */
export function shippingNotificationEmail({ order, tracking, user, country }) {
  return deliveryStatusEmail({ order, tracking, user, country, status: tracking?.status });
}

export function welcomeEmail({ name, country }) {
  const c = resolveEmailCountry(country?.code);
  const site = c.seo?.siteName || "I-Coffee";
  return emailShell(c, `
    <div style="text-align:center;margin-bottom:28px">
      <div style="font-size:48px;margin-bottom:12px">☕</div>
      <h2 style="font-size:24px;font-weight:700">${tr(c, "welcomeTitle", { site })}</h2>
      <p style="color:#6B7280;font-size:15px;margin-top:8px">${tr(c, "welcomeBody", { name: name || tr(c, "there") })}</p>
    </div>
    <div class="card">
      <p style="font-size:14px;line-height:1.7;color:#4B5563">${tr(c, "welcomeBlurb", { country: c.name })}</p>
    </div>
    <div style="text-align:center;margin-top:28px">
      <a href="https://${c.domain}/shop" class="btn">${tr(c, "startShopping")}</a>
    </div>
  `);
}

export { STRINGS as EMAIL_STRINGS };
