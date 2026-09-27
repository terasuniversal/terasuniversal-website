function getSupabaseOrigin() {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configuredUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be set to a valid Supabase project URL.");
  }

  let url;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be set to a valid Supabase project URL.");
  }

  const vercelEnv = process.env.VERCEL_ENV;
  const expectedHostname = vercelEnv === "production"
    ? "iagzkrzeuawaxvacqprk.supabase.co"
    : vercelEnv === "preview"
      ? "eokiaehnvzbggmacifcf.supabase.co"
      : null;

  if (
    url.protocol !== "https:" ||
    !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) ||
    (expectedHostname ? url.hostname !== expectedHostname : url.hostname === "iagzkrzeuawaxvacqprk.supabase.co") ||
    url.port ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid non-Production Supabase project origin.");
  }

  return url.origin;
}

const supabaseOrigin = getSupabaseOrigin();

const nextConfig = {
  reactStrictMode: true,
  images: {
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Content-Security-Policy", value: `default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; object-src 'none'; frame-src 'self' https://www.google.com; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self' ${supabaseOrigin} https://www.google-analytics.com https://region1.google-analytics.com` },
      ],
    }];
  },
};
export default nextConfig;
