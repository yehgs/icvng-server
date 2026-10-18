/**
 * controllers/booking-admin.controller.js
 *
 * Admin side of the storefront Barista Training / Coffee Machine Rental
 * requests. Nigeria-only (see route/booking-admin.route.js → nigeriaOnly) and
 * country-filtered a second time via buildCountryFilter + countryScopedPlugin.
 */
import BookingRequestModel, { BOOKING_SERVICES, BOOKING_STATUSES } from "../models/booking-request.model.js";
import { buildCountryFilter } from "../middleware/countryScope.js";
import { ROLE_DEFINITIONS } from "../config/roles.js";

const roleLabel = (subRole) => ROLE_DEFINITIONS[subRole]?.name || subRole || "";

const err = (res, status, message) => res.status(status).json({ success: false, error: true, message });

// GET /api/admin/booking-requests?service=&status=&q=&page=&limit=
export async function listBookingRequestsController(req, res) {
  try {
    const { service, status, q, page = 1, limit = 25 } = req.query;
    const filter = { ...buildCountryFilter(req) };
    if (service && BOOKING_SERVICES.includes(service)) filter.service = service;
    if (status && BOOKING_STATUSES.includes(status)) filter.status = status;
    if (q) {
      const rx = new RegExp(String(q).trim().slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ name: rx }, { email: rx }, { phone: rx }];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));

    const [items, total, newCount] = await Promise.all([
      BookingRequestModel.find(filter).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum),
      BookingRequestModel.countDocuments(filter),
      BookingRequestModel.countDocuments({ ...buildCountryFilter(req), status: "NEW" }),
    ]);

    return res.json({
      success: true,
      error: false,
      data: items,
      newCount,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (e) {
    return err(res, 500, e.message);
  }
}

// PATCH /api/admin/booking-requests/:id   body: { status?, note? }
export async function updateBookingRequestController(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    const note = String(req.body?.note || "").trim().slice(0, 2000);

    if (status !== undefined && !BOOKING_STATUSES.includes(status)) return err(res, 400, "Invalid status");
    if (status === undefined && !note) return err(res, 400, "Nothing to update");

    const doc = await BookingRequestModel.findOne({ _id: id, ...buildCountryFilter(req) });
    if (!doc) return err(res, 404, "Request not found");

    const who = {
      byUserId: req.user._id,
      byName: req.user.name || req.user.email || "",
      byRole: roleLabel(req.user.subRole),
    };

    if (status !== undefined) doc.status = status;
    if (note) doc.notes.push({ text: note, ...who, at: new Date() });

    // First time someone moves it past NEW (or adds a note) = first response
    if (!doc.respondedAt && (note || (status && status !== "NEW"))) {
      doc.respondedAt = new Date();
      doc.respondedByName = who.byName;
      doc.respondedByRole = who.byRole;
    }

    await doc.save();
    return res.json({ success: true, error: false, data: doc });
  } catch (e) {
    return err(res, 500, e.message);
  }
}
