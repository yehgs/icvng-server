// server/services/marketing/sender.js
//
// Resumable, claim-based bulk sender.
//
// WHY BATCHED + CLAIM-BASED: the API runs on Cloud Run, which throttles CPU once a
// response has been sent — a long fire-and-forget loop can silently stall. So a send is
// a sequence of short batches, each driven by an HTTP request (the admin UI keeps
// calling /process-batch while it is open; MARKETING_BACKGROUND_SEND=true additionally
// lets the server keep going on hosts that allow it). Every recipient is claimed
// atomically (PENDING → SENDING), so overlapping workers can never double-send, and a
// crashed batch is picked up again after STALE_CLAIM_MS.
import MarketingEmailModel from "../../models/marketing-email.model.js";
import RecipientModel from "../../models/marketing-recipient.model.js";
import ProductModel from "../../models/product.model.js";
import { sendCountryEmail } from "../../config/emailService.js";
import { buildMarketingEmailHtml, buildUnsubscribeUrl, personalize } from "./template.js";
import { getCountryByCode } from "../../config/countries/index.js";

const STALE_CLAIM_MS = 2 * 60 * 1000;
export const BATCH_SIZE = () => Math.min(Number(process.env.MARKETING_BATCH_SIZE) || 20, 100);
const CONCURRENCY = () => Math.max(1, Math.min(Number(process.env.MARKETING_SEND_CONCURRENCY) || 2, 10));
const WAVE_DELAY_MS = () => (process.env.MARKETING_SEND_DELAY_MS !== undefined ? Number(process.env.MARKETING_SEND_DELAY_MS) : 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function loadFeaturedProducts(campaign) {
  const ids = campaign.template?.productIds || [];
  if (!ids.length) return [];
  const rows = await ProductModel.find({
    _id: { $in: ids },
    $or: [{ visibleInCountries: { $size: 0 } }, { visibleInCountries: { $exists: false } }, { visibleInCountries: campaign.countryCode }],
  }).select("name image").lean();
  const byId = new Map(rows.map((p) => [String(p._id), p]));
  return ids.map((id) => byId.get(String(id))).filter(Boolean).map((p) => ({ _id: p._id, name: p.name, image: p.image?.[0] || "" }));
}

export const renderFor = (campaign, products, recipient) =>
  buildMarketingEmailHtml({
    countryCode: campaign.countryCode,
    campaign,
    products,
    recipient,
    unsubscribeUrl: buildUnsubscribeUrl(recipient.email || "preview@example.com", campaign.countryCode),
  });

/** Recount from the recipient rows (source of truth) and close the campaign when nothing is left. */
export async function refreshStats(campaignId) {
  const rows = await RecipientModel.aggregate([{ $match: { marketingEmailId: campaignId } }, { $group: { _id: "$status", n: { $sum: 1 } } }]);
  const c = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  const stats = {
    total: Object.values(c).reduce((a, b) => a + b, 0),
    sent: c.SENT || 0, failed: c.FAILED || 0, skipped: c.SKIPPED || 0,
    pending: (c.PENDING || 0) + (c.SENDING || 0),
  };
  const patch = { stats };
  if (stats.pending === 0 && stats.total > 0) {
    patch.status = stats.sent === 0 && stats.failed > 0 ? "FAILED" : "SENT";
    patch.sendCompletedAt = new Date();
  }
  const doc = await MarketingEmailModel.findOneAndUpdate({ _id: campaignId, status: "SENDING" }, { $set: patch }, { new: true });
  return doc || (await MarketingEmailModel.findById(campaignId));
}


/** Atomically claim up to `limit` recipients of one campaign. */
async function claim(campaignId, limit) {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);
  const claimed = [];
  while (claimed.length < limit) {
    const r = await RecipientModel.findOneAndUpdate(
      { marketingEmailId: campaignId, $or: [{ status: "PENDING" }, { status: "SENDING", claimedAt: { $lt: staleBefore } }], attempts: { $lt: 3 } },
      { $set: { status: "SENDING", claimedAt: new Date() }, $inc: { attempts: 1 } },
      { new: true },
    );
    if (!r) break;
    claimed.push(r);
  }
  return claimed;
}

/** Process ONE batch. Safe to call repeatedly and concurrently. */
export async function processBatch(campaignId, { limit = BATCH_SIZE() } = {}) {
  const campaign = await MarketingEmailModel.findById(campaignId).lean();
  if (!campaign) return { done: true, campaign: null, processed: 0 };
  if (campaign.status !== "SENDING") return { done: true, campaign, processed: 0 };

  const products = await loadFeaturedProducts(campaign);
  const rows = await claim(campaign._id, limit);
  const siteName = getCountryByCode(campaign.countryCode)?.seo?.siteName || "";
  let processed = 0;

  for (let i = 0; i < rows.length; i += CONCURRENCY()) {
    const wave = rows.slice(i, i + CONCURRENCY());
    await Promise.all(wave.map(async (row) => {
      try {
        const html = renderFor(campaign, products, row);
        const res = await sendCountryEmail({
          countryCode: campaign.countryCode,
          sendTo: row.email,
          subject: personalize(campaign.subject, { name: row.name, shopName: siteName }),
          html,
        });
        if (res?.suppressed) await RecipientModel.updateOne({ _id: row._id }, { $set: { status: "SKIPPED", error: "sending disabled by provider settings" } });
        else await RecipientModel.updateOne({ _id: row._id }, { $set: { status: "SENT", sentAt: new Date(), messageId: res?.messageId || "", error: "" } });
      } catch (err) {
        // retry up to 3 attempts (a transient provider error), then FAILED for good
        const final = row.attempts >= 3;
        await RecipientModel.updateOne({ _id: row._id }, { $set: { status: final ? "FAILED" : "PENDING", error: String(err.message || err).slice(0, 300), claimedAt: null } });
      }
      processed++;
    }));
    if (i + CONCURRENCY() < rows.length && WAVE_DELAY_MS() > 0) await sleep(WAVE_DELAY_MS());
  }

  const fresh = await refreshStats(campaign._id);
  return { done: fresh?.status !== "SENDING", campaign: fresh, processed };
}

/** Optional server-side driver (MARKETING_BACKGROUND_SEND=true). The UI loop works without it. */
export function kickBackground(campaignId) {
  if (process.env.MARKETING_BACKGROUND_SEND !== "true") return;
  setImmediate(async () => {
    try {
      for (let i = 0; i < 5000; i++) {
        const { done, processed } = await processBatch(campaignId);
        if (done || processed === 0) break;
      }
    } catch (e) { console.error("[marketing] background send stopped:", e.message); }
  });
}
