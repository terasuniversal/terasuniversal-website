import { NextResponse } from "next/server";
import { ebookPublicEnabled } from "../../../lib/ebook-lead";
import { processEbookRequest } from "../../../lib/ebook-request";
import { ebookRuntime } from "../../../lib/ebook-runtime.server";

// W9-G3 eBook request (W9-EBOOK-RPC-CONTRACT v1.0; launch switch OFF). The switch is checked before anything else, so
// with TERAS_EBOOK_PUBLIC unset (or any value other than "on") this route is a plain 404 and reads nothing. Logic:
// lib/ebook-request.js. The CRM RPC submit_ebook_request (service_role only) is reached solely through the server-only
// privileged module behind the Preview isolation guard; it deduplicates, never overwrites an existing contact or an
// opt-out, reserves the shared email quota and issues a hashed, single-use verification token. No PII in logs.
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

// Any other method answers 404 too, so the route does not reveal itself (405) while the switch is off.
export function GET() {
  return new NextResponse(null, { status: 404 });
}
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
// W9-G2.1: Next.js answers OPTIONS automatically (204 with an Allow header) when a route does not export it, which
// would reveal the route and its methods; it is pinned to the same 404.
export const OPTIONS = GET;

export async function POST(request) {
  if (!ebookPublicEnabled()) return new NextResponse(null, { status: 404 });

  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: NO_STORE });
  }
  const { siteOrigin, clientKey, deps } = ebookRuntime(request);
  const { status, body } = await processEbookRequest({ payload, origin: request.headers.get("origin"), siteOrigin, clientKey }, deps);
  return NextResponse.json(body, { status, headers: NO_STORE });
}
