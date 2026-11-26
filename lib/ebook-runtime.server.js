import { promises as dnsPromises } from "node:dns";
import { Resend } from "resend";
import { createSupabaseServiceClient } from "./supabase/server";
import { resolveDeploymentTarget, validatePrivilegedSupabaseConfig } from "./preview-isolation";
import { hashedClientId } from "./rate-limit";
import { makeEbookBackend } from "./ebook-privileged.server.js";
import { makeMockMailer, makeResendMailer } from "./ebook-mailer.js";
import { checkEmailDomain } from "./email-dns.js";
import { ebookVerifyUrl } from "./ebook-verify-link.js";
import { resolveEbookLinkOrigin } from "./ebook-link-origin.js";

// W9-G3 runtime wiring for the eBook route handlers only (server-only; never imported by a client component). Builds the
// real dependencies for lib/ebook-request.js:
//   backend   privileged module behind the Preview isolation guard (service role used only there)
//   mailer    Resend, unless TERAS_EBOOK_MAILER=mock on a LOCAL target (local QA; never honoured on Vercel)
//   checkDomain  node:dns with a 10-minute per-instance cache of definite answers
if (typeof window !== "undefined") throw new Error("ebook runtime is server-only");

const domainCache = new Map();
const resolver = {
  resolveMx: (d) => dnsPromises.resolveMx(d),
  resolve4: (d) => dnsPromises.resolve4(d),
  resolve6: (d) => dnsPromises.resolve6(d),
};

export function ebookRuntime(request) {
  // W9-LAUNCH-PREP L-B/B1: links and the accepted request origin come from the validated TERAS_CANONICAL_ORIGIN only,
  // never from request.url or forwarding headers. null (fail closed) when it is missing or not approved for the target.
  const { target } = resolveDeploymentTarget();
  const linkOrigin = resolveEbookLinkOrigin({ target, value: process.env.TERAS_CANONICAL_ORIGIN });
  const siteOrigin = linkOrigin.ok ? linkOrigin.origin : null;
  const local = target === "local";
  const mailer = local && process.env.TERAS_EBOOK_MAILER === "mock"
    ? makeMockMailer()
    : makeResendMailer({ apiKey: process.env.RESEND_API_KEY, from: process.env.RESEND_FROM_EMAIL?.trim(), ResendCtor: Resend });
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = (forwarded ? forwarded.split(",")[0] : request.headers.get("x-real-ip") || "unknown").trim();
  return {
    siteOrigin,
    clientKey: hashedClientId(ip),
    deps: {
      backend: makeEbookBackend({ validate: () => validatePrivilegedSupabaseConfig(), createClient: () => createSupabaseServiceClient() }),
      mailer,
      checkDomain: (email) => checkEmailDomain(email, { resolver, cache: domainCache }),
      verifyUrlFor: (token) => ebookVerifyUrl(siteOrigin, token),
    },
  };
}
