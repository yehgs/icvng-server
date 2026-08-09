// utils/countryGeoData.js
//
// SINGLE SOURCE OF TRUTH for "which state/region/department + LGA/
// prefecture/commune divisions exist in country X", used to validate
// shipping-zone coverage. Replaces the old hardcoded
// `import { nigeriaStatesLgas } from "../data/nigeria-states-lgas.js"`
// that every zone create/update/CSV-import call used directly — that made
// it structurally impossible to create a shipping zone for Togo, Benin, or
// Italy, since every state was checked against Nigeria's list only.
//
// To add a new country: add a data/<country>-*.js file shaped like
// nigeria-states-lgas.js (`state`, `capital`, `lga: [...]`) and register it
// in COUNTRY_DIVISIONS below. No other code changes required.

import { nigeriaStatesLgas } from "../data/nigeria-states-lgas.js";
import { togoRegionsPrefectures } from "../data/togo-regions-prefectures.js";
import { beninDepartments } from "../data/benin-departments.js";
import { italyRegions } from "../data/italy-regions.js";
import { ALL_COUNTRY_CODES, DEFAULT_COUNTRY } from "../config/countries/index.js";

const COUNTRY_DIVISIONS = {
  NG: nigeriaStatesLgas,
  TG: togoRegionsPrefectures,
  BJ: beninDepartments,
  IT: italyRegions,
};

/**
 * Returns the array of { state, capital, lga: [...] } divisions for a
 * country code. Falls back to Nigeria (DEFAULT_COUNTRY) for an unknown or
 * missing code so legacy calls that never passed a countryCode keep
 * behaving exactly as before.
 *
 * @param {string} countryCode e.g. "TG"
 */
export function getDivisionsForCountry(countryCode) {
  const code = (countryCode || DEFAULT_COUNTRY).toUpperCase();
  return COUNTRY_DIVISIONS[code] || COUNTRY_DIVISIONS[DEFAULT_COUNTRY];
}

/**
 * Find a single state/region/department entry by name within a country.
 * Case-insensitive, matches the same lookup pattern the shipping
 * controllers previously did against nigeriaStatesLgas directly.
 */
export function findDivision(countryCode, stateName = "") {
  const divisions = getDivisionsForCountry(countryCode);
  return divisions.find(
    (d) => d.state.toLowerCase() === String(stateName).toLowerCase(),
  );
}

/** Human label for error messages, e.g. "Togo" for "TG". */
export function countryLabel(countryCode) {
  return countryCode || DEFAULT_COUNTRY;
}

export { ALL_COUNTRY_CODES };
export default getDivisionsForCountry;
