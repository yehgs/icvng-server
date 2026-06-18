//server
// controllers/notification.controller.js

import NotificationModel from '../models/notification.model.js';
import UserModel from '../models/user.model.js';
import sendEmail from '../config/sendEmail.js';

// ─── Role-based notification routing ────────────────────────────────────────
// Maps notification type → which subRoles should receive it
export const NOTIFICATION_ROLE_MAP = {
  ORDER: ['SALES', 'MANAGER', 'DIRECTOR', 'IT'],
  SHIPMENT: ['LOGISTICS', 'MANAGER', 'DIRECTOR', 'IT'],
  TRACKING: ['LOGISTICS', 'MANAGER', 'DIRECTOR', 'IT'],
  USER_REGISTRATION: ['HR', 'DIRECTOR', 'IT'],
  PASSWORD_RESET: ['HR', 'DIRECTOR', 'IT'],
  PRODUCT: ['EDITOR', 'MANAGER', 'DIRECTOR', 'IT'],
  STOCK: ['WAREHOUSE', 'MANAGER', 'DIRECTOR', 'IT'],
  PRICING: ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'IT'],
  PURCHASE_ORDER: ['ACCOUNTANT', 'WAREHOUSE', 'MANAGER', 'DIRECTOR', 'IT'],
  BLOG: ['EDITOR', 'MANAGER', 'DIRECTOR', 'IT'],
  SUPPORT_TICKET: ['IT', 'DIRECTOR'],
  SYSTEM: ['IT', 'DIRECTOR'],
  ANNOUNCEMENT: [], // all roles — handled by targetType='all'
  FEATURE: [], // targeted per creation
  CUSTOM: [],
};

// ─── Helper: send notification email to a list of users ─────────────────────
async function sendNotificationEmails(users, notification) {
  const emailPromises = users.map(async (user) => {
    if (!user.email) return;
    try {
      await sendEmail({
        sendTo: user.email,
        subject: `[ICVNG Admin] ${notification.title}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
            <div style="background:#1e3a5f;padding:16px 24px;border-radius:8px 8px 0 0;">
              <h2 style="color:#fff;margin:0;font-size:18px;">ICVNG Admin Notification</h2>
            </div>
            <div style="background:#f9f9f9;padding:24px;border:1px solid #e0e0e0;border-radius:0 0 8px 8px;">
              <h3 style="color:#1e3a5f;margin-top:0;">${notification.title}</h3>
              <p style="color:#444;line-height:1.6;">${notification.message}</p>
              ${notification.link ? `<a href="${process.env.ADMIN_URL || '#'}${notification.link}" style="display:inline-block;margin-top:12px;padding:10px 20px;background:#1e3a5f;color:#fff;text-decoration:none;border-radius:5px;">View Details</a>` : ''}
              <hr style="margin:24px 0;border:none;border-top:1px solid #e0e0e0;" />
              <p style="color:#888;font-size:12px;margin:0;">You are receiving this because of your role (${user.subRole}) on the ICVNG admin platform.</p>
            </div>
          </div>
        `,
      });
    } catch (err) {
      console.error(`Failed to send notification email to ${user.email}:`, err.message);
    }
  });
  await Promise.allSettled(emailPromises);
}

// ─── Internal helper: create notification and optionally email ───────────────
export async function createNotificationInternal({
  triggeredBy = null,
  triggeredByName = 'System',
  type = 'SYSTEM',
  title,
  message,
  link = null,
  resourceId = null,
  resourceType = null,
  targetType = 'role',
  targetRoles = null,   // pass explicitly or derive from NOTIFICATION_ROLE_MAP
  targetUsers = [],
  priority = 'medium',
  sendEmailFlag = true,
}) {
  // Derive target roles from type if not explicitly provided
  const roles = targetRoles !== null ? targetRoles : (NOTIFICATION_ROLE_MAP[type] || []);

  const notification = await NotificationModel.create({
    triggeredBy,
    triggeredByName,
    targetType: roles.length === 0 && targetUsers.length === 0 ? 'all' : targetType,
    targetRoles: roles,
    targetUsers,
    type,
    title,
    message,
    link,
    resourceId,
    resourceType,
    priority,
  });

  // Send emails asynchronously (fire-and-forget)
  if (sendEmailFlag) {
    (async () => {
      try {
        let usersToEmail = [];
        if (notification.targetType === 'all') {
          usersToEmail = await UserModel.find({ role: 'ADMIN', status: 'Active' }).lean();
        } else if (notification.targetType === 'role' && roles.length > 0) {
          usersToEmail = await UserModel.find({ role: 'ADMIN', subRole: { $in: roles }, status: 'Active' }).lean();
        } else if (notification.targetType === 'specific' && targetUsers.length > 0) {
          usersToEmail = await UserModel.find({ _id: { $in: targetUsers }, status: 'Active' }).lean();
        }

        if (usersToEmail.length > 0) {
          await sendNotificationEmails(usersToEmail, notification);
          // Mark email sent
          await NotificationModel.findByIdAndUpdate(notification._id, {
            $set: { emailSentTo: usersToEmail.map((u) => u._id) },
          });
        }
      } catch (err) {
        console.error('Notification email dispatch error:', err.message);
      }
    })();
  }

  return notification;
}

