// server/services/hr/branding.js — a country can keep several logos and signatures; every downloadable HR
// document (payroll, staff form, staff details…) lets HR pick which one to use. The legacy single
// logoUrl / signatureUrl / signerName / signerTitle fields mirror the DEFAULT entries so older code keeps working.
import mongoose from "mongoose";

export const MAX_BRANDING_ITEMS = 10;
const httpsUrl = (u) => typeof u === "string" && /^https:\/\/\S+$/i.test(u) && u.length <= 500;
const clean = (s, n) => String(s ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);

/** Logos as the API returns them: saved list, or the legacy single logo presented as the one default entry. */
export function listLogos(settings = {}) {
  if (settings.logos?.length) return settings.logos.map((l) => ({ _id: String(l._id), label: l.label, url: l.url, isDefault: !!l.isDefault }));
  return settings.logoUrl ? [{ _id: "legacy-logo", label: "Company logo", url: settings.logoUrl, isDefault: true }] : [];
}
export function listSignatures(settings = {}) {
  if (settings.signatures?.length) return settings.signatures.map((s) => ({ _id: String(s._id), label: s.label, url: s.url, signerName: s.signerName || "", signerTitle: s.signerTitle || "", isDefault: !!s.isDefault }));
  return settings.signatureUrl ? [{ _id: "legacy-signature", label: settings.signerName || "Authorised signature", url: settings.signatureUrl, signerName: settings.signerName || "", signerTitle: settings.signerTitle || "", isDefault: true }] : [];
}

/** The entry with `id`, else the default, else the first; `null` when none exist or `id` is unknown. */
function pick(list, id) {
  if (id) return list.find((x) => x._id === String(id)) || null;
  return list.find((x) => x.isDefault) || list[0] || null;
}
/** @returns {{logo: object|null, signature: object|null, error?: string}} — an explicit but unknown id is an error. */
export function resolveBranding(settings, { logoId, signatureId } = {}) {
  const logos = listLogos(settings), sigs = listSignatures(settings);
  const logo = pick(logos, logoId), signature = pick(sigs, signatureId);
  if (logoId && !logo) return { logo: null, signature, error: "Selected logo was not found" };
  if (signatureId && !signature) return { logo, signature: null, error: "Selected signature was not found" };
  return { logo, signature };
}

/** Validate/normalise the arrays sent by the settings screen. Returns { logos, signatures, errors }. */
export function normaliseBranding(body = {}) {
  const errors = [], out = {};
  const build = (arr, kind, extra) => {
    if (!Array.isArray(arr)) return undefined;
    if (arr.length > MAX_BRANDING_ITEMS) { errors.push(`At most ${MAX_BRANDING_ITEMS} ${kind}s`); return undefined; }
    const items = [];
    for (const x of arr) {
      const label = clean(x?.label, 60);
      if (!httpsUrl(x?.url)) { errors.push(`Each ${kind} needs an https image URL`); continue; }
      if (!label) { errors.push(`Each ${kind} needs a name (e.g. “Main logo”)`); continue; }
      const item = { label, url: x.url, isDefault: x.isDefault === true, ...extra(x) };
      if (x._id && mongoose.Types.ObjectId.isValid(x._id)) item._id = x._id;
      items.push(item);
    }
    if (items.length) {
      const first = items.findIndex((i) => i.isDefault);
      items.forEach((i, idx) => { i.isDefault = idx === (first === -1 ? 0 : first); }); // exactly one default
    }
    return items;
  };
  const logos = build(body.logos, "logo", () => ({}));
  const signatures = build(body.signatures, "signature", (x) => ({ signerName: clean(x.signerName, 100), signerTitle: clean(x.signerTitle, 100) }));
  if (logos) out.logos = logos;
  if (signatures) out.signatures = signatures;
  // keep the legacy single fields equal to the defaults
  if (logos) out.logoUrl = logos.find((l) => l.isDefault)?.url || "";
  if (signatures) {
    const d = signatures.find((s) => s.isDefault);
    out.signatureUrl = d?.url || ""; out.signerName = d?.signerName || ""; out.signerTitle = d?.signerTitle || "";
  }
  return { ...out, errors };
}
