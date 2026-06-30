/**
 * controllers/dashboard.controller.js
 *
 * ONE dashboard endpoint. Data is automatically scoped by countryScope middleware.
 *
 *   scope = "GLOBAL"  (IT, DIRECTOR)  → sees all countries aggregated + breakdown
 *   scope = "COUNTRY" (any other admin with assignedCountry) → sees only their country
 *
 * No FOREIGN_ADMIN special-casing. The countryScope middleware handles it all.
 */

import OrderModel from "../models/order.model.js";
import UserModel from "../models/user.model.js";
import { buildCountryFilter } from "../middleware/countryScope.js";
import { getCountryByCode } from "../config/countries/index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getOrderStats(filter) {
  const agg = await OrderModel.aggregate([
    { $match: { ...filter, paymentStatus: "PAID" } },
    { $group: { _id: null, totalOrders: { $sum: 1 }, totalRevenue: { $sum: "$totalAmt" } } },
  ]);
  return agg[0] || { totalOrders: 0, totalRevenue: 0 };
}

async function getRevenueByMonth(filter) {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  return OrderModel.aggregate([
    { $match: { ...filter, paymentStatus: "PAID", createdAt: { $gte: sixMonthsAgo } } },
    {
      $group: {
        _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
        revenue: { $sum: "$totalAmt" },
        orders:  { $sum: 1 },
      },
    },
    { $sort: { "_id.year": 1, "_id.month": 1 } },
  ]);
}

async function getOrdersByStatus(filter) {
  return OrderModel.aggregate([
    { $match: filter },
    { $group: { _id: "$orderStatus", count: { $sum: 1 } } },
  ]);
}

async function getRecentOrders(filter, limit = 10) {
  return OrderModel.find({ ...filter, isParentOrder: true })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select("orderId totalAmt paymentStatus orderStatus createdAt countryCode userId")
    .lean();
}

// ── GET /api/admin/dashboard/summary ─────────────────────────────────────────
// One endpoint. Automatically scoped by countryScope middleware.

export async function getDashboardSummary(req, res) {
  try {
    const countryFilter = buildCountryFilter(req);
    const isGlobal      = !req.countryScope;

    const [orderStats, recentOrders, revenueByMonth, ordersByStatus] = await Promise.all([
      isGlobal
        // GLOBAL: per-country breakdown for the comparison table
        ? OrderModel.aggregate([
            { $match: { paymentStatus: "PAID" } },
            { $group: { _id: "$countryCode", totalOrders: { $sum: 1 }, totalRevenue: { $sum: "$totalAmt" } } },
          ])
        // COUNTRY: single aggregate
        : getOrderStats(countryFilter),
      getRecentOrders(countryFilter),
      getRevenueByMonth(countryFilter),
      getOrdersByStatus(countryFilter),
    ]);

    // Customer count
    const customerCount = isGlobal
      ? await UserModel.countDocuments({ role: "USER" })
      : (await OrderModel.distinct("userId", countryFilter)).filter(Boolean).length;

    // Totals
    const totals = isGlobal
      ? (orderStats).reduce(
          (acc, row) => { acc.totalOrders += row.totalOrders ?? 0; acc.totalRevenue += row.totalRevenue ?? 0; return acc; },
          { totalOrders: 0, totalRevenue: 0 }
        )
      : orderStats;

    const countryBreakdown = isGlobal
      ? (orderStats).map(row => {
          const meta = getCountryByCode(row._id);
          return { ...row, name: meta?.name, flagEmoji: meta?.flagEmoji, currency: meta?.currency };
        })
      : null;

    const activeCountry = req.countryScope ? getCountryByCode(req.countryScope) : null;

    return res.json({
      success: true,
      error: false,
      data: {
        scope:           req.countryScope || "GLOBAL",
        country:         activeCountry ? { name: activeCountry.name, flagEmoji: activeCountry.flagEmoji, currency: activeCountry.currency } : null,
        totalOrders:     totals.totalOrders,
        totalRevenue:    totals.totalRevenue,
        totalCustomers:  customerCount,
        recentOrders,
        revenueByMonth,
        ordersByStatus,
        ...(countryBreakdown ? { countryBreakdown } : {}),
      },
    });
  } catch (err) {
    console.error("getDashboardSummary error:", err);
    return res.status(500).json({ message: err.message || "Server error", error: true, success: false });
  }
}

// ── GET /api/admin/dashboard/countries ───────────────────────────────────────
// GLOBAL admins only — side-by-side country comparison

export async function getCountryComparison(req, res) {
  try {
    if (req.countryScope) {
      return res.status(403).json({ message: "Global admin access required", error: true, success: false });
    }

    const breakdown = await OrderModel.aggregate([
      { $match: { paymentStatus: "PAID" } },
      {
        $group: {
          _id: "$countryCode",
          totalOrders:   { $sum: 1 },
          totalRevenue:  { $sum: "$totalAmt" },
          avgOrderValue: { $avg: "$totalAmt" },
        },
      },
      { $sort: { totalRevenue: -1 } },
    ]);

    const enriched = breakdown.map(row => {
      const country = getCountryByCode(row._id);
      return { ...row, countryName: country?.name || row._id, currency: country?.currency || null, flagEmoji: country?.flagEmoji || "" };
    });

    return res.json({ success: true, error: false, data: enriched });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Server error", error: true, success: false });
  }
}
