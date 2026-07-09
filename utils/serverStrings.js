/**
 * utils/serverStrings.js
 *
 * PHASE 5 — server-side i18n for BACKEND-generated content: transactional
 * emails, invoice/receipt PDFs, notifications. The client SPAs have their own
 * i18n; this covers text the server renders directly.
 *
 * Keeps copy in one place, keyed by language, with English fallback per key.
 * Add a language by adding its column — no code changes elsewhere.
 *
 * Usage:
 *   import { t } from "../utils/serverStrings.js";
 *   t("email.orderConfirmed.title", "fr", { orderId: "ABC" })
 */

const STRINGS = {
  en: {
    // Emails — order
    "email.orderConfirmed.title": "Order Confirmed",
    "email.orderConfirmed.greeting": "Hi {name},",
    "email.orderConfirmed.body": "Thank you for your order. We've received it and it's being processed.",
    "email.orderConfirmed.orderNumber": "Order Number",
    "email.orderConfirmed.total": "Total",
    "email.orderConfirmed.cta": "View Your Order",
    // Emails — shipping
    "email.shipped.title": "Your Order Has Shipped",
    "email.shipped.body": "Good news! Your order is on its way.",
    "email.shipped.tracking": "Tracking Number",
    // Emails — generic
    "email.footer.rights": "All rights reserved.",
    "email.footer.contact": "Contact us",
    "email.greeting.fallback": "Hello,",
    // Invoice / receipt
    "invoice.title": "Invoice",
    "invoice.receipt": "Receipt",
    "invoice.number": "Invoice No.",
    "invoice.date": "Date",
    "invoice.billedTo": "Billed To",
    "invoice.item": "Item",
    "invoice.qty": "Qty",
    "invoice.unitPrice": "Unit Price",
    "invoice.amount": "Amount",
    "invoice.subtotal": "Subtotal",
    "invoice.tax": "Tax",
    "invoice.shipping": "Shipping",
    "invoice.total": "Total",
    "invoice.thankYou": "Thank you for your business.",
    // Notifications
    "notif.orderPlaced": "New order {orderId} placed",
    "notif.lowStock": "Low stock: {product}",
    "notif.paymentReceived": "Payment received for order {orderId}",
  },

  fr: {
    "email.orderConfirmed.title": "Commande confirmée",
    "email.orderConfirmed.greeting": "Bonjour {name},",
    "email.orderConfirmed.body": "Merci pour votre commande. Nous l'avons bien reçue et elle est en cours de traitement.",
    "email.orderConfirmed.orderNumber": "Numéro de commande",
    "email.orderConfirmed.total": "Total",
    "email.orderConfirmed.cta": "Voir votre commande",
    "email.shipped.title": "Votre commande a été expédiée",
    "email.shipped.body": "Bonne nouvelle ! Votre commande est en route.",
    "email.shipped.tracking": "Numéro de suivi",
    "email.footer.rights": "Tous droits réservés.",
    "email.footer.contact": "Contactez-nous",
    "email.greeting.fallback": "Bonjour,",
    "invoice.title": "Facture",
    "invoice.receipt": "Reçu",
    "invoice.number": "Facture N°",
    "invoice.date": "Date",
    "invoice.billedTo": "Facturé à",
    "invoice.item": "Article",
    "invoice.qty": "Qté",
    "invoice.unitPrice": "Prix unitaire",
    "invoice.amount": "Montant",
    "invoice.subtotal": "Sous-total",
    "invoice.tax": "Taxe",
    "invoice.shipping": "Livraison",
    "invoice.total": "Total",
    "invoice.thankYou": "Merci pour votre confiance.",
    "notif.orderPlaced": "Nouvelle commande {orderId} passée",
    "notif.lowStock": "Stock faible : {product}",
    "notif.paymentReceived": "Paiement reçu pour la commande {orderId}",
  },

  it: {
    "email.orderConfirmed.title": "Ordine confermato",
    "email.orderConfirmed.greeting": "Ciao {name},",
    "email.orderConfirmed.body": "Grazie per il tuo ordine. Lo abbiamo ricevuto ed è in fase di elaborazione.",
    "email.orderConfirmed.orderNumber": "Numero d'ordine",
    "email.orderConfirmed.total": "Totale",
    "email.orderConfirmed.cta": "Visualizza il tuo ordine",
    "email.shipped.title": "Il tuo ordine è stato spedito",
    "email.shipped.body": "Buone notizie! Il tuo ordine è in arrivo.",
    "email.shipped.tracking": "Numero di tracciamento",
    "email.footer.rights": "Tutti i diritti riservati.",
    "email.footer.contact": "Contattaci",
    "email.greeting.fallback": "Salve,",
    "invoice.title": "Fattura",
    "invoice.receipt": "Ricevuta",
    "invoice.number": "Fattura N.",
    "invoice.date": "Data",
    "invoice.billedTo": "Fatturato a",
    "invoice.item": "Articolo",
    "invoice.qty": "Qtà",
    "invoice.unitPrice": "Prezzo unitario",
    "invoice.amount": "Importo",
    "invoice.subtotal": "Subtotale",
    "invoice.tax": "Imposta",
    "invoice.shipping": "Spedizione",
    "invoice.total": "Totale",
    "invoice.thankYou": "Grazie per averci scelto.",
    "notif.orderPlaced": "Nuovo ordine {orderId} effettuato",
    "notif.lowStock": "Scorte in esaurimento: {product}",
    "notif.paymentReceived": "Pagamento ricevuto per l'ordine {orderId}",
  },
};

/**
 * Translate a key into `language`, interpolating {placeholders} from `vars`.
 * Falls back to English for the key, then to the key itself.
 */
export function t(key, language = "en", vars = {}) {
  const lang = STRINGS[language] ? language : "en";
  let str = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
  }
  return str;
}

/** All keys present (for coverage checks/tests). */
export const STRING_KEYS = Object.keys(STRINGS.en);

/** Which languages have a full table. */
export const SUPPORTED_STRING_LANGUAGES = Object.keys(STRINGS);

export default { t, STRING_KEYS, SUPPORTED_STRING_LANGUAGES };
