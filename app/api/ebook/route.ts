import { NextResponse } from "next/server";
import { checkSharedRateLimit } from "../../../lib/rate-limit";
import { clientIp, isAllowedOrigin } from "../../../lib/public-registration";
import { isEbookCaptureEnabled } from "../../../lib/marketing/ebookFlag";
import { createSupabaseServiceClient } from "../../../lib/supabase/server";
import {
  CONSENT_TEXT_VERSION,
  PRIVACY_NOTICE_VERSION,
  captureErrorMessage,
  ebookLeadSchema,
  emailRateKeyPart,
  fillTimeStatus,
  sanitizeUtm,
} from "../../../lib/marketing/ebookCapture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4 * 1024;
const NO_STORE = { "Cache-Control": "no-store" };

function respond(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * Public /ebook lead capture. Order: feature flag, origin, size and type, shared per-IP rate limit, body
 * validation, honeypot, minimum fill time, shared per-email rate limit, then ONE security-definer RPC.
 *
 * A failed capture never reports success. The response never says whether the contact already existed
 * (no contact enumeration), and no personal data goes into the URL, the logs or the response. The RPC is the
 * only write path and is EXECUTE-granted to service_role only, so this route (server-only, after every check above)
 * is the sole entrypoint: anon and authenticated callers cannot reach it directly. The service client is used for
 * that one RPC and nothing else. No download URL is returned: delivery is not active until the Owner approves storage.
 */
export async function POST(request: Request) {
  if (!isEbookCaptureEnabled()) return respond({ error: "Not found." }, 404);
  if (!isAllowedOrigin(request)) return respond({ error: "Invalid request origin." }, 403);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return respond({ error: "Invalid request." }, 415);
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) return respond({ error: "Invalid request." }, 413);

  // Shared, database-backed limiter (works across serverless instances). Fails CLOSED in production.
  if (!(await checkSharedRateLimit({ key: `ebook:ip:${clientIp(request)}`, windowSeconds: 60, maxAttempts: 5, failClosed: true }))) {
    return respond({ error: "Terlalu banyak percubaan. Sila tunggu sebentar dan cuba lagi." }, 429);
  }

  // Read the stream with a running byte count and stop at the cap, so a missing or false Content-Length cannot make the
  // server buffer an unbounded body.
  let text = "";
  try {
    const reader = request.body?.getReader();
    if (!reader) return respond({ error: "Invalid request." }, 400);
    const decoder = new TextDecoder();
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_BODY_BYTES) {
        await reader.cancel();
        return respond({ error: "Invalid request." }, 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    return respond({ error: "Invalid request." }, 400);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return respond({ error: "Invalid request." }, 400);
  }

  // Honeypot: a human never fills it. Answer like a success but store nothing (it tells a bot nothing).
  if (raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).website === "string" && ((raw as Record<string, unknown>).website as string).trim() !== "") {
    return respond({ ok: true, delivery: "not_active" });
  }

  const parsed = ebookLeadSchema.safeParse(raw);
  if (!parsed.success) {
    // Field names only: never echo submitted values.
    const fields = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "form")))];
    const needsAck = parsed.error.issues.some((issue) => issue.message === "privacy_acknowledgement_required");
    return respond(
      { error: needsAck ? "Sila sahkan bahawa anda telah membaca Notis Privasi." : "Sila semak maklumat borang dan cuba lagi.", fields },
      400,
    );
  }
  const input = parsed.data;

  const timing = fillTimeStatus(input.formStartedAt, Date.now());
  if (timing !== "ok") return respond({ error: "Sila ambil masa sebentar sebelum menghantar borang." }, 400);

  if (!(await checkSharedRateLimit({ key: `ebook:email:${await emailRateKeyPart(input.email)}`, windowSeconds: 3600, maxAttempts: 5, failClosed: true }))) {
    return respond({ error: "Terlalu banyak percubaan. Sila tunggu sebentar dan cuba lagi." }, 429);
  }

  let supabase;
  try {
    supabase = createSupabaseServiceClient();
  } catch {
    // Missing or invalid server configuration: fail closed with a generic message, never report success.
    console.error("ebook lead capture failed", { code: "server_client_unavailable" });
    return respond({ error: "Maaf, permintaan anda tidak dapat diproses sekarang. Sila cuba lagi sebentar nanti." }, 503);
  }
  let data: unknown;
  let error: { code?: string; message?: string } | null;
  try {
    ({ data, error } = await supabase.rpc("submit_public_ebook_lead", {
      p_email: input.email,
      p_full_name: input.full_name || null,
      p_phone: input.phone || null,
      p_ebook_id: input.ebook_id,
      p_privacy_acknowledged: input.privacy_acknowledged,
      p_privacy_notice_version: PRIVACY_NOTICE_VERSION,
      p_marketing_opt_in: input.marketing_opt_in,
      p_consent_text_version: CONSENT_TEXT_VERSION,
      p_utm: sanitizeUtm(input.utm),
      p_request_id: input.request_id,
    }));
  } catch {
    // A transport failure (network, timeout): fixed code only, same generic failure, never a success.
    console.error("ebook lead capture failed", { code: "rpc_exception" });
    return respond({ error: "Kami tidak dapat merekod permintaan anda sekarang. Sila cuba lagi sebentar lagi." }, 502);
  }

  if (error || !data || typeof data !== "object") {
    // The error code only: never the message body, the submitted values or any row data.
    console.error("ebook lead capture failed", { code: error?.code ?? "no_data" });
    const mapped = captureErrorMessage(error?.message ?? "");
    return respond({ error: mapped.message }, mapped.status);
  }

  // Identical for a new contact, a matched contact and a retried request.
  return respond({ ok: true, delivery: "not_active" });
}
