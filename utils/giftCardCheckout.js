// utils/giftCardCheckout.js
//
// Two-step, shared-by-every-payment-flow helper for applying a gift card at
// checkout, mirroring the two-step shape checkout already has everywhere
// else (initiate → confirm): resolve computes the discount WITHOUT touching
// the balance (safe to call speculatively, e.g. as the customer types a
// code in), redeem actually deducts it, and is only ever called once an
// order has genuinely been created — never on a payment that might still
// fail or get abandoned.
import GiftCardModel from "../models/giftCard.model.js";

/**
 * Validate a gift card code against the order it would be applied to, and
 * compute how much of it would be used — WITHOUT deducting anything. Safe
 * to call multiple times (e.g. re-checked at both payment initiation and
 * order confirmation, since minutes can pass between them and the balance
 * could have changed via a different order in the meantime).
 *
 * Country is checked as well as currency: a gift card is denominated in,
 * and only ever purchasable/issuable for, one specific market (see
 * giftCard.model.js's countryScopedPlugin) — a Nigeria-issued NGN card
 * should not be redeemable on a different NGN-adjacent storefront even if
 * currencies happened to coincide, matching how Paystack/Stripe
 * availability is already gated per-country rather than per-currency.
 *
 * @param {{ code: string, orderAmount: number, currency: string, countryCode: string }} params
 * @returns {Promise<{ giftCard: object, appliedAmount: number, remainderToPay: number }>}
 * @throws {Error} with a customer-facing message if the code is invalid/unusable
 */
export async function resolveGiftCardForCheckout({ code, orderAmount, currency, countryCode }) {
  if (!code || !String(code).trim()) {
    throw new Error("Gift card code is required");
  }
  const giftCard = await GiftCardModel.findOne({ code: String(code).trim().toUpperCase() });
  if (!giftCard) {
    throw new Error("Gift card code not found");
  }
  if (!giftCard.isRedeemable()) {
    if (giftCard.status === "REDEEMED" || giftCard.balance <= 0) {
      throw new Error("This gift card has no remaining balance");
    }
    if (giftCard.expiryDate && giftCard.expiryDate < new Date()) {
      throw new Error("This gift card has expired");
    }
    throw new Error("This gift card is not active");
  }
  if (currency && giftCard.currency !== currency) {
    throw new Error(
      `This gift card is denominated in ${giftCard.currency} and can't be used for a ${currency} order`,
    );
  }
  if (countryCode && giftCard.countryCode && giftCard.countryCode !== countryCode) {
    throw new Error("This gift card isn't valid for this store's market");
  }

  const appliedAmount = Math.min(giftCard.balance, Math.max(0, orderAmount || 0));
  return {
    giftCard,
    appliedAmount,
    remainderToPay: Math.max(0, (orderAmount || 0) - appliedAmount),
  };
}

/**
 * Actually deduct `amount` from the gift card's balance and log the
 * redemption, atomically (a `balance >= amount` guard on the update means
 * two near-simultaneous redemptions can't both succeed and overdraw it).
 * Call this ONLY after the order it's being applied to has been
 * successfully created/persisted.
 *
 * If the balance changed underneath us since resolveGiftCardForCheckout was
 * called (e.g. spent by another order in the gap between payment
 * initiation and confirmation) and can no longer cover the full `amount`,
 * this redeems whatever remains instead of failing outright — the
 * customer already paid the gateway the discounted price, so silently
 * failing to redeem anything would leave the merchant short; partially
 * redeeming is the least-bad outcome, and is logged loudly so it can be
 * reconciled.
 *
 * @returns {Promise<{ redeemed: number, giftCard: object }|null>} null if the card had already hit zero
 */
export async function redeemGiftCardAmount({
  giftCardId,
  amount,
  orderGroupId,
  orderId = "",
  redeemedByUser = null,
}) {
  if (!giftCardId || !amount || amount <= 0) return null;

  let updated = await GiftCardModel.findOneAndUpdate(
    { _id: giftCardId, balance: { $gte: amount } },
    {
      $inc: { balance: -amount },
      $push: { redemptions: { orderGroupId, orderId, amount, redeemedByUser } },
    },
    { new: true },
  );

  let redeemed = amount;

  if (!updated) {
    // Balance moved since it was resolved — redeem whatever is left, if
    // anything, rather than silently redeeming nothing.
    const current = await GiftCardModel.findById(giftCardId);
    if (!current || current.balance <= 0) {
      console.error(
        `[giftCardCheckout] Gift card ${giftCardId} had 0 balance at redemption time for order ` +
          `group ${orderGroupId} (expected to redeem ${amount}). Nothing redeemed — reconcile manually.`,
      );
      return null;
    }
    redeemed = current.balance;
    console.warn(
      `[giftCardCheckout] Gift card ${giftCardId} balance (${current.balance}) was less than the ` +
        `expected redemption (${amount}) for order group ${orderGroupId} — redeeming the remaining ` +
        `${redeemed} instead. This can happen if the same card was spent elsewhere between checkout ` +
        `initiation and confirmation.`,
    );
    updated = await GiftCardModel.findOneAndUpdate(
      { _id: giftCardId, balance: { $gte: redeemed } },
      {
        $inc: { balance: -redeemed },
        $push: { redemptions: { orderGroupId, orderId, amount: redeemed, redeemedByUser } },
      },
      { new: true },
    );
    if (!updated) return null; // lost a race twice in a row — extremely unlikely; give up cleanly
  }

  if (updated.balance <= 0 && updated.status === "ACTIVE") {
    updated.status = "REDEEMED";
    await updated.save();
  }

  return { redeemed, giftCard: updated };
}
