// server/controllers/activityLog.controller.js
import ActivityLogModel from "../models/activity-log.model.js";
import UserModel from "../models/user.model.js";

// Subroles that are never visible to a MANAGER, HQ or foreign — their own
// activity stays visible only to themselves (IT, DIRECTOR both unrestricted).
const EXCLUDED_FOR_MANAGER = ["IT", "DIRECTOR"];

/**
 * Item #4 (+ HQ/Foreign Manager split) — MANAGER can view the Activity Log,
 * scoped by their own `scope`:
 *
 *   - IT / DIRECTOR                → unrestricted, see every country + role.
 *   - MANAGER, scope = "GLOBAL"    → "HQ Manager": sees activity from all
 *     other GLOBAL (HQ) staff, EXCLUDING IT and DIRECTOR.
 *   - MANAGER, scope = "COUNTRY"   → "Foreign Manager": sees activity from
 *     COUNTRY-scoped ("foreign") staff in their own assignedCountry only,
 *     EXCLUDING IT and DIRECTOR (who can never be COUNTRY-scoped anyway,
 *     but the filter is kept explicit for safety).
 *
 * ActivityLog rows have no countryCode/scope of their own (they're written
 * from dozens of call sites across the codebase via logActivity(), and
 * retrofitting every one of them to stamp scope reliably would be a much
 * larger, riskier change than this needs). Instead, scoping is resolved by
 * joining through the acting user: "which users are in my visibility
 * bucket?" then "show me only their log rows."
 *
 * Returns:
 *   null        → unrestricted (IT/DIRECTOR), no filter applied.
 *   ObjectId[]  → restrict activity log rows to these users' rows only.
 *                 (Empty array is a valid result — it means "see nothing".)
 */
async function getScopedUserIds(req) {
  const user = req.user;
  if (!user) return [];

  // IT / DIRECTOR: unrestricted, no scoping.
  if (["IT", "DIRECTOR"].includes(user.subRole)) return null;

  if (user.subRole === "MANAGER" && user.scope === "GLOBAL") {
    // HQ Manager → all HQ (GLOBAL-scope) staff except IT/DIRECTOR.
    const ids = await UserModel.find({
      scope: "GLOBAL",
      subRole: { $nin: EXCLUDED_FOR_MANAGER },
    }).select("_id");
    return ids.map((u) => u._id);
  }

  if (user.subRole === "MANAGER" && user.scope === "COUNTRY" && user.assignedCountry) {
    // Foreign Manager → COUNTRY-scoped staff in their own country only,
    // except IT/DIRECTOR.
    const ids = await UserModel.find({
      scope: "COUNTRY",
      assignedCountry: user.assignedCountry,
      subRole: { $nin: EXCLUDED_FOR_MANAGER },
    }).select("_id");
    return ids.map((u) => u._id);
  }

  // Any other subRole reaching here shouldn't have gotten past the route's
  // allowedRoles guard, but default to "see nothing" rather than leaking data.
  return [];
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

    // HQ Manager / Foreign Manager only see activity from users in their own
    // visibility bucket (see getScopedUserIds doc comment above). GLOBAL
    // admins (IT/DIRECTOR) are unrestricted (null = no filter).
    // IMPORTANT: an explicit ?userId= filter must still respect this scope
    // — otherwise a scoped MANAGER could just pass another user's id and
    // read their activity directly.
    const scopedUserIds = await getScopedUserIds(req);
    if (scopedUserIds !== null) {
      const allowedIds = scopedUserIds.map((id) => id.toString());
      if (userId) {
        // Requested a specific user — only honor it if that user is in scope;
        // otherwise force an empty result rather than leaking out-of-scope data.
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

    // Same HQ/Foreign Manager scoping as getActivityLogs.
    const scopedUserIds = await getScopedUserIds(req);
    const scopeMatch = scopedUserIds !== null ? { user: { $in: scopedUserIds } } : {};

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
