// models/bankTransferSettings.model.js
//
// Country-scoped "Direct Bank Transfer" receiving-account settings, managed
// exclusively by HQ IT/DIRECTOR (see route/bankTransferSettings.route.js —
// requirePermission(["settings.manage"]), which only IT/DIRECTOR hold via
// the WILDCARD permission in config/roles.js).
//
// One document per country. If a country has no document (or has one with
// isActive: false), Direct Bank Transfer is NOT offered as a payment
// option for that country's storefront — checkout falls back to Stripe
// only (see getAvailablePaymentMethods in
// controllers/bankTransferSettings.controller.js and
// DirectBankTransferOrderController in controllers/order.controller.js,
// which both consult this model).

import mongoose from "mongoose";
import { ALL_COUNTRY_CODES } from "../config/countries/index.js";

const bankTransferSettingsSchema = new mongoose.Schema(
  {
    countryCode: {
      type: String,
      required: true,
      enum: ALL_COUNTRY_CODES,
      unique: true,
      uppercase: true,
    },
    // Toggle without deleting — lets IT/DIRECTOR temporarily disable bank
    // transfer for a country (e.g. the receiving account is being
    // changed) without losing the saved details.
    isActive: {
      type: Boolean,
      default: true,
    },
    bankName: {
      type: String,
      required: [true, "Bank name is required"],
      trim: true,
    },
    accountName: {
      type: String,
      required: [true, "Account name is required"],
      trim: true,
    },
    accountNumber: {
      type: String,
      required: [true, "Account number is required"],
      trim: true,
    },
    // Optional — not every country's banking system uses a sort
    // code/routing number (e.g. IBAN-based countries use accountNumber
    // for the IBAN and can leave this blank).
    sortCode: {
      type: String,
      trim: true,
      default: "",
    },
    // The currency the customer must send in — normally matches this
    // country's own currency (config/countries/index.js), but kept as an
    // explicit field rather than derived so IT/DIRECTOR can correct it if
    // a country's receiving account is actually held in a different
    // currency than the storefront's display currency.
    currencyCode: {
      type: String,
      required: [true, "Currency code is required"],
      uppercase: true,
      trim: true,
    },
    // Free-text shown to the customer on the checkout/order-confirmation
    // page — e.g. "Please include your order number as the transfer
    // reference" or country-specific transfer-network notes (SWIFT vs.
    // local instant-transfer rails).
    instructions: {
      type: String,
      trim: true,
      default: "",
    },
    updatedBy: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

bankTransferSettingsSchema.index({ isActive: 1 });

const BankTransferSettingsModel = mongoose.model(
  "BankTransferSettings",
  bankTransferSettingsSchema,
);

export default BankTransferSettingsModel;
