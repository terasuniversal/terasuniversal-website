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
 * (Participant Feedback) always resolve to the canonical TERAS domain
 * instead of whichever deployment URL happened to render the admin page.
 * Local/private-network hosts still resolve to themselves so local QA can
 * click through without needing DNS for the canonical domain.
 */
export async function canonicalSiteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host");
  const hostname = (host || "").replace(/^\[|\](?::\d+)?$|:\d+$/g, "");
  if (host && isLocalHostname(hostname)) {
    const proto = h.get("x-forwarded-proto") || "http";
    return `${proto}://${host}`;
  }
  return process.env.NEXT_PUBLIC_SITE_URL || "https://terasuniversal.com.my";
}
