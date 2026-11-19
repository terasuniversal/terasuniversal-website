// Public-First launch (F-5 preparation): the ONE place that decides the public canonical host used by metadataBase,
// Open Graph URLs, JSON-LD, the sitemap and robots.txt.
//
// The owner prefers https://www.terasuniversal.com.my, but the live Vercel domain assignment and redirect have not
// been verified yet, so the default stays the current apex host and nothing changes until it is switched on purpose.
// Switch (after the www host is confirmed to serve Production and the apex 301-redirects to it): set
// TERAS_CANONICAL_ORIGIN=https://www.terasuniversal.com.my at build time and redeploy. Any other value keeps the apex.
// lib/site-origin.ts (payment return/callback URLs) is intentionally separate and is not affected by this setting.
export const APEX_ORIGIN = "https://terasuniversal.com.my";
export const WWW_ORIGIN = "https://www.terasuniversal.com.my";
export const CANONICAL_ORIGIN = process.env.TERAS_CANONICAL_ORIGIN === WWW_ORIGIN ? WWW_ORIGIN : APEX_ORIGIN;
