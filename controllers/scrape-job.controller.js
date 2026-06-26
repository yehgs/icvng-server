//server
// controllers/scrape-job.controller.js  (updated — quota enforcement + B2C)
import ScrapeJobModel from "../models/scrape-job.model.js";
import CrmLeadModel from "../models/crm-lead.model.js";
import UserModel from "../models/user.model.js";
import { runScrapeJob } from "../utils/scrapeEngine.js";
import { deductQuota } from "./scraper-quota.controller.js";

const CRM_ROLES = [
  "SALES",
  "SALES_MANAGER",
  "MANAGER",
  "IT",
  "EDITOR",
  "DIRECTOR",
];
const SUPER_ROLES = ["IT", "DIRECTOR", "MANAGER"];
const UNLIMITED_ROLES = ["IT", "DIRECTOR", "MANAGER"];

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
function isUnlimited(user) {
  return UNLIMITED_ROLES.includes(user?.subRole);
}

// ── Quota check helper (non-unlimited users) ─────────────────────────────────
async function enforceQuota(user, res) {
  if (isUnlimited(user)) return true; // skip for admins

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const freshUser = await UserModel.findById(user._id).lean();
  const quota = freshUser?.scrapeQuota || {};

  // Auto-reset if new month
  const lastReset = quota.quotaResetDate
    ? new Date(quota.quotaResetDate)
    : null;
  let usedThisMonth = quota.usedThisMonth || 0;
  if (!lastReset || lastReset < monthStart) {
    await UserModel.findByIdAndUpdate(user._id, {
      "scrapeQuota.usedThisMonth": 0,
      "scrapeQuota.quotaResetDate": monthStart,
    });
    usedThisMonth = 0;
  }

  const limit = quota.monthlyLimit || 0;
  if (limit === 0) {
    res.status(403).json({
      success: false,
      message:
        "No scraper quota assigned to your account. Contact your Manager or IT to get access.",
    });
    return false;
  }

  if (usedThisMonth >= limit) {
    res.status(429).json({
      success: false,
      message: `Monthly API quota exhausted (${usedThisMonth}/${limit} calls used). Resets on the 1st of next month.`,
      quotaExhausted: true,
      used: usedThisMonth,
      limit,
    });
    return false;
  }

  return true;
}

// ── GET /scraper/platforms ────────────────────────────────────────────────────
export async function getPlatformsController(req, res) {
  try {
    if (!crmAccess(req.user, res)) return;
    const platformInfo = [
      {
        name: "Google Search",
        requiresApiKey: true,
        apiKeyEnv: "SERP_API_KEY",
      },
      { name: "Google Maps", requiresApiKey: true, apiKeyEnv: "SERP_API_KEY" },
      { name: "LinkedIn", requiresApiKey: true, apiKeyEnv: "SERP_API_KEY" },
      { name: "Facebook", requiresApiKey: true, apiKeyEnv: "SERP_API_KEY" },
      { name: "Instagram", requiresApiKey: true, apiKeyEnv: "SERP_API_KEY" },
      { name: "Twitter / X", requiresApiKey: false, apiKeyEnv: null },
      { name: "Yellow Pages NG", requiresApiKey: false, apiKeyEnv: null },
      { name: "VConnect NG", requiresApiKey: false, apiKeyEnv: null },
      { name: "Jobberman", requiresApiKey: false, apiKeyEnv: null },
      { name: "Custom URL", requiresApiKey: false, apiKeyEnv: null },
    ];
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

// ── GET /scraper/jobs ─────────────────────────────────────────────────────────
export async function getJobsController(req, res) {
  try {
    if (!crmAccess(req.user, res)) return;
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

// ── GET /scraper/jobs/:id ─────────────────────────────────────────────────────
export async function getJobByIdController(req, res) {
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
    return res.json({ success: true, data: job });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── POST /scraper/jobs — create + run (with quota check) ─────────────────────
export async function createAndRunJobController(req, res) {
  try {
    if (!crmAccess(req.user, res)) return;

    // Enforce quota before starting
    const allowed = await enforceQuota(req.user, res);
    if (!allowed) return;

    const {
      name,
      platform,
      leadType = "B2B",
      targetUrl,
      searchQuery,
      maxPages,
      maxResults,
      extractFields,
    } = req.body;

    if (!searchQuery && !targetUrl) {
      return res.status(400).json({
        success: false,
        message: "Search query or target URL required",
      });
    }

    // For B2C, apply automatic individual-targeting suffix if not already set
    let finalQuery = searchQuery || "";
    if (
      leadType === "B2C" &&
      finalQuery &&
      !finalQuery.toLowerCase().includes("person") &&
      !finalQuery.toLowerCase().includes("individual")
    ) {
      // B2C queries are handled by the scrape engine using people-search mode
    }

    const effectiveMaxResults = Math.min(maxResults || 50, 200);

    // Estimate API calls this job will use (1 call per page for SERP-based platforms)
    const serpPlatforms = [
      "Google Search",
      "Google Maps",
      "LinkedIn",
      "Facebook",
      "Instagram",
    ];
    const estimatedCalls = serpPlatforms.includes(platform || "Google Search")
      ? Math.min(maxPages || 3, 10)
      : 1;

    const job = await ScrapeJobModel.create({
      name: name || finalQuery,
      platform: platform || "Google Search",
      leadType,
      targetUrl: targetUrl || "",
      searchQuery: finalQuery,
      maxPages: Math.min(maxPages || 3, 10),
      maxResults: effectiveMaxResults,
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

    // Run async — deduct quota on completion
    (async () => {
      try {
        const jobObj = { ...job.toObject(), leadType };
        const results = await runScrapeJob(jobObj);
        await ScrapeJobModel.findByIdAndUpdate(job._id, {
          status: "completed",
          rawResults: results,
          totalFound: results.length,
          progress: 100,
          completedAt: new Date(),
          apiCallsUsed: estimatedCalls,
        });
        // Deduct from quota
        await deductQuota(req.user._id, estimatedCalls);
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

// ── DELETE /scraper/jobs/:id/results/bulk ─────────────────────────────────────
export async function deleteBulkResultRowsController(req, res) {
  try {
    if (!crmAccess(req.user, res)) return;
    const { indices } = req.body;
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

// ── DELETE /scraper/jobs/:id/results/:index ───────────────────────────────────
export async function deleteResultRowController(req, res) {
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
    const idx = parseInt(req.params.index);
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

// ── POST /scraper/jobs/:id/import ─────────────────────────────────────────────
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
      contactName: r.contactName || r.fullName || "",
      email: Array.isArray(r.emails) ? r.emails[0] || "" : r.email || "",
      phone: Array.isArray(r.phones) ? r.phones[0] || "" : r.phone || "",
      website: r.website || "",
      address: r.address || "",
      linkedinUrl: r.linkedinUrl || "",
      facebookUrl: r.facebookUrl || "",
      source: job.platform,
      leadType: job.leadType || "B2B", // B2C or B2B carried through
      scrapeJobId: job._id,
      scrapeSource: r.scrapeSource || job.targetUrl,
      rawScrapedData: r,
      stage: "New",
      createdBy: req.user._id,
      createdByName: req.user.name,
      activities: [
        {
          type: "system",
          content: `Imported from "${job.name}" (${job.leadType || "B2B"}) scrape by ${req.user.name}`,
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

// ── DELETE /scraper/jobs/:id ───────────────────────────────────────────────────
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
