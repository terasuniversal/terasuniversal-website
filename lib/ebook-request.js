import { ebookLeadSchema, fieldErrors } from "./validation/schemas.ts";
import { EBOOK_MARKETING_TEXT_VERSION, EBOOK_PRIVACY_ACK_VERSION } from "./ebook-lead.js";

// W9-G1 eBook request logic, kept free of Next.js and Supabase imports so it can be tested with plain node:test. The
// route (app/api/ebook/route.js) checks the launch switch first, then passes the parsed body and two dependencies:
//   rateLimit(): Promise<boolean>   shared limiter per hashed client (lib/rate-limit.js), fail-closed
//   submit(args): Promise<{ data, error }>   the CRM RPC submit_ebook_request through the RLS-bound server client
// Order: origin → honeypot / fill time → Zod → rate limit → RPC. Responses never echo database errors, and logs never
// contain the name, phone, email or token.
const MIN_FILL_TIME_MS = 2500;
const GENERIC_FAILURE = "We could not process your request right now. Please try again later.";
const RATE_LIMITED = "Too many requests. Please try again later.";

const fail = (status, error, extra) => ({ status, body: { error, ...extra } });

export async function processEbookRequest({ payload, origin, siteOrigin, now = Date.now() }, { rateLimit, submit, log = console.error }) {
  if (origin && origin !== siteOrigin) return fail(403, "Invalid request origin.");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fail(400, "Invalid request.");

  // Honeypot: real visitors never fill it. Answer like a success without issuing anything, so bots learn nothing.
  if (String(payload.website ?? "").trim()) return { status: 200, body: { ok: true } };
  if (payload.formStartedAt && now - Number(payload.formStartedAt) < MIN_FILL_TIME_MS) {
    return fail(400, "Please take a moment to review the form before submitting.");
  }

  const parsed = ebookLeadSchema.safeParse({
    fullName: payload.fullName,
    phone: payload.phone,
    email: payload.email,
    privacyAck: payload.privacyAck,
    marketingEmailOptIn: payload.marketingEmailOptIn ?? false,
  });
  if (!parsed.success) return fail(400, "Please check the highlighted fields.", { errors: fieldErrors(parsed.error) });
  const data = parsed.data;

  if (!(await rateLimit())) return fail(429, RATE_LIMITED);

  const { data: issued, error } = await submit({
    p_full_name: data.fullName,
    p_phone_e164: data.phone,
    p_email: data.email,
    p_privacy_ack: true,
    p_privacy_ack_version: EBOOK_PRIVACY_ACK_VERSION,
    p_marketing_email_opt_in: data.marketingEmailOptIn,
    p_marketing_text_version: EBOOK_MARKETING_TEXT_VERSION,
  });
  if (error) {
    if (String(error.message ?? "").includes("rate_limited")) return fail(429, RATE_LIMITED);
    log("eBook request failed", { code: error.code ?? "unknown" });
    return fail(502, GENERIC_FAILURE);
  }
  const row = Array.isArray(issued) ? issued[0] : issued;
  if (!row || typeof row.token !== "string" || !row.token) {
    log("eBook request returned no delivery reference");
    return fail(502, GENERIC_FAILURE);
  }
  return { status: 200, body: { ok: true, delivery: { token: row.token, expiresAt: row.expires_at ?? null } } };
}
