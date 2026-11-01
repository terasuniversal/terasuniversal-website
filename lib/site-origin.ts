import { headers } from "next/headers";

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hostname)
  );
}

/** Best-effort site origin for building absolute URLs (verification links, QR targets, etc.). */
export async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host");
  const hostname = (host || "").replace(/^\[|\](?::\d+)?$|:\d+$/g, "");
  const proto = h.get("x-forwarded-proto") || (isLocalHostname(hostname) ? "http" : "https");
  return host ? `${proto}://${host}` : (process.env.NEXT_PUBLIC_SITE_URL || "https://terasuniversal.com.my");
}

/**
 * Canonical, participant-facing site origin — for links that must stay
 * identical no matter which hostname staff used to reach the admin panel
 * (custom domain, a Vercel preview alias, a raw *.vercel.app deployment
 * URL). Unlike siteOrigin(), this never reflects the request's Host header
 * back to the caller outside of local development, so public-facing links
 * (Participant Feedback, certificate QR/verification links) always resolve
 * to the canonical TERAS domain instead of whichever deployment URL
 * happened to render the admin page. Local/private-network hosts still
 * resolve to themselves so local QA can click through without needing DNS
 * for the canonical domain.
 *
 * The hardcoded "https://terasuniversal.com.my" fallback below is only
 * ever used for a genuine Vercel production deployment (VERCEL_ENV ===
 * "production") that hasn't set NEXT_PUBLIC_SITE_URL -- it must never be
 * the fallback for a Preview deployment or any other non-production
 * environment, or every certificate/feedback/payment link rendered there
 * would silently and incorrectly claim to be the live production site.
 * VERCEL_ENV is set automatically by Vercel on every deployment (including
 * Preview), so no extra configuration is required for this check to work.
 */
export async function canonicalSiteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host");
  const hostname = (host || "").replace(/^\[|\](?::\d+)?$|:\d+$/g, "");
  if (host && isLocalHostname(hostname)) {
    const proto = h.get("x-forwarded-proto") || "http";
    return `${proto}://${host}`;
  }
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  // Two independent positive signals for "this really is production", never
  // assumed by absence of information: Vercel's own VERCEL_ENV, or (for a
  // non-Vercel/self-hosted deploy, where VERCEL_ENV is never set at all)
  // NODE_ENV=production with no VERCEL_ENV present. A Vercel Preview build
  // also has NODE_ENV=production, so NODE_ENV alone is never trusted here.
  const isConfirmedProduction =
    process.env.VERCEL_ENV === "production" ||
    (!process.env.VERCEL_ENV && process.env.NODE_ENV === "production");
  if (isConfirmedProduction) return "https://terasuniversal.com.my";
  // Preview/staging with no explicit NEXT_PUBLIC_SITE_URL: fall back to
  // reflecting the actual request host rather than guessing wrong. Not
  // "canonical" in the strict sense, but never falsely production.
  if (host) {
    const proto = h.get("x-forwarded-proto") || "https";
    return `${proto}://${host}`;
  }
  // No Host header at all: unreachable in real traffic (headers() only
  // runs inside live request handling, where Host is mandatory per
  // HTTP/1.1+), but if it ever happened, still never guess production
  // without one of the two positive signals above.
  return "http://localhost:3000";
}
