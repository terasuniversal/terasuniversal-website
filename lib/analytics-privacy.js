// Analytics URL privacy (S5B-1B Round 2; S5B-0 PAY-04). Pure functions, no browser APIs, so they can be unit-tested
// by scripts/s5b1b-round2-contract.mts.
//
// 1. Untracked routes: analytics never loads and never sends on these paths. They carry payment attempt ids,
//    registration references, certificate references or feedback tokens (in the query string or in the path), and
//    the admin area must not be tracked by the public site.
// 2. Every other URL is reduced to origin + path, keeping only campaign parameters (utm_*). Search terms (?q=),
//    identifiers and any other query value are dropped. Fragments are dropped.
export const UNTRACKED_PREFIXES = ["/admin", "/payments", "/registration", "/verify", "/feedback"];

export function isUntrackedPath(pathname) {
  const path = typeof pathname === "string" ? pathname : "";
  return UNTRACKED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

const SAFE_PARAMS = /^utm_(source|medium|campaign|term|content|id)$/;

export function sanitizeAnalyticsUrl(href, base) {
  let url;
  try { url = new URL(href, base); } catch { return ""; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  if (isUntrackedPath(url.pathname)) return `${url.origin}${UNTRACKED_PREFIXES.find((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))}`;
  const kept = new URLSearchParams();
  for (const [key, value] of url.searchParams) if (SAFE_PARAMS.test(key)) kept.append(key, value.slice(0, 100));
  const query = kept.toString();
  return `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;
}

// Referrers from other sites are reduced to their origin; same-site referrers are sanitised like page URLs.
export function sanitizeReferrer(referrer, siteOrigin) {
  if (!referrer) return "";
  let url;
  try { url = new URL(referrer); } catch { return ""; }
  return url.origin === siteOrigin ? sanitizeAnalyticsUrl(referrer) : url.origin;
}
