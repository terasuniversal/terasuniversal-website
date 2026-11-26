// Analytics URL privacy (S5B-1B Round 2; S5B-0 PAY-04). Pure functions, no browser APIs, so they can be unit-tested
// by scripts/s5b1b-round2-contract.mts.
//
// 1. Untracked routes: analytics never loads and never sends on these paths. They carry payment attempt ids,
//    registration references, certificate references or feedback tokens (in the query string or in the path), and
//    the admin area must not be tracked by the public site. W9-LAUNCH-PREP L-B/B2: /ebook/verify (eBook email
//    verification; the token travels in the fragment) is excluded exactly, before any analytics is ever switched on.
//    A-1 (Owner technical GO): /api (the eBook request, verify and download endpoints and every other API route) is
//    never a tracked page or a tracked link destination; it collapses to "/api" like the other sensitive prefixes.
// 2. Every other URL is reduced to origin + path, keeping only campaign parameters (utm_*). Search terms (?q=),
//    identifiers and any other query value are dropped. Fragments are dropped. A-1: a utm_* value that looks like an
//    e-mail address, a phone number, a URL (e.g. a signed Storage link) or a token is dropped as well.
export const UNTRACKED_PREFIXES = ["/admin", "/payments", "/registration", "/verify", "/feedback", "/ebook/verify", "/api"];

export function isUntrackedPath(pathname) {
  const path = typeof pathname === "string" ? pathname : "";
  return UNTRACKED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

const SAFE_PARAMS = /^utm_(source|medium|campaign|term|content|id)$/;
// A-1: campaign values are short labels; anything shaped like personal data or a credential never leaves the page.
const SENSITIVE_VALUE = /@|%40|https?:|\/\/|[A-Za-z0-9_-]{24,}/i;
const looksSensitive = (value) => SENSITIVE_VALUE.test(value) || value.replace(/[\s().+-]/g, "").replace(/\D/g, "").length >= 7;

export function sanitizeAnalyticsUrl(href, base) {
  let url;
  try { url = new URL(href, base); } catch { return ""; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  if (isUntrackedPath(url.pathname)) return `${url.origin}${UNTRACKED_PREFIXES.find((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))}`;
  const kept = new URLSearchParams();
  for (const [key, value] of url.searchParams) if (SAFE_PARAMS.test(key) && !looksSensitive(value)) kept.append(key, value.slice(0, 100));
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
