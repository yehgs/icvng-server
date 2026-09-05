import mongoose from "mongoose";
import countryScopedPlugin from "../core/countryScopedPlugin.js";

/**
 * models/popup.model.js
 *
 * Site-wide promotional pop-up, managed in the admin and rendered on the
 * storefront. Every field except `title` is optional by design (feature
 * request: "add an optional background image, an optional text, an
 * optional call to action button link, duration of display, page(s) to
 * be pop-up") — a popup can be as bare as a background image with no
 * text, or pure text with no image, etc.
 *
 * Follows the same shape as banner.model.js / homeContentBlock so it
 * plugs into the existing country-scoped + translation infrastructure
 * without any new plumbing (see countryScopedPlugin below and
 * TRANSLATABLE_FIELDS.popup in utils/translationService.js).
 */
const popupSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      default: "",
      trim: true,
    },
    // Optional freeform body copy shown under the title.
    bodyText: {
      type: String,
      default: "",
      trim: true,
    },
    // Optional background image (full-bleed behind/around the text).
    image: {
      type: String,
      default: "",
    },
    // Optional call-to-action button. Both must be set for the button to
    // render — a link with no label falls back to a generic "Learn more".
    ctaText: {
      type: String,
      default: "",
      trim: true,
    },
    ctaLink: {
      type: String,
      default: "",
      trim: true,
    },
    // Which storefront page(s) this popup is allowed to appear on.
    // "all" means every page. Matched client-side against the current
    // route (see client/src/components/SitePopupWidget.jsx).
    displayPages: {
      type: [String],
      enum: ["all", "home", "shop", "category", "product", "cart", "checkout", "blog"],
      default: ["all"],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: "At least one page must be selected",
      },
    },
    // How long the popup stays on screen once shown, in seconds.
    // 0 = stays open until the visitor dismisses it.
    displaySeconds: {
      type: Number,
      default: 0,
      min: 0,
    },
    // How long to wait after page load before showing it, in seconds.
    delaySeconds: {
      type: Number,
      default: 0,
      min: 0,
    },
    // If true, a visitor who dismisses/sees it once won't see it again
    // for the rest of that browser session.
    showOncePerSession: {
      type: Boolean,
      default: true,
    },
    // Optional scheduling window. Leave unset for "always on" (subject to isActive).
    startDate: {
      type: Date,
      default: null,
    },
    endDate: {
      type: Date,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Higher priority wins if more than one popup matches the current
    // page/market/date at the same time.
    priority: {
      type: Number,
      default: 0,
    },
    slug: {
      type: String,
      unique: true,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

popupSchema.index({ isActive: 1 });
popupSchema.index({ displayPages: 1 });

// Country dimension + isolation hooks — same pattern as banners/sliders,
// so a country-scoped admin only sees/edits their own market's popups and
// GLOBAL/HQ admins can target any market explicitly.
popupSchema.plugin(countryScopedPlugin);

const PopupModel = mongoose.model("popup", popupSchema);

export default PopupModel;
