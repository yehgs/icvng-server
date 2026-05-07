// server/utils/activityLogger.js
// Drop-in helper — call logActivity() inside any controller
import ActivityLogModel from '../models/activity-log.model.js';

/**
 * @param {Object} opts
 * @param {ObjectId} opts.userId        — admin user performing the action
 * @param {string}  opts.action         — enum value from ActivityLogModel
 * @param {string}  opts.description    — human-readable e.g. "Updated price of Lavazza 250g"
 * @param {string}  [opts.resourceType] — e.g. 'Product'
 * @param {ObjectId} [opts.resourceId]
 * @param {string}  [opts.resourceName] — e.g. product name
 * @param {Object}  [opts.before]       — state before change
 * @param {Object}  [opts.after]        — state after change
 * @param {Request} [opts.req]          — Express request (for ip/userAgent)
 * @param {string}  [opts.status]       — 'SUCCESS' | 'FAILED' | 'PARTIAL'
 */
export const logActivity = async (opts) => {
  try {
    const {
      userId,
      action,
      description,
      resourceType = 'Other',
      resourceId = null,
      resourceName = '',
      before = null,
      after = null,
      req = null,
      status = 'SUCCESS',
    } = opts;

    await ActivityLogModel.create({
      user: userId,
      action,
      description,
      resourceType,
      resourceId,
      resourceName,
      changes: { before, after },
      metadata: {
        ip: req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '') : '',
        userAgent: req ? (req.headers['user-agent'] || '') : '',
      },
      status,
    });
  } catch (err) {
    // Never let logging crash the main request
    console.error('[ActivityLogger] Failed to log activity:', err.message);
  }
};
