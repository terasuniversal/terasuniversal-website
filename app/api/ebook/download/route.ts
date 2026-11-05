import { NextResponse } from "next/server";
import { checkSharedRateLimit } from "../../../../lib/rate-limit";
import { clientIp, isAllowedOrigin } from "../../../../lib/public-registration";
import { fetchEbookObject } from "../../../../lib/marketing/ebookStorage";
import { readCappedBody } from "../../../../lib/marketing/readCappedBody";
import {
  MAX_TOKEN_CHARS,
  ebookFileName,
  getEbookDeliveryConfig,
  loadVerifiedEbookPdf,
  verifyDownloadToken,
} from "../../../../lib/marketing/ebookDelivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2 * 1024;
const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

function respond(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * Private eBook download. The ONLY credential is the short-lived token that POST /api/ebook issues after the database
 * accepted a capture. The token travels in the POST body (a plain HTML form), never in a URL, so it cannot land in
 * access logs, browser history or a Referer header.
 *
 * Nothing the caller sends chooses what is read: the token's signed ebook id selects one fixed object key from an
 * allowlist, the object is read with a hard size cap (lib/marketing/ebookStorage.ts), the bytes are verified against the
 * Owner-approved SHA-256 before a single byte is returned, and no Storage URL (signed or public) is created or exposed.
 *
 * This is a BUFFERED response, not a stream: the whole verified file (about 4.15 MB) is held in memory once and handed to
 * the runtime. Streaming is deliberately not used because the hash must be verified before any byte is sent.
 * Every rejection answers the same way, so a caller cannot tell a forged token from an expired one.
 */
export async function POST(request: Request) {
  // Off unless capture AND delivery are both explicitly enabled and the secret is configured: a plain 404.
  const delivery = getEbookDeliveryConfig();
  if (!delivery) return respond({ error: "Not found." }, 404);
  if (!isAllowedOrigin(request)) return respond({ error: "Invalid request origin." }, 403);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) return respond({ error: "Invalid request." }, 415);
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) return respond({ error: "Invalid request." }, 413);

  if (!(await checkSharedRateLimit({ key: `ebook-dl:ip:${clientIp(request)}`, windowSeconds: 600, maxAttempts: 10, failClosed: true }))) {
    return respond({ error: "Terlalu banyak percubaan. Sila tunggu sebentar dan cuba lagi." }, 429);
  }

  const body = await readCappedBody(request, MAX_BODY_BYTES);
  if (!body.ok) return respond({ error: "Invalid request." }, body.status);
  const token = new URLSearchParams(body.text).get("token");

  const checked = verifyDownloadToken(token && token.length <= MAX_TOKEN_CHARS ? token : null, { now: Date.now(), secret: delivery.secret });
  if (!checked.ok) {
    console.error("ebook download rejected", { code: `token_${checked.reason}` });
    return respond({ error: "Pautan muat turun tidak sah atau telah tamat tempoh. Sila minta eBook semula." }, 403);
  }

  try {
    const bytes = await loadVerifiedEbookPdf(checked.ebookId, { download: fetchEbookObject });
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${ebookFileName(checked.ebookId)}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    // Fixed code only: never the object path, the Storage error or any URL.
    console.error("ebook download failed", { code: error instanceof Error && error.name === "EbookDeliveryError" ? (error as { code?: string }).code : "storage_error" });
    return respond({ error: "Maaf, eBook tidak dapat dimuat turun sekarang. Sila cuba lagi sebentar nanti." }, 503);
  }
}

// There is deliberately no GET: a download is never a link that can be shared, cached or crawled.
export async function GET() {
  return respond({ error: "Not found." }, 404);
}
