/**
 * services/chat/chatScope.js — WHO may see/manage WHICH conversations (pure, unit-tested).
 *
 *   IT, DIRECTOR                      → every country
 *   country-scoped (foreign) admin    → only their assigned country
 *   any other HQ role (GLOBAL scope)  → only the HQ country's chats
 *
 * Mirrors the app-wide rule: HQ_ONLY_SUBROLES are never country-scoped (their
 * stored scope may be stale), see config/roles.js + middleware/countryScope.js.
 */
import { HQ_ONLY_SUBROLES } from "../../config/roles.js";

export const ALL_COUNTRIES_ROLES = ["IT", "DIRECTOR"];

/** Which role "desk(s)" an escalation target maps to (who it is *for*). */
export const DESK_ROLES = {
  SALES: ["SALES", "SALES_MANAGER"],
  MANAGER: ["MANAGER"],
  IT: ["IT"],
  DIRECTOR: ["DIRECTOR"],
};

export function seesAllCountries(user) {
  return !!user && ALL_COUNTRIES_ROLES.includes(user.subRole);
}

/** The single country a user is confined to, or null when they see all. */
export function chatCountryFor(user, hqCode = "NG") {
  if (!user || user.role !== "ADMIN") return "__none__";
  if (seesAllCountries(user)) return null;
  const hqOnly = HQ_ONLY_SUBROLES.includes(user.subRole);
  if (!hqOnly && user.scope === "COUNTRY" && user.assignedCountry) return user.assignedCountry;
  return hqCode;
}

/** Mongo filter for a conversation list/query. */
export function chatScopeFilter(user, hqCode = "NG") {
  const c = chatCountryFor(user, hqCode);
  if (c === null) return {};
  return { countryCode: c };
}

export function canAccessConversation(user, conversation, hqCode = "NG") {
  const c = chatCountryFor(user, hqCode);
  return c === null || c === conversation.countryCode;
}

/** Is this admin one of the desk(s) an escalation is targeted at? (IT/DIRECTOR always are.) */
export function isTargetedAt(user, targetRole) {
  if (!user || !targetRole) return false;
  if (seesAllCountries(user)) return true;
  return (DESK_ROLES[targetRole] || []).includes(user.subRole);
}

/**
 * Notification audience for a conversation in `countryCode` escalated to
 * `targetRole`. Returns the createNotificationInternal option sets to fire:
 * foreign roles of THAT country (COUNTRY scope) + HQ roles when it is the HQ
 * country (HQ_ONLY scope) + IT/DIRECTOR (HQ scope, all countries).
 */
export function notificationAudiences({ countryCode, hqCode = "NG", targetRole = null }) {
  const desk = targetRole ? DESK_ROLES[targetRole] || [] : ["SALES", "SALES_MANAGER", "MANAGER"];
  const deskNoGlobal = desk.filter((r) => !ALL_COUNTRIES_ROLES.includes(r));
  const out = [];
  if (countryCode === hqCode) {
    out.push({ targetScope: "HQ_ONLY", targetRoles: [...new Set([...desk, "IT", "DIRECTOR"])] });
  } else {
    if (deskNoGlobal.length) out.push({ targetScope: "COUNTRY", targetCountry: countryCode, targetRoles: deskNoGlobal });
    // IT + DIRECTOR manage every country; they are always GLOBAL (HQ_ONLY scope).
    out.push({ targetScope: "HQ_ONLY", targetRoles: ["IT", "DIRECTOR"] });
  }
  return out;
}
