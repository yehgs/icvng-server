// server/models/campaign-discount-rule.model.js
//
// One discount rule belonging to a campaign. A campaign can have many. A rule
// only ever applies to products in its own country, only while the campaign is
// live AND the rule itself is ACTIVE and inside its (optional) own window.
//
// MONEY: `discountValue` for FIXED_AMOUNT is expressed in the CATALOGUE BASE
// CURRENCY (NGN) — the currency every product price is stored in. The engine
// never converts currencies; the storefront converts BOTH the original and the
// final price for display with the same rate it already uses for every price,
// so a fixed ₦5,000 discount is shown consistently in XOF/EUR/etc. PERCENTAGE
// is currency-independent and is the recommended type for multi-currency
// markets. See services/campaignPricing.js.
//
// Not supported (documented non-goals): order-wide (ORDER scope) discounts,
// stacking, per-customer / total usage limits. The schema leaves room for them
// but the engine does not honour them, so they are not exposed.

import mongoose from "mongoose";
import countryScopedPlugin from "../core/countryScopedPlugin.js";

export const DISCOUNT_TYPES = ["PERCENTAGE", "FIXED_AMOUNT"];
export const RULE_SCOPES = ["ALL", "PRODUCT", "CATEGORY", "BRAND"];
export const RULE_STATUSES = ["DRAFT", "ACTIVE", "PAUSED"];
export const MAX_PERCENTAGE = 90;
export const MAX_FIXED_AMOUNT = 100_000_000;

const campaignDiscountRuleSchema = new mongoose.Schema(
  {
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true, index: true },

    name: { type: String, required: true, trim: true, maxlength: 120 },
    // Optional custom badge copy ("CHRISTMAS DEAL"). When empty the storefront
    // renders a localized "{n}% OFF" itself. Translatable (entityType "campaignRule").
    label: { type: String, default: "", trim: true, maxlength: 40 },

    discountType: { type: String, enum: DISCOUNT_TYPES, required: true },
    discountValue: { type: Number, required: true, min: 0 },

    scope: { type: String, enum: RULE_SCOPES, default: "ALL" },
    productIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
    categoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "category" }],
    brandIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "brand" }],

    minQuantity: { type: Number, default: 1, min: 1 },
    // Cap on the discount per unit, in base currency. null = uncapped.
    maxDiscountAmount: { type: Number, default: null, min: 0 },

    // Special-order products (price shown is the 2/5-week delivery price, not
    // the in-stock regular price) are NOT discounted unless this is enabled.
    includeSpecialOrder: { type: Boolean, default: false },

    // Optional own window inside the campaign window; null = inherit.
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },

    status: { type: String, enum: RULE_STATUSES, default: "DRAFT", index: true },
    // Higher wins a tie between two rules that give the same discount.
    priority: { type: Number, default: 0, min: 0, max: 1000 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

campaignDiscountRuleSchema.index({ countryCode: 1, campaignId: 1, status: 1 });
campaignDiscountRuleSchema.plugin(countryScopedPlugin);

const CampaignDiscountRuleModel =
  mongoose.models.CampaignDiscountRule ||
  mongoose.model("CampaignDiscountRule", campaignDiscountRuleSchema);
export default CampaignDiscountRuleModel;
