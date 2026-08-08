import { headers } from "next/headers";

/** Best-effort site origin for building absolute URLs (verification links, QR targets, etc.). */
export async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto") || "https";
  return host ? `${proto}://${host}` : (process.env.NEXT_PUBLIC_SITE_URL || "https://terasuniversal.com.my");
}
