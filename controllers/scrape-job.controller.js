//server
// controllers/scrape-job.controller.js  (v2 — ownership, row delete, SALES_MANAGER)
import ScrapeJobModel, {
  SCRAPE_PLATFORMS,
} from "../models/scrape-job.model.js";
import CrmLeadModel from "../models/crm-lead.model.js";
import UserModel from "../models/user.model.js";
import { runScrapeJob } from "../utils/scrapeEngine.js";

// Roles that can use the scraper/CRM
const CRM_ROLES = [
  "SALES",
  "SALES_MANAGER",
  "MANAGER",
  "IT",
  "EDITOR",
  "DIRECTOR",
];
// Roles that can see ALL users' jobs (not just their own)
const SUPER_ROLES = ["IT", "DIRECTOR", "MANAGER"];

function crmAccess(user, res) {
  if (!CRM_ROLES.includes(user?.subRole)) {
    res.status(403).json({ success: false, message: "CRM access denied" });
    return false;
  }
  return true;
}

function isSuperRole(user) {
  return SUPER_ROLES.includes(user?.subRole);
}

// ── GET /scraper/platforms ─────────────────────────────────────────────────
export async function getPlatformsController(req, res) {
  try {
    if (!crmAccess(req.user, res)) return;
    const platformInfo = SCRAPE_PLATFORMS.map((p) => ({
      name: p,
      requiresApiKey: [
        "Google Search",
        "Google Maps",
        "LinkedIn",
        "Facebook",
        "Instagram",
        "Twitter / X",
        "Jobberman",
      ].includes(p),
      apiKeyEnv: [
        "Google Search",
        "Google Maps",
        "LinkedIn",
        "Facebook",
      ].includes(p)
        ? "SERP_API_KEY"
        : null,
    }));
    return res.json({
      success: true,
      data: platformInfo,
      capabilities: {
        serpApi: !!process.env.SERP_API_KEY,
        googleCse: !!(process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_ID),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── GET /scraper/jobs ──────────────────────────────────────────────────────
export async function getJobsController(req, res) {
  try {
    if (!crmAccess(req.user, res)) return;
    // Super roles see ALL jobs; others see only their own
    const query = isSuperRole(req.user) ? {} : { createdBy: req.user._id };
    const jobs = await ScrapeJobModel.find(query)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return res.json({
      success: true,
      data: jobs,
      isFiltered: !isSuperRole(req.user),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── GET /scraper/jobs/:id ──────────────────────────────────────────────────
export async function getJobByIdController(req, res) {
  try {
    if (!crmAccess(req.user, res)) return;
    const job = await ScrapeJobModel.findById(req.params.id);
    if (!job)
      return res.status(404).json({ success: false, message: "Job not found" });
    // Ownership check
    if (
      !isSuperRole(req.user) &&
      job.createdBy.toString() !== req.user._id.toString()
    ) {
      return res
        .status(403)
        .json({
          success: false,
          message: "You can only view your own scrape jobs",
        });
    }
    return res.json({ success: true, data: job });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── POST /scraper/jobs — create + run ─────────────────────────────────────
export async function createAndRunJobController(req, res) {
  try {
    if (!crmAccess(req.user, res)) return;
    const {
      name,
      platform,
      targetUrl,
      searchQuery,
      maxPages,
      maxResults,
      extractFields,
    } = req.body;
    if (!searchQuery && !targetUrl) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Search query or target URL required",
        });
    }
    const job = await ScrapeJobModel.create({
      name: name || searchQuery,
      platform: platform || "Google Search",
      targetUrl: targetUrl || "",
      searchQuery: searchQuery || "",
      maxPages: Math.min(maxPages || 3, 10),
      maxResults: Math.min(maxResults || 50, 200),
      extractFields: extractFields || {
        emails: true,
        phones: true,
        companyName: true,
        website: true,
        address: true,
        socialLinks: true,
      },
      status: "running",
      createdBy: req.user._id,
      createdByName: req.user.name,
    });
    res.json({ success: true, message: "Scrape job started", jobId: job._id });
    // Run asynchronously
    (async () => {
      try {
        const results = await runScrapeJob(job.toObject());
        await ScrapeJobModel.findByIdAndUpdate(job._id, {
          status: "completed",
          rawResults: results,
          totalFound: results.length,
          progress: 100,
          completedAt: new Date(),
        });
      } catch (err) {
        await ScrapeJobModel.findByIdAndUpdate(job._id, {
          status: "failed",
          errorMessage: err.message,
          progress: 0,
        });
      }
    })();
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── DELETE /scraper/jobs/:id/results/:index — delete a single scraped row ──
export async function deleteResultRowController(req, res) {
  try {
    if (!crmAccess(req.user, res)) return;
    const { id, index } = req.params;
    const job = await ScrapeJobModel.findById(id);
    if (!job)
      return res.status(404).json({ success: false, message: "Job not found" });
    if (
      !isSuperRole(req.user) &&
      job.createdBy.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const idx = parseInt(index);
    if (isNaN(idx) || idx < 0 || idx >= job.rawResults.length) {
      return res.status(400).json({ success: false, message: "Invalid index" });
    }
    job.rawResults.splice(idx, 1);
    job.totalFound = job.rawResults.length;
    await job.save();
    return res.json({
      success: true,
      message: "Row removed",
      totalFound: job.rawResults.length,
      data: job.rawResults,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── DELETE /scraper/jobs/:id/results/bulk — delete multiple rows by indices ─
export async function deleteBulkResultRowsController(req, res) {
  try {
    if (!crmAccess(req.user, res)) return;
    const { indices } = req.body; // array of indices to remove
    const job = await ScrapeJobModel.findById(req.params.id);
    if (!job)
      return res.status(404).json({ success: false, message: "Job not found" });
    if (
      !isSuperRole(req.user) &&
      job.createdBy.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const indexSet = new Set((indices || []).map(Number));
    job.rawResults = job.rawResults.filter((_, i) => !indexSet.has(i));
    job.totalFound = job.rawResults.length;
    await job.save();
    return res.json({
      success: true,
      message: `${indexSet.size} rows removed`,
      totalFound: job.rawResults.length,
      data: job.rawResults,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── POST /scraper/jobs/:id/import — import selected results to CRM ─────────
export async function importJobResultsController(req, res) {
  try {
    if (!crmAccess(req.user, res)) return;
    const { selectedIndices, importAll = false } = req.body;
    const job = await ScrapeJobModel.findById(req.params.id);
    if (!job)
      return res.status(404).json({ success: false, message: "Job not found" });
    if (
      !isSuperRole(req.user) &&
      job.createdBy.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    let toImport = importAll
      ? job.rawResults
      : (selectedIndices || []).map((i) => job.rawResults[i]);
    toImport = toImport.filter(Boolean);
    if (!toImport.length)
      return res
        .status(400)
        .json({ success: false, message: "No results selected" });

    const leads = toImport.map((r) => ({
      companyName: r.companyName || r.name || "",
      contactName: r.contactName || "",
      email: Array.isArray(r.emails) ? r.emails[0] || "" : r.email || "",
      phone: Array.isArray(r.phones) ? r.phones[0] || "" : r.phone || "",
      website: r.website || "",
      address: r.address || "",
      linkedinUrl: r.linkedinUrl || "",
      facebookUrl: r.facebookUrl || "",
      source: job.platform,
      scrapeJobId: job._id,
      scrapeSource: r.scrapeSource || job.targetUrl,
      rawScrapedData: r,
      stage: "New",
      createdBy: req.user._id,
      createdByName: req.user.name,
      activities: [
        {
          type: "system",
          content: `Imported from "${job.name}" scrape by ${req.user.name}`,
          performedBy: req.user._id,
          performedByName: req.user.name,
        },
      ],
    }));

    const inserted = await CrmLeadModel.insertMany(leads, { ordered: false });
    await ScrapeJobModel.findByIdAndUpdate(job._id, {
      $inc: { totalImported: inserted.length },
    });
    return res.json({
      success: true,
      message: `${inserted.length} leads imported to CRM`,
      count: inserted.length,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── DELETE /scraper/jobs/:id ───────────────────────────────────────────────
export async function deleteJobController(req, res) {
  try {
    if (!crmAccess(req.user, res)) return;
    const job = await ScrapeJobModel.findById(req.params.id);
    if (!job)
      return res.status(404).json({ success: false, message: "Job not found" });
    if (
      !isSuperRole(req.user) &&
      job.createdBy.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    await ScrapeJobModel.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: "Job deleted" });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}
