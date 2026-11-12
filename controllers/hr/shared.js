// server/controllers/hr/shared.js — response helpers, scope loading and audit used by every HR controller.
import mongoose from "mongoose";
import { resolveFeatureScope, featureCountryFilter } from "../../utils/featureScope.js";
import { logActivity } from "../../utils/activityLogger.js";
import HrStaff from "../../models/hr/hr-staff.model.js";

export const ok = (res, data, extra = {}) => res.json({ success: true, error: false, data, ...extra });
export const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, error: true, message, ...extra });
export const isId = (v) => mongoose.Types.ObjectId.isValid(v);
export const scopeOr403 = (req, res) => {
  const scope = resolveFeatureScope(req.user);
  if (scope.denied) { fail(res, 403, "Admin access required"); return null; }
  return scope;
};
export const countryWhere = (req, res) => {
  const scope = scopeOr403(req, res);
  return scope ? { scope, where: featureCountryFilter(scope, req.query.countryCode) } : null;
};
export const audit = (req, action, description, doc, name = "") =>
  logActivity({ userId: req.user._id, action, description, resourceType: ["HrPayroll"].includes(doc?.constructor?.modelName) ? "Payroll" : "Staff", resourceId: doc?._id, resourceName: name || doc?.fullName || "", req });
export const paging = (req, dflt = 25) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || dflt));
  return { page, limit, skip: (page - 1) * limit };
};
/** A staff doc the caller may touch, or null (→ 404, never reveals other countries). */
export async function loadStaff(req, res, id, select = "") {
  if (!isId(id)) { fail(res, 404, "Staff not found"); return null; }
  const scope = scopeOr403(req, res);
  if (!scope) return null;
  const q = HrStaff.findOne({ _id: id, ...featureCountryFilter(scope) });
  const doc = await (select ? q.select(select) : q);
  if (!doc) { fail(res, 404, "Staff not found"); return null; }
  return { doc, scope };
}
/** The caller's own HR record (self-service). */
export const myStaff = (req) => HrStaff.findOne({ userId: req.user._id });
export const duplicate = (e) => e?.code === 11000 || /duplicate key|E11000/i.test(e?.message || "");
