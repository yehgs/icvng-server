// server/services/marketing/audience.js
// Who receives a marketing e-mail: every customer of ONE country, de-duplicated by e-mail,
// minus anyone who unsubscribed / bounced. Country always comes from the campaign record
// (never from a request), so a scoped admin can't aim a send at another market.
import UserModel from "../../models/user.model.js";
import CustomerModel from "../../models/customer.model.js";
import SubscriberModel from "../../models/subscriber.model.js";
import SuppressionModel from "../../models/marketing-suppression.model.js";

const EMAIL_RX = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
export const isValidEmail = (e) => typeof e === "string" && e.length <= 254 && EMAIL_RX.test(e);
export const MAX_RECIPIENTS = () => Number(process.env.MARKETING_MAX_RECIPIENTS) || 20000;

/** @returns {Promise<{recipients:Array<{email,name,source}>, suppressed:number, invalid:number, bySource:object}>} */
export async function buildAudience(countryCode, audience = {}) {
  const sources = audience.sources?.length ? audience.sources : ["USERS", "CUSTOMERS", "SUBSCRIBERS"];
  const types = audience.customerTypes || [];
  const verifiedOnly = audience.verifiedOnly !== false;
  const map = new Map();
  const bySource = { USERS: 0, CUSTOMERS: 0, SUBSCRIBERS: 0 };
  let invalid = 0;
  const add = (email, name, source) => {
    const e = String(email || "").trim().toLowerCase();
    if (!isValidEmail(e)) { invalid++; return; }
    if (!map.has(e)) { map.set(e, { email: e, name: String(name || "").trim(), source }); bySource[source]++; }
  };

  if (sources.includes("USERS")) {
    const q = { role: "USER", countryCode, status: "Active" };
    if (verifiedOnly) q.verify_email = true;
    if (types.length) q.subRole = { $in: types };
    for (const u of await UserModel.find(q).select("email name").lean()) add(u.email, u.name, "USERS");
  }
  if (sources.includes("CUSTOMERS")) {
    const q = { countryCode };
    if (types.length) q.customerType = { $in: types };
    for (const c of await CustomerModel.find(q).select("email name").lean()) add(c.email, c.name, "CUSTOMERS");
  }
  if (sources.includes("SUBSCRIBERS") && !types.length) {
    for (const s of await SubscriberModel.find({ countryCode, isActive: true }).select("email").lean()) add(s.email, "", "SUBSCRIBERS");
  }

  const emails = [...map.keys()];
  let suppressed = 0;
  if (emails.length) {
    const rows = await SuppressionModel.find({ countryCode, email: { $in: emails } }).select("email").lean();
    for (const r of rows) { if (map.delete(r.email)) suppressed++; }
  }
  return { recipients: [...map.values()], suppressed, invalid, bySource };
}
