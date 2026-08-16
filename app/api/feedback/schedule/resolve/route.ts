import { createHmac } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { normalizeIdentityNumber } from "../../../../../lib/identity";
import { createSupabaseServiceClient } from "../../../../../lib/supabase/server";

const NEUTRAL_ERROR = "We couldn't match these details to an eligible participant for this training session.";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

function requestFingerprint(request: NextRequest, publicToken: string): string | null {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  const forwardedFor = request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-forwarded-for") ?? "unknown";
  const clientIp = forwardedFor.split(",")[0]?.trim() || "unknown";
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  return createHmac("sha256", secret).update(`${publicToken}|${clientIp}|${userAgent}`).digest("hex");
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { publicToken?: unknown; identityNumber?: unknown } | null;
  const publicToken = typeof body?.publicToken === "string" ? body.publicToken : "";
  const rawIdentity = typeof body?.identityNumber === "string" ? body.identityNumber : "";
  const normalizedIdentity = normalizeIdentityNumber(rawIdentity);
  const fingerprint = requestFingerprint(request, publicToken);

  if (!TOKEN_PATTERN.test(publicToken) || normalizedIdentity.length < 3 || normalizedIdentity.length > 80 || !fingerprint) {
    return NextResponse.json({ error: NEUTRAL_ERROR }, { status: 400 });
  }

  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc("resolve_schedule_feedback_participant", {
    p_public_token: publicToken,
    p_identity_number: normalizedIdentity,
    p_request_fingerprint_hash: fingerprint,
  });

  // Never log raw submitted identity or return different public errors for
  // throttled, invalid, cross-schedule, or unmatched lookups.
  if (error || !data?.[0]?.feedback_token) {
    if (error) console.error("schedule feedback lookup failed", { code: error.code });
    return NextResponse.json({ error: NEUTRAL_ERROR }, { status: 400 });
  }

  return NextResponse.json({ redirectTo: `/feedback/${data[0].feedback_token}` });
}
