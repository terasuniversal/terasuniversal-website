import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { checkSharedRateLimit, hashedClientId } from "../../../lib/rate-limit";
import { ebookPublicEnabled } from "../../../lib/ebook-lead";
import { processEbookRequest } from "../../../lib/ebook-request";

// W9-G1 eBook lead capture (local implementation; launch switch OFF). The switch is checked before anything else, so
// with TERAS_EBOOK_PUBLIC unset (or any value other than "on") this route is a plain 404 and reads nothing. The logic
// lives in lib/ebook-request.js; the CRM RPC submit_ebook_request (SECURITY DEFINER, owned by CRM, see the W9-D0
// handoff) deduplicates by email and phone, never overrides an opted-out contact, records consent versions and time,
// and returns a single-use download token whose hash only is stored. No service role, no email, no PII in logs.
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

function clientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  return (forwarded ? forwarded.split(",")[0] : request.headers.get("x-real-ip") || "unknown").trim();
}

// Any other method answers 404 too, so the route does not reveal itself (405) while the switch is off.
export function GET() {
  return new NextResponse(null, { status: 404 });
}
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;

export async function POST(request) {
  if (!ebookPublicEnabled()) return new NextResponse(null, { status: 404 });

  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: NO_STORE });
  }
  const { status, body } = await processEbookRequest(
    { payload, origin: request.headers.get("origin"), siteOrigin: new URL(request.url).origin },
    {
      rateLimit: () => checkSharedRateLimit({ key: `ebook:client:${hashedClientId(clientIp(request))}`, windowSeconds: 3600, maxAttempts: 10, failClosed: true }),
      submit: async (args) => (await createSupabaseServerClient()).rpc("submit_ebook_request", args),
    },
  );
  return NextResponse.json(body, { status, headers: NO_STORE });
}
