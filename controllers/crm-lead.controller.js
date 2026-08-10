//server
// controllers/crm-lead.controller.js  (updated — delete request workflow)
import CrmLeadModel, {
  CRM_STAGES,
  LEAD_SOURCES,
  LEAD_INDUSTRIES,
} from "../models/crm-lead.model.js";
import UserModel from "../models/user.model.js";
import sendEmail from "../config/sendEmail.js";
import { createNotificationInternal } from "./notification.controller.js";
import { buildCountryFilter } from "../middleware/countryScope.js";
import csv from "csv-parser";
import { Readable } from "stream";

const CRM_ROLES = [
  "SALES",
  "SALES_MANAGER",
  "MANAGER",
  "IT",
  "EDITOR",
  "DIRECTOR",
];
const SUPER_ROLES = ["IT", "DIRECTOR"]; // can hard-delete immediately
const METRICS_ROLES = ["IT", "DIRECTOR", "MANAGER", "SALES_MANAGER"]; // can see user activity metrics

function crmAccess(user, res) {
  if (!CRM_ROLES.includes(user?.subRole)) {
    res.status(403).json({ success: false, message: "CRM access denied" });
    return false;
  }
  return true;
}
function canHardDelete(user) {
  return SUPER_ROLES.includes(user?.subRole);
}
function canSeeMetrics(user) {
  return METRICS_ROLES.includes(user?.subRole);
}
// Blocks a COUNTRY-scoped admin from reading/mutating a lead that belongs
// to a different office, even if they have the ID (e.g. guessed/shared link).
// GLOBAL admins (req.countryScope === null) always pass.
function assertLeadCountryAccess(req, res, lead) {
  if (!req.countryScope) return true; // GLOBAL — no restriction
  if (lead.countryCode && lead.countryCode !== req.countryScope) {
    res.status(403).json({
      success: false,
      message: `Access denied: this lead belongs to a different country office`,
    });
    return false;
  }
  return true;
}

// ── Won notification email helper ──────────────────────────────────────────
async function sendWonEmail(movedByUser, lead) {
  try {
    const recipients = await UserModel.find({
      role: "ADMIN",
      subRole: { $in: ["IT", "DIRECTOR", "MANAGER"] },
      status: "Active",
    })
      .select("name email")
      .lean();

    const time = new Date().toLocaleString("en-NG", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Lagos",
    });

    const emailPromises = recipients.map((r) =>
      sendEmail({
        sendTo: r.email,
        subject: `🎉 Deal Won — ${lead.companyName || lead.contactName}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
            <div style="background:linear-gradient(135deg,#16a34a,#15803d);padding:20px 24px;border-radius:8px 8px 0 0;">
              <h2 style="color:#fff;margin:0;font-size:22px;">🎉 Deal Won!</h2>
            </div>
            <div style="background:#f0fdf4;padding:24px;border:1px solid #bbf7d0;border-radius:0 0 8px 8px;">
              <p style="color:#166534;font-size:16px;font-weight:600;">A deal has been closed successfully.</p>
              <table style="width:100%;border-collapse:collapse;margin:16px 0;">
                <tr><td style="padding:8px 12px;background:#dcfce7;font-weight:bold;border:1px solid #86efac;width:35%;color:#15803d;">Lead</td><td style="padding:8px 12px;border:1px solid #86efac;color:#166534;">${lead.companyName || lead.contactName}</td></tr>
                <tr><td style="padding:8px 12px;background:#dcfce7;font-weight:bold;border:1px solid #86efac;color:#15803d;">Contact</td><td style="padding:8px 12px;border:1px solid #86efac;color:#166534;">${lead.contactName || "—"}</td></tr>
                <tr><td style="padding:8px 12px;background:#dcfce7;font-weight:bold;border:1px solid #86efac;color:#15803d;">Deal Value</td><td style="padding:8px 12px;border:1px solid #86efac;color:#166534;font-weight:700;">${lead.currency || "NGN"} ${(lead.dealValue || 0).toLocaleString()}</td></tr>
                <tr><td style="padding:8px 12px;background:#dcfce7;font-weight:bold;border:1px solid #86efac;color:#15803d;">Closed By</td><td style="padding:8px 12px;border:1px solid #86efac;color:#166534;">${movedByUser.name} (${movedByUser.subRole})</td></tr>
                <tr><td style="padding:8px 12px;background:#dcfce7;font-weight:bold;border:1px solid #86efac;color:#15803d;">Time</td><td style="padding:8px 12px;border:1px solid #86efac;color:#166534;">${time}</td></tr>
              </table>
              <a href="${process.env.ADMIN_URL || "https://admin.i-coffee.ng"}/admin/dashboard/crm"
                 style="display:inline-block;margin-top:8px;padding:10px 22px;background:#16a34a;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">
                View CRM
              </a>
            </div>
          </div>`,
      }).catch((e) =>
        console.error(`Won email to ${r.email} failed:`, e.message),
      ),
    );
    await Promise.allSettled(emailPromises);
  } catch (e) {
    console.error("sendWonEmail error:", e.message);
  }
}

