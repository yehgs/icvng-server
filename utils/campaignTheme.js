// server/utils/campaignTheme.js
// Built-in, EDITABLE theme presets + WCAG contrast checks. Presets are starting
// points an admin applies to a campaign and then tweaks per country/campaign;
// nothing here is a permanent skin.

import { HEX_COLOR } from "../models/campaign.model.js";

export const THEME_PRESETS = {
  BLACK_FRIDAY: {
    preset: "BLACK_FRIDAY",
    backgroundColor: "#101010",
    surfaceColor: "#1C1C1C",
    primaryColor: "#D6A84F",
    secondaryColor: "#080808",
    accentColor: "#F2B84B",
    textColor: "#F7F4ED",
    mutedTextColor: "#B8B2A7",
    badgeBackground: "#D6A84F",
    badgeText: "#101010",
    fontFamily: "SANS",
    effect: "NONE",
    effectEnabled: false,
    effectIntensity: 4,
  },
  CHRISTMAS: {
    preset: "CHRISTMAS",
    backgroundColor: "#F7F3E9",
    surfaceColor: "#FFFFFF",
    primaryColor: "#185B42",
    secondaryColor: "#8E2638",
    accentColor: "#C7A45B",
    textColor: "#252525",
    mutedTextColor: "#5A5A5A",
    badgeBackground: "#8E2638",
    badgeText: "#FFFFFF",
    fontFamily: "SERIF",
    effect: "SNOWFALL",
    effectEnabled: true,
    effectIntensity: 4,
  },
  CUSTOM: {
    preset: "CUSTOM",
    backgroundColor: "#FFFFFF",
    surfaceColor: "#F7F7F7",
    primaryColor: "#7B3F1C",
    secondaryColor: "#4A2510",
    accentColor: "#C7A45B",
    textColor: "#1F1F1F",
    mutedTextColor: "#595959",
    badgeBackground: "#7B3F1C",
    badgeText: "#FFFFFF",
    fontFamily: "DEFAULT",
    effect: "NONE",
    effectEnabled: false,
    effectIntensity: 4,
  },
};

const lin = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
export const relativeLuminance = (hex) => {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
/** WCAG 2.x contrast ratio, 1–21. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// Pairs that must stay readable. Body text: 4.5 (WCAG AA). Muted/secondary
// copy is still real content, so 4.5 as well; badge text sits on a small
// badge, so 4.5.
const CONTRAST_PAIRS = [
  ["textColor", "backgroundColor", 4.5],
  ["textColor", "surfaceColor", 4.5],
  ["mutedTextColor", "backgroundColor", 4.5],
  ["mutedTextColor", "surfaceColor", 4.5],
  ["badgeText", "badgeBackground", 4.5],
];

/** @returns {string[]} human-readable failures (empty = accessible). Only checks colours that are valid hex. */
export function checkThemeContrast(theme) {
  const problems = [];
  for (const [fg, bg, min] of CONTRAST_PAIRS) {
    if (!HEX_COLOR.test(theme?.[fg] || "") || !HEX_COLOR.test(theme?.[bg] || "")) continue;
    const ratio = contrastRatio(theme[fg], theme[bg]);
    if (ratio < min) {
      problems.push(`${fg} on ${bg} has contrast ${ratio.toFixed(2)}:1 (minimum ${min}:1)`);
    }
  }
  return problems;
}
