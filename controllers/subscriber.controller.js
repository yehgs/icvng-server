/**
 * controllers/subscriber.controller.js
 *
 * Item #1 — real backing for the footer newsletter form (previously
 * `Footer.jsx handleSubmit` just showed a toast and threw the email away).
 *
 * subscribeController is PUBLIC (no auth) — anyone visiting the storefront
 * can submit their email. listSubscribersController is admin-only and
 * country-scoped the same way as contact messages.
 */

import SubscriberModel from "../models/subscriber.model.js";
import { buildCountryFilter } from "../middleware/countryScope.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/subscribe  (public)
export async function subscribeController(req, res) {
  try {
    const email = (req.body?.email || "").trim().toLowerCase();

    if (!email || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({
        success: false,
        error: true,
        message: "Please provide a valid email address",
      });
    }

    // Upsert by (email, countryCode): resubscribing after a prior
    // unsubscribe just flips isActive back on instead of erroring on the
    // unique index or creating a duplicate row.
    const existing = await SubscriberModel.findOneAndUpdate(
      { email, countryCode: req.countryCode },
      {
        $set: { isActive: true, unsubscribedAt: null, source: req.body?.source || "footer" },
        $setOnInsert: { email, countryCode: req.countryCode },
      },
      { upsert: true, new: true }
    );

    return res.status(200).json({
      success: true,
      error: false,
      message: "Subscribed successfully",
      data: existing,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: true, message: error.message });
  }
}

// GET /api/admin/subscribers  (admin, country-scoped)
export async function listSubscribersController(req, res) {
  try {
    const { active, page = 1, limit = 50 } = req.query;

    const filter = { ...buildCountryFilter(req) };
    if (active === "true") filter.isActive = true;
    if (active === "false") filter.isActive = false;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

    const [items, total] = await Promise.all([
      SubscriberModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      SubscriberModel.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      error: false,
      data: items,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: true, message: error.message });
  }
}
