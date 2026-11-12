// server/services/hr/common.js — small pure helpers shared by the HR services/controllers.
import { getCountryByCode } from "../../config/countries/index.js";

export const isDateStr = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
export const isPeriod = (s) => typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
/** "YYYY-MM-DD" → Date (UTC midnight) or null */
export const toDate = (s) => (isDateStr(s) ? new Date(s + "T00:00:00Z") : null);
export const dateToStr = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const escRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const countryTimezone = (code) => getCountryByCode(code)?.timezone || "Africa/Lagos";
export const countryCurrency = (code) => getCountryByCode(code)?.currency || { code: "NGN", symbol: "₦", decimals: 2 };

/** Local calendar day (YYYY-MM-DD) in an IANA timezone. */
export function localDate(date = new Date(), timeZone = "Africa/Lagos") {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

const dow = (s) => new Date(s + "T00:00:00Z").getUTCDay();
export const isWeekend = (s) => [0, 6].includes(dow(s));
export function* eachDay(from, to) {
  const end = Date.parse(to + "T00:00:00Z");
  for (let t = Date.parse(from + "T00:00:00Z"); t <= end; t += 86400000) yield new Date(t).toISOString().slice(0, 10);
}
/** Mon–Fri days in [from,to] that are not in `holidays` (Set of YYYY-MM-DD). Capped at 400 days. */
export function workingDays(from, to, holidays = new Set()) {
  const out = [];
  let guard = 0;
  for (const d of eachDay(from, to)) {
    if (++guard > 400) break;
    if (!isWeekend(d) && !holidays.has(d)) out.push(d);
  }
  return out;
}
export const periodBounds = (period) => {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, "0")}` };
};

// ── money: integer minor units everywhere in payroll ──
export const toMinor = (major, decimals = 2) => Math.round((Number(major) || 0) * 10 ** decimals + 1e-9);
export const fromMinor = (minor, decimals = 2) => (Number(minor) || 0) / 10 ** decimals;
export const fmtMoney = (minor, decimals = 2, code = "") => {
  const s = fromMinor(minor, decimals).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return code ? `${code} ${s}` : s;
};
export const maskAccount = (last4) => (last4 ? `••••${last4}` : "");
