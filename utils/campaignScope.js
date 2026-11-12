// server/utils/campaignScope.js
//
// Seasonal-campaign names for the shared country-scope policy. The policy itself
// lives in utils/featureScope.js (also used by email marketing and HR) so the
// three modules can never drift apart.
export {
  FEATURE_GLOBAL_SUBROLES as CAMPAIGN_GLOBAL_SUBROLES,
  resolveFeatureScope as resolveCampaignScope,
  featureCountryFilter as campaignCountryFilter,
  normalizeCountry,
  resolveCreateCountry,
} from "./featureScope.js";
