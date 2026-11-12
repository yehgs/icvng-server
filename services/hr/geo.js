// server/services/hr/geo.js — distance + best-effort reverse geocoding for office check-ins.
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
export function distanceMeters(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}
export const validCoords = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/** Street address for a coordinate (OpenStreetMap Nominatim). Never throws; returns "" on any failure. */
export async function reverseGeocode(lat, lng) {
  if (process.env.HR_REVERSE_GEOCODE === "off") return "";
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), Number(process.env.HR_GEOCODE_TIMEOUT_MS || 2500));
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${lat}&lon=${lng}`, {
      signal: ctl.signal, headers: { "User-Agent": "icvng-hr/1.0 (attendance)", Accept: "application/json" },
    });
    if (!res.ok) return "";
    const j = await res.json();
    return String(j.display_name || "").slice(0, 300);
  } catch {
    return "";
  } finally {
    clearTimeout(t);
  }
}
