import { APEX_ORIGIN, WWW_ORIGIN } from "./canonical-origin.js";

// W9-LAUNCH-PREP L-B/B1: the ONE place that decides the origin of eBook verification links (and the origin the eBook
// request route accepts). It never looks at request.url, the Host header or any forwarding header: an email link must
// point at the approved public site even if the request reached us through another alias. The value comes from the
// approved TERAS_CANONICAL_ORIGIN and is validated for the deployment target; anything else fails closed (the route
// answers 503 before DNS, RPC or email).
//   production       exactly https://www.terasuniversal.com.my or https://terasuniversal.com.my
//   preview / custom https on this project's own Vercel hosts (*-terasuniversal-my.vercel.app), for Staging QA only
//   local            http://localhost:<port> or http://127.0.0.1:<port> (local QA)
//   anything else    rejected
const PREVIEW_HOST = /^terasuniversal-website-[a-z0-9-]+-terasuniversal-my\.vercel\.app$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function resolveEbookLinkOrigin({ target, value }) {
  if (typeof value !== "string" || !value) return { ok: false, reason: "origin_missing" };
  let url;
  try { url = new URL(value); } catch { return { ok: false, reason: "origin_invalid" }; }
  // Exact origin only: no path, query, fragment, credentials or trailing slash.
  if (url.origin !== value || url.username || url.password) return { ok: false, reason: "origin_invalid" };
  if (target === "production") {
    return value === WWW_ORIGIN || value === APEX_ORIGIN ? { ok: true, origin: value } : { ok: false, reason: "origin_not_approved" };
  }
  if (target === "preview" || target === "custom") {
    return url.protocol === "https:" && !url.port && PREVIEW_HOST.test(url.hostname) ? { ok: true, origin: value } : { ok: false, reason: "origin_not_approved" };
  }
  if (target === "local") {
    return url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname) ? { ok: true, origin: value } : { ok: false, reason: "origin_not_approved" };
  }
  return { ok: false, reason: "target_not_supported" };
}
