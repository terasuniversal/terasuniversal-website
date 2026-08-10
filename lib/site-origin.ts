import { headers } from "next/headers";

/** Best-effort site origin for building absolute URLs (verification links, QR targets, etc.). */
export async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host");
  const hostname = (host || "").replace(/^\[|\](?::\d+)?$|:\d+$/g, "");
  const isLocalPreview =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hostname);
  const proto = h.get("x-forwarded-proto") || (isLocalPreview ? "http" : "https");
  return host ? `${proto}://${host}` : (process.env.NEXT_PUBLIC_SITE_URL || "https://terasuniversal.com.my");
}
