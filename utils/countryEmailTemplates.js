/**
 * utils/countryEmailTemplates.js
 *
 * Country-aware HTML email templates for Phase 4.
 * These work with the countryDetect middleware (req.country).
 *
 * Usage:
 *   import { orderConfirmationEmail } from '../utils/countryEmailTemplates.js';
 *   import { sendCountryEmail } from '../config/emailService.js';
 *
 *   const html = orderConfirmationEmail({ order, user, items, country: req.country });
 *   await sendCountryEmail({ countryCode: req.countryCode, sendTo: user.email,
 *                            subject: `Order ${order.orderId} Confirmed`, html });
 */

import { getCountryByCode } from "../config/countries/index.js";

const BRAND_COLOR = "#8B4513";
const BRAND_LIGHT = "#D2691E";

function emailShell(country, bodyHtml) {
  const c        = country || getCountryByCode("NG");
  const domain   = `https://${c.domain}`;
  const siteName = c.seo?.siteName || "I-Coffee";
  const year     = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="${c.language?.default || "en"}">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${siteName}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#F9FAFB;color:#374151}
.wrap{max-width:600px;margin:0 auto;background:#fff}
.hdr{background:linear-gradient(135deg,${BRAND_COLOR},${BRAND_LIGHT});padding:32px 24px;text-align:center}
.hdr h1{color:#fff;font-size:24px;font-weight:700}
.hdr p{color:rgba(255,255,255,.8);font-size:13px;margin-top:6px}
.body{padding:32px 24px}
.ftr{background:#1F2937;color:#9CA3AF;text-align:center;padding:24px;font-size:12px}
.ftr a{color:#D1D5DB;text-decoration:none}
.btn{display:inline-block;background:${BRAND_COLOR};color:#fff!important;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin:16px 0}
.card{background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;padding:20px;margin:16px 0}
.lbl{font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:#6B7280;font-weight:600;margin-bottom:4px}
.val{font-size:15px;color:#374151;font-weight:500}
.divider{border:none;border-top:1px solid #E5E7EB;margin:20px 0}
table.items{width:100%;border-collapse:collapse;font-size:13px}
table.items th{text-align:left;padding:8px 10px;background:#F3F4F6;color:#6B7280;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
table.items td{padding:10px;border-bottom:1px solid #F3F4F6;vertical-align:top}
.total td{font-weight:700;font-size:15px;border-top:2px solid #E5E7EB}
.badge{display:inline-block;padding:4px 10px;border-radius:99px;font-size:12px;font-weight:600}
.green{background:#D1FAE5;color:#065F46}
.amber{background:#FEF3C7;color:#92400E}
</style>
</head><body>
<div class="wrap">
<div class="hdr"><h1>☕ ${siteName}</h1><p>${c.flagEmoji} ${c.name}</p></div>
<div class="body">${bodyHtml}</div>
<div class="ftr">
<p>© ${year} ${siteName} · <a href="${domain}">${domain}</a></p>
<p style="margin-top:8px"><a href="${domain}/privacy">Privacy</a> &nbsp;·&nbsp; <a href="${domain}/contact">Contact</a></p>
</div></div></body></html>`;
}

function fmt(amount, country) {
  const c = country || getCountryByCode("NG");
  try {
    return new Intl.NumberFormat(c.language?.locale || "en-NG", {
      style: "currency", currency: c.currency?.code || "NGN",
      minimumFractionDigits: c.currency?.decimals ?? 2,
      maximumFractionDigits: c.currency?.decimals ?? 2,
    }).format(amount ?? 0);
  } catch {
    return `${c.currency?.symbol || ""}${(amount ?? 0).toFixed(2)}`;
  }
}

// ── Templates ─────────────────────────────────────────────────────────────────

export function verificationEmail({ name, verificationUrl, country }) {
  return emailShell(country, `
    <h2 style="font-size:22px;font-weight:700;margin-bottom:8px">Verify your email</h2>
    <p style="color:#6B7280;margin-bottom:24px">Hi ${name || "there"}, welcome! Please confirm your email to get started.</p>
    <div style="text-align:center"><a href="${verificationUrl}" class="btn">Verify Email Address</a></div>
    <p style="font-size:12px;color:#9CA3AF;margin-top:24px;text-align:center">Link expires in 24 hours. If you didn't sign up, ignore this.</p>
  `);
}

export function passwordResetEmail({ name, otp, resetUrl, country }) {
  const inner = otp
    ? `<div class="card" style="text-align:center">
         <p class="lbl">Your OTP</p>
         <p style="font-size:36px;font-weight:800;letter-spacing:8px;color:${BRAND_COLOR};margin:12px 0">${otp}</p>
         <p style="font-size:12px;color:#9CA3AF">Valid for 15 minutes</p>
       </div>`
    : `<div style="text-align:center"><a href="${resetUrl}" class="btn">Reset Password</a></div>
       <p style="font-size:12px;color:#9CA3AF;margin-top:16px;text-align:center">Expires in 1 hour.</p>`;
  return emailShell(country, `
    <h2 style="font-size:22px;font-weight:700;margin-bottom:8px">Reset your password</h2>
    <p style="color:#6B7280;margin-bottom:24px">Hi ${name || "there"}, we received a password reset request.</p>
    ${inner}
    <p style="font-size:12px;color:#9CA3AF;margin-top:24px">If you didn't request this, ignore this email.</p>
  `);
}

export function orderConfirmationEmail({ order, user, items = [], country }) {
  const c = country || getCountryByCode("NG");
  const dateStr = new Date(order.createdAt || Date.now()).toLocaleDateString(c.language?.locale || "en-NG", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  const rows = items.length > 0
    ? items.map(i => `<tr><td>${i.productId?.name || i.name || "Product"}</td><td style="text-align:center">${i.quantity || 1}</td><td style="text-align:right">${fmt(i.price || i.subTotalAmt, c)}</td></tr>`).join("")
    : `<tr><td colspan="3" style="color:#9CA3AF;text-align:center">See your account for item details</td></tr>`;
  const addr = order.deliveryAddress;

  return emailShell(c, `
    <div style="text-align:center;margin-bottom:28px">
      <div style="font-size:40px;margin-bottom:8px">🎉</div>
      <h2 style="font-size:22px;font-weight:700">Order Confirmed!</h2>
      <p style="color:#6B7280;margin-top:6px">Thank you, ${user?.name || "valued customer"}. We have received your order.</p>
    </div>
    <div class="card">
      <p class="lbl">Order Number</p><p class="val" style="font-family:monospace;font-size:16px">${order.orderId || order._id}</p>
      <hr class="divider"/>
      <p class="lbl">Date</p><p class="val">${dateStr}</p>
      <hr class="divider"/>
      <span class="badge ${order.paymentStatus === "PAID" ? "green" : "amber"}">
        ${order.paymentStatus === "PAID" ? "✓ Payment confirmed" : "⏳ Awaiting payment"}
      </span>
    </div>
    <h3 style="font-size:14px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.5px;margin:20px 0 10px">Order Summary</h3>
    <table class="items">
      <thead><tr><th>Product</th><th style="text-align:center">Qty</th><th style="text-align:right">Price</th></tr></thead>
      <tbody>
        ${rows}
        <tr class="total"><td colspan="2">Total</td><td style="text-align:right">${fmt(order.totalAmt || order.subTotalAmt, c)}</td></tr>
      </tbody>
    </table>
    ${addr ? `
      <h3 style="font-size:14px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.5px;margin:20px 0 10px">Delivery Address</h3>
      <div class="card"><p style="font-size:14px;line-height:1.6">${addr.address_line || ""}<br/>${addr.city || ""}, ${addr.state || ""}<br/>${addr.country || c.name}</p></div>
    ` : ""}
    <div style="text-align:center;margin-top:28px">
      <a href="https://${c.domain}/dashboard/myorders" class="btn">Track Your Order</a>
    </div>
    <p style="font-size:13px;color:#6B7280;text-align:center;margin-top:20px">
      Questions? <a href="https://${c.domain}/contact" style="color:${BRAND_COLOR}">Contact us</a>
    </p>
  `);
}

export function shippingNotificationEmail({ order, tracking, user, country }) {
  const c = country || getCountryByCode("NG");
  return emailShell(c, `
    <div style="text-align:center;margin-bottom:28px">
      <div style="font-size:40px;margin-bottom:8px">📦</div>
      <h2 style="font-size:22px;font-weight:700">Your order is on its way!</h2>
      <p style="color:#6B7280;margin-top:6px">Hi ${user?.name || "there"}, your order has shipped.</p>
    </div>
    <div class="card">
      <p class="lbl">Order Number</p><p class="val" style="font-family:monospace">${order.orderId}</p>
      ${tracking?.trackingNumber ? `
        <hr class="divider"/>
        <p class="lbl">Tracking Number</p>
        <p class="val" style="font-family:monospace;font-size:18px">${tracking.trackingNumber}</p>
        ${tracking.carrier ? `<p style="color:#6B7280;font-size:13px;margin-top:4px">via ${tracking.carrier}</p>` : ""}
      ` : ""}
    </div>
    <div style="text-align:center;margin-top:24px">
      <a href="https://${c.domain}/dashboard/myorders" class="btn">Track Order</a>
    </div>
  `);
}

export function welcomeEmail({ name, country }) {
  const c = country || getCountryByCode("NG");
  return emailShell(c, `
    <div style="text-align:center;margin-bottom:28px">
      <div style="font-size:48px;margin-bottom:12px">☕</div>
      <h2 style="font-size:24px;font-weight:700">Welcome to ${c.seo?.siteName || "I-Coffee"}!</h2>
      <p style="color:#6B7280;font-size:15px;margin-top:8px">Hi ${name || "Coffee Lover"}, your account is ready.</p>
    </div>
    <div class="card">
      <p style="font-size:14px;line-height:1.7;color:#4B5563">
        Explore our curated selection of premium coffees, machines and accessories — delivered in ${c.name}.
      </p>
    </div>
    <div style="text-align:center;margin-top:28px">
      <a href="https://${c.domain}/shop" class="btn">Start Shopping</a>
    </div>
  `);
}