// ─── GET /notifications — fetch for current user based on role ───────────────
export async function getNotificationsController(req, res) {
  try {
    const user = req.user;
    const { page = 1, limit = 20, unreadOnly = false } = req.query;

    const query = {
      isActive: true,
      $or: [
        { targetType: 'all' },
        { targetType: 'role', targetRoles: user.subRole },
        { targetType: 'specific', targetUsers: user._id },
      ],
    };

    if (unreadOnly === 'true') {
      query['readBy.user'] = { $ne: user._id };
    }

    const total = await NotificationModel.countDocuments(query);
    const notifications = await NotificationModel.find(query)
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean();

    // Attach isRead flag per notification for this user
    const userId = user._id.toString();
    const enriched = notifications.map((n) => ({
      ...n,
      isRead: n.readBy.some((r) => r.user?.toString() === userId),
    }));

    const unreadCount = await NotificationModel.countDocuments({
      ...query,
      'readBy.user': { $ne: user._id },
    });

    return res.json({
      success: true,
      data: enriched,
      unreadCount,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── PUT /notifications/:id/read ─────────────────────────────────────────────
export async function markNotificationReadController(req, res) {
  try {
    const { id } = req.params;
    const user = req.user;

    await NotificationModel.findByIdAndUpdate(id, {
      $addToSet: { readBy: { user: user._id, readAt: new Date() } },
    });

    return res.json({ success: true, message: 'Marked as read' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── PUT /notifications/mark-all-read ────────────────────────────────────────
export async function markAllNotificationsReadController(req, res) {
  try {
    const user = req.user;

    const query = {
      isActive: true,
      'readBy.user': { $ne: user._id },
      $or: [
        { targetType: 'all' },
        { targetType: 'role', targetRoles: user.subRole },
        { targetType: 'specific', targetUsers: user._id },
      ],
    };

    const notifications = await NotificationModel.find(query).select('_id');
    const ids = notifications.map((n) => n._id);

    await NotificationModel.updateMany(
      { _id: { $in: ids } },
      { $addToSet: { readBy: { user: user._id, readAt: new Date() } } }
    );

    return res.json({ success: true, message: 'All notifications marked as read' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── POST /notifications — manually create (IT/Director/System) ──────────────
export async function createNotificationController(req, res) {
  try {
    const user = req.user;
    const {
      type,
      title,
      message,
      link,
      targetType = 'role',
      targetRoles,
      targetUsers,
      priority,
    } = req.body;

    if (!title || !message) {
      return res.status(400).json({ success: false, message: 'Title and message are required' });
    }

    const notification = await createNotificationInternal({
      triggeredBy: user._id,
      triggeredByName: user.name,
      type: type || 'CUSTOM',
      title,
      message,
      link,
      targetType,
      targetRoles,
      targetUsers,
      priority,
      sendEmailFlag: true,
    });

    return res.json({ success: true, message: 'Notification created', data: notification });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── DELETE /notifications/:id ───────────────────────────────────────────────
export async function deleteNotificationController(req, res) {
  try {
    await NotificationModel.findByIdAndUpdate(req.params.id, { isActive: false });
    return res.json({ success: true, message: 'Notification removed' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── GET /notifications/count ─────────────────────────────────────────────────
export async function getUnreadCountController(req, res) {
  try {
    const user = req.user;
    const count = await NotificationModel.countDocuments({
      isActive: true,
      'readBy.user': { $ne: user._id },
      $or: [
        { targetType: 'all' },
        { targetType: 'role', targetRoles: user.subRole },
        { targetType: 'specific', targetUsers: user._id },
      ],
    });
    return res.json({ success: true, unreadCount: count });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}
