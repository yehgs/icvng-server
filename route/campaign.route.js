// server/route/campaign.route.js
//
// Seasonal campaigns.
//   PUBLIC  GET  /api/campaign/active | /public/:slug | /public/:slug/products
//   ADMIN   /api/campaign/admin/*   (auth + admin + requirePermission)
//
// Territory is NOT enforced by the countryScope middleware here: campaigns use
// utils/campaignScope.js inside the controller so that every query, create and
// transition is built from the caller's resolved scope (IT/Director global,
// country-scoped roles their own country, other HQ roles Nigeria only).
import { Router } from "express";
import auth from "../middleware/auth.js";
import { admin } from "../middleware/Admin.js";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  getCampaignMeta, listCampaigns, getCampaign, createCampaign, updateCampaign, duplicateCampaign,
  publishCampaign, pauseCampaign, resumeCampaign, endCampaign, archiveCampaign, restoreCampaign, deleteCampaign,
  createRule, updateRule, setRuleStatus, deleteRule,
  createBlock, updateBlock, deleteBlock, reorderBlocks,
  campaignSelector, previewCampaign, campaignPerformance,
  getActiveCampaign, getPublicCampaignBySlug, getPublicCampaignProducts,
} from "../controllers/campaign.controller.js";

const router = Router();

// ── Public (storefront + mobile). Country comes from countryDetect. ──────────
router.get("/active", getActiveCampaign);
router.get("/public/:slug", getPublicCampaignBySlug);
router.get("/public/:slug/products", getPublicCampaignProducts);

// ── Admin ────────────────────────────────────────────────────────────────────
const base = [auth, admin];
const view = [...base, requirePermission("campaigns.view")];
const manage = [...base, requirePermission("campaigns.manage")];
const publish = [...base, requirePermission("campaigns.publish")];
// Discount rules: campaigns.manage (Editor/Manager) OR campaigns.discounts (Accountant).
// Whether a LIVE campaign's rules may be touched is decided in the controller.
const discounts = [...base, requirePermission(["campaigns.manage", "campaigns.discounts"])];

router.get("/admin/meta", ...view, getCampaignMeta);
router.get("/admin/selector/:kind", ...view, campaignSelector);
router.get("/admin/list", ...view, listCampaigns);
router.get("/admin/:id", ...view, getCampaign);
router.get("/admin/:id/preview", ...view, previewCampaign);
router.get("/admin/:id/performance", ...view, campaignPerformance);

router.post("/admin/create", ...manage, createCampaign);
router.put("/admin/:id", ...manage, updateCampaign);
router.post("/admin/:id/duplicate", ...manage, duplicateCampaign);

// Lifecycle — publisher-only
router.post("/admin/:id/publish", ...publish, publishCampaign);
router.post("/admin/:id/pause", ...publish, pauseCampaign);
router.post("/admin/:id/resume", ...publish, resumeCampaign);
router.post("/admin/:id/end", ...publish, endCampaign);
router.post("/admin/:id/archive", ...publish, archiveCampaign);
router.post("/admin/:id/restore", ...publish, restoreCampaign);
router.delete("/admin/:id", ...publish, deleteCampaign);

// Discount rules (draft-only for Editors, live-capable for Accountant/publishers — enforced in controller)
router.post("/admin/:id/rules", ...discounts, createRule);
router.put("/admin/:id/rules/:ruleId", ...discounts, updateRule);
router.post("/admin/:id/rules/:ruleId/activate", ...discounts, setRuleStatus("ACTIVE"));
router.post("/admin/:id/rules/:ruleId/pause", ...discounts, setRuleStatus("PAUSED"));
router.delete("/admin/:id/rules/:ruleId", ...discounts, deleteRule);

// Content blocks
router.post("/admin/:id/blocks", ...manage, createBlock);
router.put("/admin/:id/blocks/reorder", ...manage, reorderBlocks);
router.put("/admin/:id/blocks/:blockId", ...manage, updateBlock);
router.delete("/admin/:id/blocks/:blockId", ...manage, deleteBlock);

export default router;
