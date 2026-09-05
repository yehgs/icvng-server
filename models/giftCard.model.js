import mongoose from "mongoose";
import countryScopedPlugin from "../core/countryScopedPlugin.js";

/**
 * models/giftCard.model.js
 *
 * A prepaid, code-redeemable balance. Two ways a card comes into being:
 *  - "PURCHASED": a customer bought it on the storefront's dedicated
 *    "Buy a Gift Card" page and paid for it via Paystack/Stripe — see
 *    giftCard.controller.js's purchase/init/webhook endpoints.
 *  - "ADMIN_ISSUED": an admin (customer service, promo, goodwill credit)
 *    created it directly with no payment attached.
 *
 * Redemption is code-based, not account-based — whoever has the code can
 * redeem it (this is the classic/standard gift-card model the user asked
 * for), which is also why a gift card is NOT required to have an owning
 * user: `purchasedBy` records who paid for it (if anyone), separately from
 * who it's addressed to (`recipientEmail`) and who actually redeems it
 * (recorded per-redemption on the order, not on the card itself).
 */
const giftCardSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    initialAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    // Remaining spendable balance. Starts equal to initialAmount and is
    // decremented (never below 0) as orders redeem against it — see
    // utils/giftCardCheckout.js.
    balance: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      enum: ["NGN", "USD", "EUR", "GBP"],
      required: true,
      default: "NGN",
    },
    status: {
      type: String,
      enum: ["ACTIVE", "REDEEMED", "DISABLED", "EXPIRED"],
      default: "ACTIVE",
    },
    source: {
      type: String,
      enum: ["PURCHASED", "ADMIN_ISSUED"],
      required: true,
    },
    // Set only for source === "PURCHASED".
    purchasedBy: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      default: null,
    },
    purchaserEmail: { type: String, default: "" },
    purchaserName: { type: String, default: "" },
    paymentProvider: {
      type: String,
      enum: ["PAYSTACK", "STRIPE", null],
      default: null,
    },
    paymentReference: { type: String, default: "" },
    // Who the card is addressed to. For a self-purchase, this is simply
    // the purchaser's own email — the delivery email still goes out so the
    // flow (and the code itself) is identical either way.
    recipientName: { type: String, default: "" },
    recipientEmail: { type: String, required: true },
    message: { type: String, default: "" }, // optional gift note
    deliveredAt: { type: Date, default: null }, // when the code email was sent
    // Set only for source === "ADMIN_ISSUED".
    issuedBy: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      default: null,
    },
    adminNote: { type: String, default: "" }, // internal reason (goodwill credit, refund, etc.)
    expiryDate: { type: Date, default: null }, // null = never expires
    // Every redemption against this card, oldest first. A single card can
    // be spent across multiple orders (partial redemption) until exhausted.
    redemptions: [
      {
        orderGroupId: { type: String, required: true },
        orderId: { type: String, default: "" },
        amount: { type: Number, required: true },
        redeemedAt: { type: Date, default: Date.now },
        redeemedByUser: { type: mongoose.Schema.ObjectId, ref: "User", default: null },
      },
    ],
  },
  {
    timestamps: true,
  },
);

giftCardSchema.index({ status: 1 });
giftCardSchema.index({ recipientEmail: 1 });
giftCardSchema.index({ purchasedBy: 1 });

giftCardSchema.methods.isRedeemable = function () {
  if (this.status !== "ACTIVE") return false;
  if (this.balance <= 0) return false;
  if (this.expiryDate && this.expiryDate < new Date()) return false;
  return true;
};

// Country dimension — a gift card is denominated in one currency/market
// (matches the storefront it was bought on) and only redeemable against
// orders in that same market, mirroring how Paystack/Stripe availability is
// already country-gated.
giftCardSchema.plugin(countryScopedPlugin);

const GiftCardModel = mongoose.model("GiftCard", giftCardSchema);

export default GiftCardModel;
