//server
// controllers/scraper-quota.controller.js
// Manager, IT, Director can view and set per-user scraper API quotas.
// Every scrape job checks and deducts from the user's monthly allowance.

import UserModel from "../models/user.model.js";
import ScrapeJobModel from "../models/scrape-job.model.js";

// Roles that can manage quotas (set limits for others)
const QUOTA_ADMIN_ROLES = ["IT", "DIRECTOR", "MANAGER"];
// Roles with unlimited access (quota system doesn't apply)
const UNLIMITED_ROLES = ["IT", "DIRECTOR", "MANAGER"];

// ── Helper: reset quota if it's a new calendar month ────────────────────────
async function maybeResetMonthlyQuota(user) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastReset = user.scrapeQuota?.quotaResetDate
    ? new Date(user.scrapeQuota.quotaResetDate)
    : null;

  if (!lastReset || lastReset < monthStart) {
    await UserModel.findByIdAndUpdate(user._id, {
      "scrapeQuota.usedThisMonth": 0,
      "scrapeQuota.quotaResetDate": monthStart,
    });
    return {
      ...user.scrapeQuota,
      usedThisMonth: 0,
      quotaResetDate: monthStart,
    };
  }
  return user.scrapeQuota;
}

// ── Check if user can run a job (called before job creation) ─────────────────
export async function checkQuotaController(req, res) {
  try {
    const user = await UserModel.findById(req.user._id).lean();

    // Unlimited roles — always allowed
    if (UNLIMITED_ROLES.includes(user.subRole)) {
      return res.json({ success: true, allowed: true, unlimited: true });
    }

    const quota = await maybeResetMonthlyQuota(user);
    const limit = quota?.monthlyLimit || 0;

    // monthlyLimit === 0 means not set — block unless unlimited role
    if (limit === 0) {
      return res.json({
        success: true,
        allowed: false,
        reason: "No scraper quota assigned. Please contact your Manager or IT.",
        used: 0,
        limit: 0,
        remaining: 0,
      });
    }

    const used = quota?.usedThisMonth || 0;
    const remaining = Math.max(0, limit - used);

    return res.json({
      success: true,
      allowed: remaining > 0,
      reason:
        remaining <= 0
          ? `Monthly quota of ${limit} API calls exhausted. Resets on the 1st.`
          : null,
      used,
      limit,
      remaining,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── Deduct from quota after a job completes (internal helper) ────────────────
export async function deductQuota(userId, apiCallsUsed) {
  const user = await UserModel.findById(userId).lean();
  if (!user || UNLIMITED_ROLES.includes(user.subRole)) return; // unlimited — skip

  await maybeResetMonthlyQuota(user);
  await UserModel.findByIdAndUpdate(userId, {
    $inc: { "scrapeQuota.usedThisMonth": apiCallsUsed || 1 },
  });
}

// ── GET /scraper/quota/me — user's own quota ─────────────────────────────────
export async function getMyQuotaController(req, res) {
  try {
    const user = await UserModel.findById(req.user._id)
      .select("name subRole scrapeQuota")
      .lean();

    if (UNLIMITED_ROLES.includes(user.subRole)) {
      return res.json({
        success: true,
        data: { unlimited: true, used: null, limit: null, remaining: null },
      });
    }

    const quota = await maybeResetMonthlyQuota(user);
    const limit = quota?.monthlyLimit || 0;
    const used = quota?.usedThisMonth || 0;
    const remaining = limit > 0 ? Math.max(0, limit - used) : 0;

    return res.json({
      success: true,
      data: {
        unlimited: false,
        limit,
        used,
        remaining,
        resetDate: quota?.quotaResetDate,
        setBy: quota?.setByName || null,
        percentUsed: limit > 0 ? Math.round((used / limit) * 100) : 0,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── GET /scraper/quota/all — Manager/IT/Director: see all users' quotas ──────
export async function getAllQuotasController(req, res) {
  try {
    if (!QUOTA_ADMIN_ROLES.includes(req.user.subRole)) {
      return res
        .status(403)
        .json({ success: false, message: "Manager, IT or Director only" });
    }

    const users = await UserModel.find({ role: "ADMIN", status: "Active" })
      .select("name email subRole scrapeQuota")
      .lean();

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const results = await Promise.all(
      users.map(async (u) => {
        const isUnlimited = UNLIMITED_ROLES.includes(u.subRole);
        if (isUnlimited) {
          return {
            _id: u._id,
            name: u.name,
            email: u.email,
            subRole: u.subRole,
            unlimited: true,
            limit: null,
            used: null,
            remaining: null,
          };
        }
        // auto-reset if needed
        const lastReset = u.scrapeQuota?.quotaResetDate
          ? new Date(u.scrapeQuota.quotaResetDate)
          : null;
        let used = u.scrapeQuota?.usedThisMonth || 0;
        if (!lastReset || lastReset < monthStart) used = 0;

        const limit = u.scrapeQuota?.monthlyLimit || 0;
        const remaining = limit > 0 ? Math.max(0, limit - used) : 0;

        return {
          _id: u._id,
          name: u.name,
          email: u.email,
          subRole: u.subRole,
          unlimited: false,
          limit,
          used,
          remaining,
          percentUsed: limit > 0 ? Math.round((used / limit) * 100) : 0,
          setBy: u.scrapeQuota?.setByName || null,
          resetDate: u.scrapeQuota?.quotaResetDate,
        };
      }),
    );

    return res.json({ success: true, data: results });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── PUT /scraper/quota/:userId — Manager/IT/Director: set a user's quota ─────
export async function setUserQuotaController(req, res) {
  try {
    if (!QUOTA_ADMIN_ROLES.includes(req.user.subRole)) {
      return res
        .status(403)
        .json({ success: false, message: "Manager, IT or Director only" });
    }

    const { monthlyLimit } = req.body;
    if (monthlyLimit == null || isNaN(monthlyLimit) || monthlyLimit < 0) {
      return res
        .status(400)
        .json({
          success: false,
          message: "monthlyLimit must be a non-negative number",
        });
    }

    const target = await UserModel.findById(req.params.userId);
    if (!target)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    if (UNLIMITED_ROLES.includes(target.subRole)) {
      return res
        .status(400)
        .json({
          success: false,
          message: `${target.subRole} already has unlimited access`,
        });
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    await UserModel.findByIdAndUpdate(req.params.userId, {
      "scrapeQuota.monthlyLimit": parseInt(monthlyLimit),
      "scrapeQuota.setBy": req.user._id,
      "scrapeQuota.setByName": req.user.name,
      "scrapeQuota.updatedAt": now,
      "scrapeQuota.quotaResetDate": monthStart, // reset usage too when limit is set
      "scrapeQuota.usedThisMonth": 0,
    });

    return res.json({
      success: true,
      message: `Quota for ${target.name} set to ${monthlyLimit} API calls/month`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── POST /scraper/quota/:userId/reset — force-reset a user's usage to 0 ──────
export async function resetUserQuotaController(req, res) {
  try {
    if (!QUOTA_ADMIN_ROLES.includes(req.user.subRole)) {
      return res
        .status(403)
        .json({ success: false, message: "Manager, IT or Director only" });
    }

    const target = await UserModel.findById(req.params.userId);
    if (!target)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    await UserModel.findByIdAndUpdate(req.params.userId, {
      "scrapeQuota.usedThisMonth": 0,
      "scrapeQuota.quotaResetDate": monthStart,
    });

    return res.json({
      success: true,
      message: `Usage reset for ${target.name}`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}
