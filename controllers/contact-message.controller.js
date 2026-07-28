/**
 * controllers/contact-message.controller.js
 *
 * Item #1 — admin-facing read/triage of ContactMessage submissions.
 *
 * Country scoping happens two ways here, belt-and-suspenders:
 *   1. Explicitly via buildCountryFilter(req) in the list query.
 *   2. Automatically via countryScopedPlugin on the model (see
 *      contact-message.model.js), which injects the same filter into every
 *      Mongoose query once req.countryScope is in context — so even if a
 *      future edit to this controller forgets step 1, a COUNTRY-scoped
 *      admin still can't read another country's messages.
 *
 * GLOBAL admins (IT, DIRECTOR) get req.countryScope === null → no filter,
 * see every country.
 */

import ContactMessageModel from "../models/contact-message.model.js";
import { buildCountryFilter } from "../middleware/countryScope.js";

// GET /api/admin/contact-messages
export async function listContactMessagesController(req, res) {
  try {
    const { formType, status, page = 1, limit = 25 } = req.query;

    const filter = { ...buildCountryFilter(req) };
    if (formType && ["contact", "partner"].includes(formType)) filter.formType = formType;
    if (status) filter.status = status;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));

    const [items, total] = await Promise.all([
      ContactMessageModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      ContactMessageModel.countDocuments(filter),
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

// PATCH /api/admin/contact-messages/:id/status
export async function updateContactMessageStatusController(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!["NEW", "IN_PROGRESS", "RESOLVED", "ARCHIVED"].includes(status)) {
      return res.status(400).json({ success: false, error: true, message: "Invalid status" });
    }

    // countryScopedPlugin's findOneAndUpdate hook forces the countryCode
    // filter for COUNTRY-scoped admins — this call physically cannot touch
    // another country's message.
    const updated = await ContactMessageModel.findOneAndUpdate(
      { _id: id, ...buildCountryFilter(req) },
      { $set: { status } },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ success: false, error: true, message: "Message not found" });
    }

    return res.status(200).json({ success: true, error: false, data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, error: true, message: error.message });
  }
}
