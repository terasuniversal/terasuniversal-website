// C4A-6D: the Supabase host allowed in the CSP's connect-src must track
// whichever Supabase project THIS build is actually configured against
// (NEXT_PUBLIC_SUPABASE_URL -- already public by this project's own
// NEXT_PUBLIC_ convention, and already inlined into the client bundle at
// build time regardless of this check). This was previously a single
// hardcoded production host, so a Preview build correctly configured
// against staging still only had CSP permission to reach production --
// client-side Supabase calls (e.g. Topbar's sign-out) were silently
// CSP-blocked on any staging-bound Preview deployment.
//
// Fail-closed, explicit allowlist: only these two named project origins
// are ever permitted -- never an arbitrary third `*.supabase.co` host, and
// never a guess when configuration is missing/malformed/unrecognized. A
// build whose NEXT_PUBLIC_SUPABASE_URL doesn't exactly match either known
// origin gets NO Supabase entry in connect-src at all (client-side
// Supabase calls would be blocked outright, never silently routed to
// production) -- this can never "accidentally" authorize production for
// an unconfigured or staging build. A real production build already
// requires NEXT_PUBLIC_SUPABASE_URL to be set correctly for its own client
// bundle to work at all, so this is a no-op there, not a new requirement.
const KNOWN_SUPABASE_ORIGINS = Object.freeze({
  staging: "https://eokiaehnvzbggmacifcf.supabase.co",
  production: "https://iagzkrzeuawaxvacqprk.supabase.co",
});

function resolveSupabaseConnectSrc() {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configured) return "";
  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:") return "";
  const origin = `https://${parsed.host}`;
  return Object.values(KNOWN_SUPABASE_ORIGINS).includes(origin) ? origin : "";
}

const nextConfig = {
  reactStrictMode: true,
  images: {
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    const connectSrc = [
      "'self'",
      resolveSupabaseConnectSrc(),
      "https://www.google-analytics.com",
      "https://region1.google-analytics.com",
    ].filter(Boolean).join(" ");
    return [{
      source: "/(.*)",
      headers: [
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Content-Security-Policy", value: `default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; object-src 'none'; frame-src 'self' https://www.google.com; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src ${connectSrc}` },
      ],
    }];
  },
};
export default nextConfig;
