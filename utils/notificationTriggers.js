//server
// utils/notificationTriggers.js
//
// Drop-in helpers for existing controllers to fire role-based notifications.
// Import and call the relevant function wherever the action occurs.
//
// Example usage in order.controller.js:
//   import { notifyNewOrder } from '../utils/notificationTriggers.js';
//   // after order creation:
//   await notifyNewOrder(req.user, order);

import { createNotificationInternal } from '../controllers/notification.controller.js';

// ── Orders ──────────────────────────────────────────────────────────────────
export async function notifyNewOrder(user, order) {
  await createNotificationInternal({
    triggeredBy: user?._id,
    triggeredByName: user?.name || 'System',
    type: 'ORDER',
    title: 'New Order Received',
    message: `Order #${order.orderNumber || order._id} placed${order.customerName ? ` by ${order.customerName}` : ''}.`,
    link: '/admin/dashboard/website-orders',
    resourceId: order._id?.toString(),
    resourceType: 'Order',
    priority: 'medium',
  });
}

export async function notifyOrderStatusChange(user, order, newStatus) {
  await createNotificationInternal({
    triggeredBy: user?._id,
    triggeredByName: user?.name || 'System',
    type: 'ORDER',
    title: `Order Status Updated`,
    message: `Order #${order.orderNumber || order._id} → ${newStatus}`,
    link: '/admin/dashboard/website-orders',
    resourceId: order._id?.toString(),
    resourceType: 'Order',
    priority: 'low',
  });
}

// ── Shipment & Tracking ──────────────────────────────────────────────────────
export async function notifyNewShipment(user, shipment) {
  await createNotificationInternal({
    triggeredBy: user?._id,
    triggeredByName: user?.name || 'System',
    type: 'SHIPMENT',
    title: 'New Shipment Created',
    message: `Shipment ${shipment.trackingNumber || shipment._id} created.`,
    link: '/admin/dashboard/logistics',
    resourceId: shipment._id?.toString(),
    resourceType: 'Shipment',
    priority: 'medium',
  });
}

export async function notifyTrackingUpdate(user, tracking) {
  await createNotificationInternal({
    triggeredBy: user?._id,
    triggeredByName: user?.name || 'System',
    type: 'TRACKING',
    title: 'Tracking Update',
    message: `Tracking for ${tracking.trackingNumber || tracking._id} updated to: ${tracking.status || 'new status'}.`,
    link: '/admin/dashboard/tracking',
    resourceId: tracking._id?.toString(),
    resourceType: 'Tracking',
    priority: 'medium',
  });
}

// ── Products ─────────────────────────────────────────────────────────────────
export async function notifyProductUpdated(user, product) {
  await createNotificationInternal({
    triggeredBy: user?._id,
    triggeredByName: user?.name || 'System',
    type: 'PRODUCT',
    title: 'Product Updated',
    message: `"${product.name}" was updated.`,
    link: '/admin/dashboard/products',
    resourceId: product._id?.toString(),
    resourceType: 'Product',
    priority: 'low',
  });
}

export async function notifyLowStock(user, product, stock) {
  await createNotificationInternal({
    triggeredBy: user?._id,
    triggeredByName: user?.name || 'System',
    type: 'STOCK',
    title: 'Low Stock Alert',
    message: `"${product.name}" stock is low (${stock} units remaining).`,
    link: '/admin/dashboard/stock',
    resourceId: product._id?.toString(),
    resourceType: 'Product',
    priority: 'high',
  });
}

// ── Users ─────────────────────────────────────────────────────────────────────
export async function notifyNewUserRegistration(user) {
  await createNotificationInternal({
    triggeredByName: 'System',
    type: 'USER_REGISTRATION',
    title: 'New User Registration',
    message: `${user.name} registered${user.email ? ` (${user.email})` : ''}.`,
    link: '/admin/dashboard/users',
    resourceId: user._id?.toString(),
    resourceType: 'User',
    priority: 'low',
  });
}

export async function notifyPasswordResetRequest(user) {
  await createNotificationInternal({
    triggeredByName: 'System',
    type: 'PASSWORD_RESET',
    title: 'Password Reset Request',
    message: `${user.name} requested a password reset.`,
    link: '/admin/dashboard/users',
    resourceId: user._id?.toString(),
    resourceType: 'User',
    priority: 'medium',
  });
}

// ── Pricing ───────────────────────────────────────────────────────────────────
export async function notifyPricingUpdated(user, description) {
  await createNotificationInternal({
    triggeredBy: user?._id,
    triggeredByName: user?.name || 'System',
    type: 'PRICING',
    title: 'Pricing Updated',
    message: description || 'Pricing configuration was updated.',
    link: '/admin/dashboard/pricing',
    priority: 'low',
  });
}

// ── Purchase Orders ───────────────────────────────────────────────────────────
export async function notifyNewPurchaseOrder(user, po) {
  await createNotificationInternal({
    triggeredBy: user?._id,
    triggeredByName: user?.name || 'System',
    type: 'PURCHASE_ORDER',
    title: 'New Purchase Order',
    message: `PO #${po.poNumber || po._id} created.`,
    link: '/admin/dashboard/purchase-orders',
    resourceId: po._id?.toString(),
    resourceType: 'PurchaseOrder',
    priority: 'medium',
  });
}
