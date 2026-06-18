//server
// controllers/support-ticket.controller.js
import SupportTicketModel, { ISSUE_CATEGORIES } from '../models/support-ticket.model.js';
import UserModel from '../models/user.model.js';
import { createNotificationInternal } from './notification.controller.js';

// ─── GET /support-tickets ─────────────────────────────────────────────────────
export async function getTicketsController(req, res) {
  try {
    const user = req.user;
    const { page = 1, limit = 20, status, category, priority, search } = req.query;

    const query = {};

    // IT and DIRECTOR see all; others see only their own
    if (!['IT', 'DIRECTOR'].includes(user.subRole)) {
      query.createdBy = user._id;
    }

    if (status) query.status = status;
    if (category) query.category = category;
    if (priority) query.priority = priority;
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { ticketNumber: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const total = await SupportTicketModel.countDocuments(query);
    const tickets = await SupportTicketModel.find(query)
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .populate('createdBy', 'name email subRole avatar')
      .populate('assignedTo', 'name email avatar')
      .lean();

    return res.json({
      success: true,
      data: tickets,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      categories: ISSUE_CATEGORIES,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── GET /support-tickets/:id ─────────────────────────────────────────────────
export async function getTicketByIdController(req, res) {
  try {
    const user = req.user;
    const ticket = await SupportTicketModel.findById(req.params.id)
      .populate('createdBy', 'name email subRole avatar')
      .populate('assignedTo', 'name email avatar')
      .populate('messages.sender', 'name avatar subRole');

    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });

    // Non-IT/Director can only see their own tickets
    if (!['IT', 'DIRECTOR'].includes(user.subRole) && ticket.createdBy._id.toString() !== user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    return res.json({ success: true, data: ticket });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── POST /support-tickets ────────────────────────────────────────────────────
export async function createTicketController(req, res) {
  try {
    const user = req.user;
    const { title, description, category, priority } = req.body;

    if (!title || !description) {
      return res.status(400).json({ success: false, message: 'Title and description are required' });
    }

    const ticket = await SupportTicketModel.create({
      createdBy: user._id,
      createdByName: user.name,
      createdBySubRole: user.subRole,
      createdByEmail: user.email,
      title,
      description,
      category: category || 'Other',
      priority: priority || 'medium',
      messages: [{
        sender: user._id,
        senderName: user.name,
        senderSubRole: user.subRole,
        message: description,
      }],
    });

    // Notify IT team
    await createNotificationInternal({
      triggeredBy: user._id,
      triggeredByName: user.name,
      type: 'SUPPORT_TICKET',
      title: `New Support Ticket: ${ticket.ticketNumber}`,
      message: `${user.name} (${user.subRole}) submitted: "${title}" — Category: ${category || 'Other'}`,
      link: `/dashboard/support-tickets`,
      resourceId: ticket._id.toString(),
      resourceType: 'SupportTicket',
      targetType: 'role',
      targetRoles: ['IT', 'DIRECTOR'],
      priority: priority === 'critical' ? 'urgent' : 'medium',
    });

    return res.status(201).json({ success: true, message: 'Ticket created', data: ticket });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── PUT /support-tickets/:id/status — IT updates status ─────────────────────
export async function updateTicketStatusController(req, res) {
  try {
    const user = req.user;
    if (!['IT', 'DIRECTOR'].includes(user.subRole)) {
      return res.status(403).json({ success: false, message: 'Only IT or Director can update status' });
    }

    const { status, internalNotes, assignedTo } = req.body;
    const ticket = await SupportTicketModel.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });

    const oldStatus = ticket.status;
    if (status) ticket.status = status;
    if (internalNotes !== undefined) ticket.internalNotes = internalNotes;
    if (assignedTo) {
      ticket.assignedTo = assignedTo;
      const assignedUser = await UserModel.findById(assignedTo).select('name').lean();
      ticket.assignedToName = assignedUser?.name || '';
    }
    if (status === 'completed' || status === 'fixed') ticket.resolvedAt = new Date();
    if (status === 'closed') ticket.closedAt = new Date();

    await ticket.save();

    // Notify the requester about status change
    if (oldStatus !== status) {
      await createNotificationInternal({
        triggeredBy: user._id,
        triggeredByName: user.name,
        type: 'SUPPORT_TICKET',
        title: `Ticket ${ticket.ticketNumber} Updated`,
        message: `Your ticket "${ticket.title}" status changed to: ${status.replace('_', ' ').toUpperCase()}`,
        link: `/dashboard/support-tickets`,
        resourceId: ticket._id.toString(),
        resourceType: 'SupportTicket',
        targetType: 'specific',
        targetUsers: [ticket.createdBy],
        priority: 'medium',
      });
    }

    return res.json({ success: true, message: 'Ticket updated', data: ticket });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── POST /support-tickets/:id/message ────────────────────────────────────────
export async function addTicketMessageController(req, res) {
  try {
    const user = req.user;
    const { message } = req.body;
    if (!message) return res.status(400).json({ success: false, message: 'Message is required' });

    const ticket = await SupportTicketModel.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });

    // Only createdBy, IT, or Director can reply
    const canReply = ['IT', 'DIRECTOR'].includes(user.subRole) || ticket.createdBy.toString() === user._id.toString();
    if (!canReply) return res.status(403).json({ success: false, message: 'Access denied' });

    ticket.messages.push({
      sender: user._id,
      senderName: user.name,
      senderSubRole: user.subRole,
      message,
    });
    await ticket.save();

    // Notify the other party
    const notifyUsers = ['IT', 'DIRECTOR'].includes(user.subRole)
      ? [ticket.createdBy]
      : ticket.assignedTo ? [ticket.assignedTo] : [];

    if (notifyUsers.length > 0) {
      const notifyRoles = ['IT', 'DIRECTOR'].includes(user.subRole) ? null : ['IT', 'DIRECTOR'];
      await createNotificationInternal({
        triggeredBy: user._id,
        triggeredByName: user.name,
        type: 'SUPPORT_TICKET',
        title: `New Reply on Ticket ${ticket.ticketNumber}`,
        message: `${user.name} replied on: "${ticket.title}"`,
        link: `/dashboard/support-tickets`,
        resourceId: ticket._id.toString(),
        resourceType: 'SupportTicket',
        targetType: notifyRoles ? 'role' : 'specific',
        targetRoles: notifyRoles,
        targetUsers: notifyRoles ? [] : notifyUsers,
        priority: 'medium',
      });
    }

    return res.json({ success: true, message: 'Message added', data: ticket });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── GET /support-tickets/categories ─────────────────────────────────────────
export async function getCategoriesController(req, res) {
  return res.json({ success: true, data: ISSUE_CATEGORIES });
}
