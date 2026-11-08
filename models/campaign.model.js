// server/models/campaign.model.js
//
// Seasonal campaigns (Black Friday, Christmas, …). One document per
// (country, campaign). Everything customer-visible about a campaign — its
// window, theme tokens, and (via the sibling collections) content blocks and
// discount rules — hangs off this record.
//
// DESIGN NOTES
//  • `publishState` is the ADMIN INTENT (DRAFT / PUBLISHED / PAUSED /
//    ARCHIVED). The lifecycle `status` the UI and API expose
//    (DRAFT / SCHEDULED / ACTIVE / PAUSED / ENDED / ARCHIVED) is DERIVED from
//    publishState + startsAt/endsAt + the server clock, so a campaign starts
//    and ends on time with no cron job and no stale "ACTIVE" flag. See
//    deriveCampaignStatus().
//  • Timestamps are persisted as UTC `Date`s. `timezone` (IANA) is only the
//    zone the admin used to enter / wants to see the window in; it never
//    changes what instant the campaign starts.
//  • Theme is a closed set of validated tokens — hex colours, an enum effect,
//    an enum font stack, bounded intensity. There is deliberately NO field
//    that accepts CSS, HTML or script.
//  • Country isolation comes from countryScopedPlugin (like banners /
//    gift cards), and the controller adds an explicit per-role scope on top
//    (see utils/campaignScope.js) because EDITOR/ACCOUNTANT are HQ roles that
//    the plugin treats as GLOBAL.

import mongoose from "mongoose";
import countryScopedPlugin from "../core/countryScopedPlugin.js";

export const CAMPAIGN_TYPES = ["BLACK_FRIDAY", "CHRISTMAS", "CUSTOM"];
export const PUBLISH_STATES = ["DRAFT", "PUBLISHED", "PAUSED", "ARCHIVED"];
export const CAMPAIGN_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "ACTIVE",
  "PAUSED",
  "ENDED",
  "ARCHIVED",
];
export const THEME_EFFECTS = ["NONE", "SNOWFALL", "SPARKLE", "SUBTLE_PARTICLES"];
// Approved font stacks only — the storefront maps each to a local/system stack.
export const THEME_FONTS = ["DEFAULT", "SERIF", "SANS"];
export const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

const hex = (def) => ({
  type: String,
  default: def,
  validate: { validator: (v) => HEX_COLOR.test(v), message: "{PATH} must be a #RRGGBB hex colour" },
});

const themeSchema = new mongoose.Schema(
  {
    preset: { type: String, enum: CAMPAIGN_TYPES, default: "CUSTOM" },
    primaryColor: hex("#185B42"),
    secondaryColor: hex("#8E2638"),
    accentColor: hex("#C7A45B"),
    backgroundColor: hex("#F7F3E9"),
    surfaceColor: hex("#FFFFFF"),
    textColor: hex("#252525"),
    mutedTextColor: hex("#5A5A5A"),
    badgeBackground: hex("#8E2638"),
    badgeText: hex("#FFFFFF"),
    fontFamily: { type: String, enum: THEME_FONTS, default: "DEFAULT" },
    effect: { type: String, enum: THEME_EFFECTS, default: "NONE" },
    effectEnabled: { type: Boolean, default: false },
    // 1 (barely there) … 10 (busiest). Clients map this onto a small, hard-capped
    // particle count — see core/src/campaigns/effects.js.
    effectIntensity: { type: Number, min: 1, max: 10, default: 4 },
    bannerImage: { type: String, default: "" },
    mobileBannerImage: { type: String, default: "" },
  },
  { _id: false },
);

const historySchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    byName: { type: String, default: "" },
    action: { type: String, required: true },
    note: { type: String, default: "" },
    // Small before/after summary of what changed (never whole documents).
    changes: { type: mongoose.Schema.Types.Mixed, default: undefined },
  },
  { _id: false },
);

const campaignSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 140 },
    type: { type: String, enum: CAMPAIGN_TYPES, default: "CUSTOM", index: true },
    tagline: { type: String, default: "", trim: true, maxlength: 200 },
    description: { type: String, default: "", trim: true, maxlength: 2000 },

    publishState: { type: String, enum: PUBLISH_STATES, default: "DRAFT", index: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    timezone: { type: String, default: "Africa/Lagos" },
    // Higher wins when campaigns overlap (theme + tie-breaks). Overlapping
    // published campaigns of EQUAL priority are rejected at publish time.
    priority: { type: Number, default: 0, min: 0, max: 1000 },

    theme: { type: themeSchema, default: () => ({}) },

    showCountdown: { type: Boolean, default: false },
    // Public landing page at /campaign/:slug on web and the campaign screen on mobile.
    landingEnabled: { type: Boolean, default: true },

    publishedAt: { type: Date, default: null },
    pausedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true },
);

campaignSchema.index({ countryCode: 1, slug: 1 }, { unique: true });
campaignSchema.index({ countryCode: 1, publishState: 1, startsAt: 1, endsAt: 1 });

campaignSchema.plugin(countryScopedPlugin);

/**
 * The lifecycle status customers/admins see, derived from intent + clock.
 * `now` is injectable for tests. Server time is the only clock that matters.
 */
export function deriveCampaignStatus(c, now = new Date()) {
  if (!c) return "DRAFT";
  switch (c.publishState) {
    case "ARCHIVED":
      return "ARCHIVED";
    case "PAUSED":
      return "PAUSED";
    case "PUBLISHED": {
      const t = now.getTime();
      if (t < new Date(c.startsAt).getTime()) return "SCHEDULED";
      if (t > new Date(c.endsAt).getTime()) return "ENDED";
      return "ACTIVE";
    }
    default:
      return "DRAFT";
  }
}

/** True only while a campaign is live for customers. */
export const isCampaignLive = (c, now = new Date()) => deriveCampaignStatus(c, now) === "ACTIVE";

campaignSchema.virtual("status").get(function () {
  return deriveCampaignStatus(this);
});
campaignSchema.set("toJSON", { virtuals: true });
campaignSchema.set("toObject", { virtuals: true });

const CampaignModel = mongoose.models.Campaign || mongoose.model("Campaign", campaignSchema);
export default CampaignModel;
