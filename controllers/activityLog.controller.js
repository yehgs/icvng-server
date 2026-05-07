// server/controllers/activityLog.controller.js
import ActivityLogModel from "../models/activity-log.model.js";

// GET /api/activity-logs — DIRECTOR and IT only
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

    if (userId) query.user = userId;
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

// GET /api/activity-logs/summary — for dashboard widget (DIRECTOR + IT)
export const getActivitySummary = async (req, res) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // last 24h

    const [totalToday, byAction, byUser, recentLogs] = await Promise.all([
      ActivityLogModel.countDocuments({ createdAt: { $gte: since } }),
      ActivityLogModel.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: "$action", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]),
      ActivityLogModel.aggregate([
        { $match: { createdAt: { $gte: since } } },
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
      ActivityLogModel.find()
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
