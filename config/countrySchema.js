/**
 * config/countrySchema.js
 *
 * Shared schema fragment injected into every country-scoped model.
 *
 * Usage:
 *
 *   import { countryField, addCountryIndex } from '../config/countrySchema.js';
 *
 *   const mySchema = new mongoose.Schema({
 *     ...countryField,          // adds countryCode field
 *     name: String,
 *     ...
 *   });
 *
 *   addCountryIndex(mySchema);  // adds compound index with countryCode
 */

import mongoose from "mongoose";
import { ALL_COUNTRY_CODES, DEFAULT_COUNTRY } from "./countries/index.js";

/**
 * Drop-in schema fragment.  Spread into your Schema definition:
 *
 *   new mongoose.Schema({ ...countryField, ...yourFields })
 */
export const countryField = {
  countryCode: {
    type: String,
    enum: ALL_COUNTRY_CODES,
    default: DEFAULT_COUNTRY,
    index: true,
  },
};

/**
 * Adds a compound index on [countryCode, createdAt] and
 * [countryCode, <primaryField>] for fast per-country queries.
 *
 * @param {mongoose.Schema} schema
 * @param {string} [primaryField="createdAt"]  Additional field to compound
 */
export function addCountryIndex(schema, primaryField = "createdAt") {
  schema.index({ countryCode: 1, [primaryField]: -1 });
}

/**
 * Build a Mongoose filter clause that scopes a query to one country.
 * Accepts undefined/null gracefully and falls back to the default country.
 *
 * @param {string|undefined} countryCode
 * @returns {{ countryCode: string }}
 */
export function countryFilter(countryCode) {
  const code =
    countryCode && ALL_COUNTRY_CODES.includes(countryCode.toUpperCase())
      ? countryCode.toUpperCase()
      : DEFAULT_COUNTRY;
  return { countryCode: code };
}
