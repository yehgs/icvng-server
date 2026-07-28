// server/controllers/activityLog.controller.js
import ActivityLogModel from "../models/activity-log.model.js";
import UserModel from "../models/user.model.js";

/**
 * Item #4 — MANAGER can now view the Activity Log, but only entries
 * performed by users belonging to their own assigned country. GLOBAL
 * admins (IT, DIRECTOR) are unrestricted.
 *
 * ActivityLog rows have no countryCode of their own (they're written from
 * dozens of call sites across the codebase via logActivity(), and
 * retrofitting every one of them to stamp a country reliably would be a
 * much larger, riskier change than this needs). Instead, scoping is
 * resolved by joining through the acting user: "which users belong to my
 * country?" then "show me only their log rows."
 *
 * Returns:
 *   null        → GLOBAL admin, no filter, sees every country's activity.
 *   ObjectId[]  → COUNTRY-scoped admin, restrict to these users' rows only.
 */
async function getCountryScopedUserIds(req) {
  const user = req.user;
  if (!user || user.scope !== "COUNTRY" || !user.assignedCountry) return null;
  const ids = await UserModel.find({ assignedCountry: user.assignedCountry }).select("_id");
  return ids.map((u) => u._id);
}

// GET /api/activity-logs — IT, DIRECTOR (global), and MANAGER (country-scoped)
export const getActivityLogs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      userId,
      action,
      resourceType,
      status,
      dateFrom,
      dateTo,
      search,
    } = req.query;

    const query = {};

    // Item #4: country-scoped MANAGER only sees activity from users in
    // their own country. GLOBAL admins (IT/DIRECTOR) are unrestricted.
    // IMPORTANT: an explicit ?userId= filter must still respect this scope
    // — otherwise a country-scoped MANAGER could just pass another
    // country's userId and read their activity directly.
    const scopedUserIds = await getCountryScopedUserIds(req);
    if (scopedUserIds) {
      const allowedIds = scopedUserIds.map((id) => id.toString());
      if (userId) {
        // Requested a specific user — only honor it if that user is in scope;
        // otherwise force an empty result rather than leaking cross-country data.
        query.user = allowedIds.includes(String(userId)) ? userId : "000000000000000000000000";
      } else {
        query.user = { $in: scopedUserIds };
      }
    } else if (userId) {
      query.user = userId;
    }
    if (action) query.action = action;
    if (resourceType) query.resourceType = resourceType;
    if (status) query.status = status;

    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo)
        query.createdAt.$lte = new Date(
          new Date(dateTo).setHours(23, 59, 59, 999),
        );
    }

    if (search) {
      query.$or = [
        { description: { $regex: search, $options: "i" } },
        { resourceName: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [logs, totalCount] = await Promise.all([
      ActivityLogModel.find(query)
        .populate("user", "name email subRole mobile")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      ActivityLogModel.countDocuments(query),
    ]);

    return res.json({
      success: true,
      error: false,
      data: logs,
      totalCount,
      totalPages: Math.ceil(totalCount / parseInt(limit)),
      currentPage: parseInt(page),
    });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, error: true, message: err.message });
  }
};

// GET /api/activity-logs/summary — for dashboard widget (IT/DIRECTOR global, MANAGER country-scoped)
export const getActivitySummary = async (req, res) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // last 24h

    // Item #4: same country scoping as getActivityLogs.
    const scopedUserIds = await getCountryScopedUserIds(req);
    const scopeMatch = scopedUserIds ? { user: { $in: scopedUserIds } } : {};

    const [totalToday, byAction, byUser, recentLogs] = await Promise.all([
      ActivityLogModel.countDocuments({ createdAt: { $gte: since }, ...scopeMatch }),
      ActivityLogModel.aggregate([
        { $match: { createdAt: { $gte: since }, ...scopeMatch } },
        { $group: { _id: "$action", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]),
      ActivityLogModel.aggregate([
        { $match: { createdAt: { $gte: since }, ...scopeMatch } },
        { $group: { _id: "$user", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "userInfo",
          },
        },
        { $unwind: { path: "$userInfo", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            count: 1,
            name: "$userInfo.name",
            email: "$userInfo.email",
            subRole: "$userInfo.subRole",
          },
        },
      ]),
      ActivityLogModel.find(scopeMatch)
        .populate("user", "name email subRole")
        .sort({ createdAt: -1 })
        .limit(10),
    ]);

    return res.json({
      success: true,
      error: false,
      data: { totalToday, byAction, byUser, recentLogs },
    });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, error: true, message: err.message });
  }
};

// GET /api/activity-logs/actions — return enum list for filter dropdown
export const getActionTypes = async (req, res) => {
  try {
    const actions = ActivityLogModel.schema.path("action").enumValues;
    return res.json({ success: true, data: actions });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, error: true, message: err.message });
  }
};
