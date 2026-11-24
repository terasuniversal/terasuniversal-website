import { NextResponse } from "next/server";
import { ebookPublicEnabled } from "../../../../lib/ebook-lead";
import { processEbookDownload } from "../../../../lib/ebook-request";
import { ebookRuntime } from "../../../../lib/ebook-runtime.server";

// W9-G3 secure download (W9-EBOOK-RPC-CONTRACT v1.0 §2.3, §3; D-5). The verified page POSTs the single-use download
// token in a JSON BODY (never a query string). The CRM RPC redeems it atomically and returns the publication path; only
// the exact allowlisted object is signed, for 60 seconds, and the signed URL is returned in a no-store JSON body for the
// page to open (window.location). A 303 redirect after a form POST would be blocked by the site CSP (form-action 'self')
// because Storage is another origin. The signed URL is never logged. Single-use applies to the token; the signed URL
// itself can be reused by whoever holds it until it expires (60 s).
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
  if (!origin || origin !== new URL(request.url).origin) return NextResponse.json({ status: "download_unusable" }, { status: 403, headers: HEADERS });

  let token = null;
  try {
    const body = await request.json();
    token = typeof body?.t === "string" ? body.t : null;
  } catch {
    token = null;
  }
  const { deps } = ebookRuntime(request);
  const result = await processEbookDownload({ token }, deps);
  if (result.kind === "redirect") return NextResponse.json({ status: "ready", url: result.url }, { status: 200, headers: HEADERS });
  if (result.kind === "unavailable") return NextResponse.json({ status: "download_unavailable" }, { status: 503, headers: HEADERS });
  return NextResponse.json({ status: "download_unusable" }, { status: 200, headers: HEADERS });
}
