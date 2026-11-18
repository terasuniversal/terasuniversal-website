import { CANONICAL_ORIGIN } from "../lib/canonical-origin";
export default function robots() {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${CANONICAL_ORIGIN}/sitemap.xml`,
    host: CANONICAL_ORIGIN,
  };
}