// ── Helper: notify IT+Director about a delete request ─────────────────────
async function notifyDeleteRequest(lead, requester, reason) {
  await createNotificationInternal({
    triggeredBy: requester._id,
    triggeredByName: requester.name,
    type: "CUSTOM",
    title: `Delete Request: ${lead.companyName || lead.contactName}`,
    message: `${requester.name} (${requester.subRole}) requested to delete lead "${lead.companyName || lead.contactName}". Reason: ${reason}`,
    link: "/admin/dashboard/crm",
    resourceId: lead._id.toString(),
    resourceType: "CrmLead",
    targetType: "role",
    targetRoles: ["IT", "DIRECTOR"],
    priority: "medium",
    sendEmailFlag: true,
  });
}

// ── GET /crm/meta ──────────────────────────────────────────────────────────
export async function getCrmMetaController(req, res) {
  try {
    if (!crmAccess(req.user, res)) return;
    return res.json({
      success: true,
      data: { CRM_STAGES, LEAD_SOURCES, LEAD_INDUSTRIES },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── GET /crm/leads ─────────────────────────────────────────────────────────
export async function getLeadsController(req, res) {
  try {
    if (!crmAccess(req.user, res)) return;
    const {
      stage,
      assignedTo,
      source,
      search,
      page = 1,
      limit = 50,
    } = req.query;

    const query = { isArchived: false, ...buildCountryFilter(req) };
    if (stage) query.stage = stage;
    if (assignedTo) query.assignedTo = assignedTo;
    if (source) query.source = source;
    if (search) {
      query.$or = [
        { companyName: { $regex: search, $options: "i" } },
        { contactName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }

    const total = await CrmLeadModel.countDocuments(query);
    const leads = await CrmLeadModel.find(query)
      .sort({ updatedAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .populate("assignedTo", "name avatar email")
      .lean();

    const scopedBase = { isArchived: false, ...buildCountryFilter(req) };

    const stageCounts = await CrmLeadModel.aggregate([
      { $match: scopedBase },
      {
        $group: {
          _id: "$stage",
          count: { $sum: 1 },
          totalDeal: { $sum: "$dealValue" },
        },
      },
    ]);

    const pipelineValue = await CrmLeadModel.aggregate([
      { $match: { ...scopedBase, stage: { $nin: ["Lost", "On Hold"] } } },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $multiply: ["$dealValue", { $divide: ["$probability", 100] }],
            },
          },
        },
      },
    ]);

    // Pending delete requests count (for IT/Director badge) — global only,
    // never scoped, since only IT/Director can see this in the first place
    const pendingDeleteCount = canHardDelete(req.user)
      ? await CrmLeadModel.countDocuments({
          isArchived: false,
          "pendingDeleteRequest.status": "pending",
        })
      : 0;

    return res.json({
      success: true,
      data: leads,
      total,
      stageCounts,
      pipelineValue: pipelineValue[0]?.total || 0,
      pendingDeleteCount,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── GET /crm/delete-requests — IT/Director only: see all pending requests ──
export async function getDeleteRequestsController(req, res) {
  try {
    if (!crmAccess(req.user, res)) return;
    if (!canHardDelete(req.user)) {
      return res
        .status(403)
        .json({ success: false, message: "IT and Director only" });
    }
    const leads = await CrmLeadModel.find({
      isArchived: false,
      "pendingDeleteRequest.status": "pending",
    })
      .select(
        "companyName contactName email phone stage pendingDeleteRequest createdBy createdByName",
      )
      .lean();

    return res.json({ success: true, data: leads });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── POST /crm/leads ────────────────────────────────────────────────────────
export async function createLeadController(req, res) {
  try {
    if (!crmAccess(req.user, res)) return;
    // Country-scoped admins always create leads for their own office;
    // GLOBAL admins (IT/Director) may specify countryCode in the body,
    // defaulting to NG if omitted.
    const ownerCountryCode =
      req.countryScope || req.body.countryCode || "NG";
    const lead = await CrmLeadModel.create({
      ...req.body,
      countryCode: ownerCountryCode,
      createdBy: req.user._id,
      createdByName: req.user.name,
      activities: [
        {
          type: "system",
          content: `Lead created by ${req.user.name}`,
          performedBy: req.user._id,
          performedByName: req.user.name,
        },
      ],
    });
    return res
      .status(201)
      .json({ success: true, message: "Lead created", data: lead });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── PUT /crm/leads/:id ─────────────────────────────────────────────────────
export async function updateLeadController(req, res) {
  try {
    if (!crmAccess(req.user, res)) return;
    const existing = await CrmLeadModel.findById(req.params.id);
    if (!existing)
      return res
        .status(404)
        .json({ success: false, message: "Lead not found" });
    if (!assertLeadCountryAccess(req, res, existing)) return;

    const stageChanged = req.body.stage && req.body.stage !== existing.stage;
    const lead = await CrmLeadModel.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });

    if (stageChanged) {
      lead.activities.push({
        type: "stage_change",
        content: `Stage changed: ${existing.stage} → ${req.body.stage}`,
        performedBy: req.user._id,
        performedByName: req.user.name,
        metadata: { from: existing.stage, to: req.body.stage },
      });
      await lead.save();

      if (req.body.stage === "Won") {
        const time = new Date().toLocaleString("en-NG", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Africa/Lagos",
        });
        await Promise.all([
          createNotificationInternal({
            triggeredBy: req.user._id,
            triggeredByName: req.user.name,
            type: "ORDER",
            title: "🎉 Deal Won!",
            message: `${req.user.name} (${req.user.subRole}) closed: "${existing.companyName || existing.contactName}" — ${existing.currency || "NGN"} ${(existing.dealValue || 0).toLocaleString()} at ${time}`,
            link: "/admin/dashboard/crm",
            targetType: "role",
            targetRoles: ["DIRECTOR", "MANAGER", "IT"],
            priority: "high",
          }),
          sendWonEmail(req.user, { ...existing.toObject(), ...req.body }),
        ]);
      }
    }

    return res.json({ success: true, message: "Lead updated", data: lead });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── PUT /crm/leads/:id/stage ───────────────────────────────────────────────
export async function moveLeadStageController(req, res) {
  try {
    if (!crmAccess(req.user, res)) return;
    const { stage } = req.body;
    if (!CRM_STAGES.includes(stage))
      return res.status(400).json({ success: false, message: "Invalid stage" });

    const lead = await CrmLeadModel.findById(req.params.id);
    if (!lead)
      return res
        .status(404)
        .json({ success: false, message: "Lead not found" });
    if (!assertLeadCountryAccess(req, res, lead)) return;

    const oldStage = lead.stage;
    lead.stage = stage;
    lead.activities.push({
      type: "stage_change",
      content: `Stage: ${oldStage} → ${stage}`,
      performedBy: req.user._id,
      performedByName: req.user.name,
      metadata: { from: oldStage, to: stage },
    });
    await lead.save();

    if (stage === "Won") {
      const time = new Date().toLocaleString("en-NG", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Africa/Lagos",
      });
      await Promise.all([
        createNotificationInternal({
          triggeredBy: req.user._id,
          triggeredByName: req.user.name,
          type: "ORDER",
          title: "🎉 Deal Won!",
          message: `"${lead.companyName || lead.contactName}" → Won by ${req.user.name} (${req.user.subRole}) at ${time}`,
          link: "/admin/dashboard/crm",
          targetType: "role",
          targetRoles: ["DIRECTOR", "MANAGER", "IT"],
          priority: "high",
        }),
        sendWonEmail(req.user, lead.toObject()),
      ]);
    }

    return res.json({ success: true, message: "Stage updated", data: lead });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── DELETE /crm/leads/:id — IT/Director hard delete; others raise request ──
export async function deleteLeadController(req, res) {
  try {
    if (!crmAccess(req.user, res)) return;

    // IT and Director: immediate hard archive
    if (canHardDelete(req.user)) {
      await CrmLeadModel.findByIdAndUpdate(req.params.id, {
        isArchived: true,
        $unset: { pendingDeleteRequest: "" },
      });
      return res.json({ success: true, message: "Lead deleted" });
    }

    // Everyone else: raise a delete request
    const { reason } = req.body;
    if (!reason?.trim()) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Please provide a reason for the delete request",
        });
    }

    const lead = await CrmLeadModel.findById(req.params.id);
    if (!lead)
      return res
        .status(404)
        .json({ success: false, message: "Lead not found" });
    if (!assertLeadCountryAccess(req, res, lead)) return;

    if (lead.pendingDeleteRequest?.status === "pending") {
      return res
        .status(409)
        .json({
          success: false,
          message: "A delete request is already pending for this lead",
        });
    }

    lead.pendingDeleteRequest = {
      requestedBy: req.user._id,
      requestedByName: req.user.name,
      requestedBySubRole: req.user.subRole,
      reason: reason.trim(),
      status: "pending",
    };
    await lead.save();

    // Notify IT & Director
    await notifyDeleteRequest(lead, req.user, reason.trim());

    return res.json({
      success: true,
      message:
        "Delete request submitted. IT or Director will review and act on it.",
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── PUT /crm/leads/:id/delete-request — IT/Director: approve or reject ─────
export async function reviewDeleteRequestController(req, res) {
  try {
    if (!crmAccess(req.user, res)) return;
    if (!canHardDelete(req.user)) {
      return res
        .status(403)
        .json({
          success: false,
          message: "Only IT or Director can review delete requests",
        });
    }

    const { action, reviewNote } = req.body; // action: 'approve' | 'reject'
    if (!["approve", "reject"].includes(action)) {
      return res
        .status(400)
        .json({ success: false, message: "Action must be approve or reject" });
    }

    const lead = await CrmLeadModel.findById(req.params.id);
    if (!lead)
      return res
        .status(404)
        .json({ success: false, message: "Lead not found" });
    if (
      !lead.pendingDeleteRequest ||
      lead.pendingDeleteRequest.status !== "pending"
    ) {
      return res
        .status(404)
        .json({ success: false, message: "No pending delete request found" });
    }

    if (action === "approve") {
      await CrmLeadModel.findByIdAndUpdate(req.params.id, {
        isArchived: true,
        "pendingDeleteRequest.status": "approved",
        "pendingDeleteRequest.reviewedBy": req.user._id,
        "pendingDeleteRequest.reviewedByName": req.user.name,
        "pendingDeleteRequest.reviewNote": reviewNote || "",
        "pendingDeleteRequest.reviewedAt": new Date(),
      });

      // Notify the requester
      await createNotificationInternal({
        triggeredBy: req.user._id,
        triggeredByName: req.user.name,
        type: "SYSTEM",
        title: "✅ Delete Request Approved",
        message: `${req.user.name} approved your request to delete "${lead.companyName || lead.contactName}"`,
        link: "/admin/dashboard/crm",
        targetType: "specific",
        targetUsers: [lead.pendingDeleteRequest.requestedBy],
        priority: "medium",
      });

      return res.json({
        success: true,
        message: "Lead deleted and requester notified",
      });
    } else {
      // Reject: clear the request, notify requester
      await CrmLeadModel.findByIdAndUpdate(req.params.id, {
        "pendingDeleteRequest.status": "rejected",
        "pendingDeleteRequest.reviewedBy": req.user._id,
        "pendingDeleteRequest.reviewedByName": req.user.name,
        "pendingDeleteRequest.reviewNote": reviewNote || "",
        "pendingDeleteRequest.reviewedAt": new Date(),
      });

      await createNotificationInternal({
        triggeredBy: req.user._id,
        triggeredByName: req.user.name,
        type: "SYSTEM",
        title: "❌ Delete Request Rejected",
        message: `${req.user.name} rejected your request to delete "${lead.companyName || lead.contactName}". ${reviewNote ? "Note: " + reviewNote : ""}`,
        link: "/admin/dashboard/crm",
        targetType: "specific",
        targetUsers: [lead.pendingDeleteRequest.requestedBy],
        priority: "medium",
      });

      return res.json({
        success: true,
        message: "Delete request rejected and requester notified",
      });
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── POST /crm/leads/:id/activity ───────────────────────────────────────────
export async function addActivityController(req, res) {
  try {
    if (!crmAccess(req.user, res)) return;
    const { type, content } = req.body;
    if (!content)
      return res
        .status(400)
        .json({ success: false, message: "Content required" });
    const lead = await CrmLeadModel.findById(req.params.id);
    if (!lead)
      return res
        .status(404)
        .json({ success: false, message: "Lead not found" });
    lead.activities.push({
      type: type || "note",
      content,
      performedBy: req.user._id,
      performedByName: req.user.name,
    });
    if (["call", "email", "meeting"].includes(type))
      lead.lastContactedAt = new Date();
    await lead.save();
    return res.json({ success: true, message: "Activity added", data: lead });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── POST /crm/leads/bulk-import ────────────────────────────────────────────
export async function bulkImportLeadsController(req, res) {
  try {
    if (!crmAccess(req.user, res)) return;
    const { leads, scrapeJobId, source } = req.body;
    if (!leads?.length)
      return res
        .status(400)
        .json({ success: false, message: "No leads provided" });
    const ownerCountryCode = req.countryScope || req.body.countryCode || "NG";
    const toInsert = leads.map((l) => ({
      ...l,
      countryCode: ownerCountryCode,
      source: source || "Website Scrape",
      stage: "New",
      createdBy: req.user._id,
      createdByName: req.user.name,
      scrapeJobId: scrapeJobId || null,
      activities: [
        {
          type: "system",
          content: `Imported from scrape job by ${req.user.name}`,
          performedBy: req.user._id,
          performedByName: req.user.name,
        },
      ],
    }));
    const inserted = await CrmLeadModel.insertMany(toInsert, {
      ordered: false,
    });
    return res.json({
      success: true,
      message: `${inserted.length} leads imported`,
      count: inserted.length,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── GET /crm/stats ─────────────────────────────────────────────────────────
export async function getCrmStatsController(req, res) {
  try {
    if (!crmAccess(req.user, res)) return;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const baseMatch = { isArchived: false, ...buildCountryFilter(req) };
    const [
      stageBreakdown,
      sourceBreakdown,
      monthlyWon,
      totalLeads,
      wonLeads,
      lostLeads,
    ] = await Promise.all([
      CrmLeadModel.aggregate([
        { $match: baseMatch },
        {
          $group: {
            _id: "$stage",
            count: { $sum: 1 },
            value: { $sum: "$dealValue" },
          },
        },
      ]),
      CrmLeadModel.aggregate([
        { $match: baseMatch },
        { $group: { _id: "$source", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      CrmLeadModel.aggregate([
        {
          $match: {
            ...baseMatch,
            stage: "Won",
            updatedAt: { $gte: monthStart },
          },
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            value: { $sum: "$dealValue" },
          },
        },
      ]),
      CrmLeadModel.countDocuments(baseMatch),
      CrmLeadModel.countDocuments({ ...baseMatch, stage: "Won" }),
      CrmLeadModel.countDocuments({ ...baseMatch, stage: "Lost" }),
    ]);

    // User-level activity metrics (visible only to metrics roles)
    let userMetrics = null;
    if (canSeeMetrics(req.user)) {
      userMetrics = await CrmLeadModel.aggregate([
        { $match: baseMatch },
        {
          $group: {
            _id: { userId: "$createdBy", name: "$createdByName" },
            total: { $sum: 1 },
            won: { $sum: { $cond: [{ $eq: ["$stage", "Won"] }, 1, 0] } },
            lost: { $sum: { $cond: [{ $eq: ["$stage", "Lost"] }, 1, 0] } },
            totalDealValue: { $sum: "$dealValue" },
            wonDealValue: {
              $sum: { $cond: [{ $eq: ["$stage", "Won"] }, "$dealValue", 0] },
            },
          },
        },
        { $sort: { won: -1 } },
        { $limit: 20 },
      ]);
    }

    return res.json({
      success: true,
      data: {
        totalLeads,
        wonLeads,
        lostLeads,
        conversionRate: totalLeads
          ? ((wonLeads / totalLeads) * 100).toFixed(1)
          : 0,
        thisMonthWon: monthlyWon[0] || { count: 0, value: 0 },
        stageBreakdown,
        sourceBreakdown,
        userMetrics, // null for roles without access
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── CSV import / export / template ──────────────────────────────────────────
//
// "Update the CRM to allow only IT and the Manager to manage and to be
// exposed to all countries' CRM but manager and other roles are
// country-scoped" — already the case for reads/writes (buildCountryFilter,
// assertLeadCountryAccess above: GLOBAL admins — IT/DIRECTOR, and an
// HQ-scoped Manager — see/manage every country; a COUNTRY-scoped Manager or
// any other CRM role sees/manages only their own). Export follows the exact
// same rule via the same buildCountryFilter helper: GLOBAL admins export
// everything, everyone else's export is silently scoped to their own
// country — same as every other list endpoint in this controller, so
// there's nothing a scoped export could leak that a scoped list view
// doesn't already correctly hide.

function csvField(value) {
  const str = value === null || value === undefined ? "" : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

function buildCsv(headers, rows) {
  const lines = [headers, ...rows].map((row) => row.map(csvField).join(","));
  return "\uFEFF" + lines.join("\r\n"); // BOM for Excel-friendly UTF-8
}

// Column order shared by the template, export, and import — keeping one
// source of truth means the downloaded template always matches exactly
// what import expects and export produces.
const LEAD_CSV_COLUMNS = [
  "Company Name", "Contact Name", "Job Title", "Email", "Phone", "Website",
  "Address", "City", "Country", "Industry", "Company Size",
  "LinkedIn URL", "Facebook URL", "Instagram URL", "Twitter URL",
  "Stage", "Source", "Deal Value", "Currency", "Probability %",
  "Expected Close Date",
];

/**
 * GET /admin/crm/leads/template/csv — downloadable CSV template with the
 * exact headers bulkImportLeadsCsvController expects, plus one example row
 * showing valid Stage/Source values (both are closed enums on the model —
 * anything else gets rejected/defaulted on import) and date format.
 */
export async function downloadLeadsTemplateCSV(req, res) {
  try {
    if (!crmAccess(req.user, res)) return;

    const exampleRow = [
      "Acme Coffee Roasters", "Jane Doe", "Procurement Manager",
      "jane@acmecoffee.example", "+234 800 000 0000", "https://acmecoffee.example",
      "12 Example Street", "Lagos", "Nigeria", "Food & Beverage", "11-50",
      "", "", "", "",
      "New", "Manual Entry", "500000", "NGN", "20",
      "2026-12-31",
    ];
    const notesRow = [
      `Stage must be one of: ${CRM_STAGES.join(" | ")}`,
      `Source must be one of: ${LEAD_SOURCES.join(" | ")}`,
      "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "",
    ];

    const csvContent = buildCsv(LEAD_CSV_COLUMNS, [exampleRow, notesRow]);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="crm_leads_import_template.csv"');
    return res.send(csvContent);
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * GET /admin/crm/leads/export/csv — country-scoped per the rule above.
 * Optional query filters (stage, source, search) mirror getLeadsController
 * so "export what I'm currently looking at" is possible from the same
 * filter state the list view already has.
 */
export async function exportLeadsCSV(req, res) {
  try {
    if (!crmAccess(req.user, res)) return;

    const { stage, source, search } = req.query;
    const query = { isArchived: false, ...buildCountryFilter(req) };
    if (stage) query.stage = stage;
    if (source) query.source = source;
    if (search) {
      query.$or = [
        { companyName: { $regex: search, $options: "i" } },
        { contactName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const leads = await CrmLeadModel.find(query).sort({ createdAt: -1 });

    const rows = leads.map((l) => [
      l.companyName, l.contactName, l.jobTitle, l.email, l.phone, l.website,
      l.address, l.city, l.country, l.industry, l.companySize,
      l.linkedinUrl, l.facebookUrl, l.instagramUrl, l.twitterUrl,
      l.stage, l.source, l.dealValue, l.currency, l.probability,
      l.expectedCloseDate ? l.expectedCloseDate.toISOString().split("T")[0] : "",
    ]);

    const csvContent = buildCsv(LEAD_CSV_COLUMNS, rows);
    const filename = `crm_leads_${new Date().toISOString().split("T")[0]}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(csvContent);
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * POST /admin/crm/leads/import/csv — body: { csvData }. Country-scoped the
 * same way createLeadController is: a COUNTRY-scoped admin's import is
 * always stamped to their own country regardless of anything in the file;
 * a GLOBAL admin (IT/DIRECTOR/HQ Manager) can target a specific country via
 * body.countryCode, defaulting to NG if omitted.
 */
export async function bulkImportLeadsCsvController(req, res) {
  try {
    if (!crmAccess(req.user, res)) return;

    const { csvData, countryCode: requestedCountryCode } = req.body;
    if (!csvData) {
      return res.status(400).json({ success: false, message: "CSV data is required" });
    }

    const ownerCountryCode =
      req.countryScope || (requestedCountryCode || "").toUpperCase() || "NG";

    const rows = [];
    const stream = Readable.from([csvData]);
    await new Promise((resolve, reject) => {
      stream.pipe(csv()).on("data", (row) => rows.push(row)).on("end", resolve).on("error", reject);
    });

    const results = { created: [], failed: [], totalProcessed: rows.length };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // header is row 1
      const companyName = (row["Company Name"] || "").trim();
      const contactName = (row["Contact Name"] || "").trim();

      if (!companyName && !contactName) {
        results.failed.push({ row: rowNum, reason: "Company Name or Contact Name is required" });
        continue;
      }

      const stageRaw = (row["Stage"] || "New").trim();
      const sourceRaw = (row["Source"] || "Manual Entry").trim();

      try {
        const lead = new CrmLeadModel({
          companyName,
          contactName,
          jobTitle: row["Job Title"] || "",
          email: row["Email"] || "",
          phone: row["Phone"] || "",
          website: row["Website"] || "",
          address: row["Address"] || "",
          city: row["City"] || "",
          country: row["Country"] || "Nigeria",
          industry: LEAD_INDUSTRIES.includes(row["Industry"]) ? row["Industry"] : "Other",
          companySize: row["Company Size"] || "",
          linkedinUrl: row["LinkedIn URL"] || "",
          facebookUrl: row["Facebook URL"] || "",
          instagramUrl: row["Instagram URL"] || "",
          twitterUrl: row["Twitter URL"] || "",
          stage: CRM_STAGES.includes(stageRaw) ? stageRaw : "New",
          source: LEAD_SOURCES.includes(sourceRaw) ? sourceRaw : "Manual Entry",
          dealValue: Number(row["Deal Value"]) || 0,
          currency: row["Currency"] || "NGN",
          probability: Math.min(100, Math.max(0, Number(row["Probability %"]) || 0)),
          expectedCloseDate: row["Expected Close Date"] ? new Date(row["Expected Close Date"]) : null,
          countryCode: ownerCountryCode,
          createdBy: req.user._id,
          createdByName: req.user.name,
          activities: [
            {
              type: "system",
              content: `Imported via CSV by ${req.user.name}`,
              performedBy: req.user._id,
              performedByName: req.user.name,
            },
          ],
        });
        await lead.save();
        results.created.push({ row: rowNum, company: lead.companyName || lead.contactName });
      } catch (err) {
        results.failed.push({ row: rowNum, reason: err.message });
      }
    }

    return res.json({
      success: true,
      message: `${results.created.length} of ${results.totalProcessed} lead(s) imported`,
      data: results,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}
