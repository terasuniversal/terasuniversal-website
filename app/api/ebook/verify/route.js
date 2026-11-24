import { NextResponse } from "next/server";
import { ebookPublicEnabled } from "../../../../lib/ebook-lead";
import { processEbookVerify } from "../../../../lib/ebook-request";
import { ebookRuntime } from "../../../../lib/ebook-runtime.server";

// W9-G3 email ownership verification (W9-EBOOK-RPC-CONTRACT v1.0 §2.2, §4). Consumes the verification token ONLY on an
// explicit POST from the /ebook/verify page (the page's GET never calls this), so email security scanners that open the
// link cannot use it. Same-origin only. The download token is returned in the JSON body, never in a URL.
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export function GET() {
  return new NextResponse(null, { status: 404 });
}
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
export const OPTIONS = GET;

export async function POST(request) {
  if (!ebookPublicEnabled()) return new NextResponse(null, { status: 404 });
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: HEADERS });

  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ status: "link_unusable" }, { status: 200, headers: HEADERS });
  }
  const { deps } = ebookRuntime(request);
  const { status, body } = await processEbookVerify({ token: payload?.t }, deps);
  return NextResponse.json(body, { status, headers: HEADERS });
}
