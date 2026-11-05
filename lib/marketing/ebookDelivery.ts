import { createHash, createHmac, timingSafeEqual } from "node:crypto";
// Self-contained on purpose (like certificate-render-asset-policy.ts): a type-only import, so the contract tests can run
// this file directly. Its object table and fingerprint are checked against EBOOK_CATALOG by the tests.
import type { EbookId } from "./ebookCapture";

/**
 * Private eBook PDF delivery: pure rules (node:crypto only), shared by the API routes and tests. Server-side code only:
 * no client component may import this file (the contract test enforces it).
 *
 * Design (docs/EBOOK_PRIVATE_DELIVERY.md): the PDF lives in a PRIVATE Storage bucket with no Storage policies. After a
 * capture that the database accepted, /api/ebook mints a short-lived HMAC token. The token is the only way to ask
 * /api/ebook/download for the file. That route reads ONE fixed, allowlisted object into memory (size-capped while it is
 * read), verifies its SHA-256, and only then sends it as an ordinary buffered response. It is NOT a streaming response.
 * No Storage URL, signed or otherwise, ever reaches the browser, and no request value ever chooses an object path.
 *
 * The delivery is OFF unless EBOOK_DELIVERY_ENABLED is exactly "true", capture is on, and the token secret is set.
 * Submitting an email address does not prove ownership of the inbox; this flow does not claim it does.
 */

export const EBOOK_PRIVATE_BUCKET = "ebook-private";
/** Short on purpose: the file is a free eBook, but a link must not become a permanent public URL. */
export const DOWNLOAD_TOKEN_TTL_SECONDS = 600;
export const MAX_TOKEN_CHARS = 512;
/**
 * One limit for two things that must never disagree: the application cap and the proposed private bucket's file_size_limit.
 * Decimal bytes on purpose. The Owner-approved Balanced PDF is 2,929,572 bytes, so it fits with ~2.4% headroom; a larger
 * file is a deliberate new decision (cap, bucket limit and tests change together). It also keeps the buffered response well
 * below the believed 4.5 MB Vercel Function response limit, which is still UNVERIFIED and needs a Vercel Staging test.
 */
export const MAX_PDF_BYTES = 3_000_000;
const MIN_SECRET_CHARS = 32;
const CLOCK_SKEW_SECONDS = 60;
const TOKEN_VERSION = "v1";

/** The ONLY objects the download route can read. A token names an ebook id; the id selects the key from this table. */
export const EBOOK_PDF_OBJECTS: Readonly<Record<EbookId, { objectPath: string; fileName: string; sha256: string }>> = {
  "dari-zero-ke-dunia-industri": {
    objectPath: "ebooks/dari-zero-ke-dunia-industri-balanced-v1.pdf",
    fileName: "TERAS_eBook_DariZeroKeDuniaIndustri.pdf",
    // Fingerprint of the Owner-approved Balanced PDF (same value as EBOOK_CATALOG). The superseded original is not mapped.
    sha256: "9595cc470063bcd5fd35404b771b09f580c3562e5b7ea38aa6aef49e37ab520c",
  },
};

export interface EbookDeliveryConfig {
  secret: string;
}

/** Null (delivery off, fail closed) unless capture is on, the flag is exactly "true" and the secret is long enough. */
export function getEbookDeliveryConfig(env: Record<string, string | undefined> = process.env): EbookDeliveryConfig | null {
  // Same exact-"true" rule as isEbookCaptureEnabled (ebookFlag.ts); the tests assert they agree.
  if (env.EBOOK_LEAD_CAPTURE_ENABLED !== "true") return null;
  if (env.EBOOK_DELIVERY_ENABLED !== "true") return null;
  const secret = env.EBOOK_DELIVERY_TOKEN_SECRET;
  if (typeof secret !== "string" || secret.length < MIN_SECRET_CHARS) return null;
  return { secret };
}

const b64u = (buf: Buffer) => buf.toString("base64url");
const B64U = /^[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sign(secret: string, payloadPart: string): Buffer {
  // Domain separated so the secret can never produce a signature valid for another purpose.
  return createHmac("sha256", secret).update(`ebook-download.${TOKEN_VERSION}.${payloadPart}`).digest();
}

export interface IssuedToken {
  token: string;
  expiresInSeconds: number;
}

/** Call only after the database accepted the capture. `now` is epoch milliseconds. */
export function issueDownloadToken(input: { ebookId: EbookId; requestId: string; now: number; secret: string }): IssuedToken {
  const issued = Math.floor(input.now / 1000);
  const payload = { e: input.ebookId, r: input.requestId, i: issued, x: issued + DOWNLOAD_TOKEN_TTL_SECONDS };
  const payloadPart = b64u(Buffer.from(JSON.stringify(payload), "utf8"));
  return { token: `${TOKEN_VERSION}.${payloadPart}.${b64u(sign(input.secret, payloadPart))}`, expiresInSeconds: DOWNLOAD_TOKEN_TTL_SECONDS };
}

export type TokenCheck = { ok: true; ebookId: EbookId } | { ok: false; reason: "malformed" | "signature" | "expired" | "claims" };

/** Never throws. The reason is for tests and fixed log codes only; callers answer every failure identically. */
export function verifyDownloadToken(token: unknown, input: { now: number; secret: string }): TokenCheck {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_CHARS) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION || !B64U.test(parts[1]) || !B64U.test(parts[2])) return { ok: false, reason: "malformed" };
  const given = Buffer.from(parts[2], "base64url");
  const expected = sign(input.secret, parts[1]);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "signature" };

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "claims" };
  }
  if (!claims || typeof claims !== "object") return { ok: false, reason: "claims" };
  const c = claims as Record<string, unknown>;
  if (typeof c.e !== "string" || !Object.hasOwn(EBOOK_PDF_OBJECTS, c.e) || typeof c.r !== "string" || !UUID.test(c.r)) return { ok: false, reason: "claims" };
  if (!Number.isInteger(c.i) || !Number.isInteger(c.x)) return { ok: false, reason: "claims" };
  const issued = c.i as number;
  const expires = c.x as number;
  const now = Math.floor(input.now / 1000);
  // Defence in depth: even a correctly signed token may not claim a longer life than we issue, or come from the future.
  if (expires - issued > DOWNLOAD_TOKEN_TTL_SECONDS || issued > now + CLOCK_SKEW_SECONDS) return { ok: false, reason: "claims" };
  if (now >= expires) return { ok: false, reason: "expired" };
  return { ok: true, ebookId: c.e as EbookId };
}

/**
 * Reads a fetch Response body into ONE Uint8Array without ever holding more than `maxBytes`. The cap is enforced on the
 * declared Content-Length before reading and on the running byte count while reading, so it never trusts a header alone
 * and never lets an oversized object be materialised. Exactly one buffer is allocated: the declared length when it is known
 * (and the body is not compressed), otherwise `maxBytes` (a view of the filled part is returned). Chunks are copied into it
 * in place; there is no chunk list and no merge copy.
 */
export async function readCappedBytes(
  response: { body: ReadableStream<Uint8Array> | null; headers: { get(name: string): string | null } },
  maxBytes: number,
): Promise<Uint8Array> {
  const encoded = (response.headers.get("content-encoding") ?? "").trim().toLowerCase();
  const rawLength = response.headers.get("content-length");
  const declared = encoded === "" || encoded === "identity" ? (rawLength !== null && /^\d+$/.test(rawLength) ? Number(rawLength) : null) : null;
  if (declared !== null && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new EbookDeliveryError("integrity");
  }
  if (!response.body) throw new EbookDeliveryError("unavailable");

  const reader = response.body.getReader();
  const buffer = new Uint8Array(declared ?? maxBytes);
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (received + value.byteLength > buffer.length) {
        await reader.cancel().catch(() => undefined);
        throw new EbookDeliveryError("integrity");
      }
      buffer.set(value, received);
      received += value.byteLength;
    }
  } catch (error) {
    if (error instanceof EbookDeliveryError) throw error;
    throw new EbookDeliveryError("unavailable");
  }
  if (declared !== null && received !== declared) throw new EbookDeliveryError("integrity");
  return received === buffer.length ? buffer : buffer.subarray(0, received);
}

export type EbookDeliveryErrorCode = "unavailable" | "integrity";
export class EbookDeliveryError extends Error {
  readonly code: EbookDeliveryErrorCode;
  constructor(code: EbookDeliveryErrorCode) {
    // Fixed wording: never an object path, URL or Storage error.
    super(code === "integrity" ? "eBook file failed its integrity check" : "eBook file could not be loaded");
    this.name = "EbookDeliveryError";
    this.code = code;
  }
}

export function ebookFileName(ebookId: EbookId): string {
  return EBOOK_PDF_OBJECTS[ebookId].fileName;
}

/**
 * Loads the allowlisted object for an ebook id and verifies it is the Owner-approved file (size, %PDF header, SHA-256)
 * before any byte is returned. `download` receives the fixed object key and the size cap it must enforce WHILE reading
 * (see readCappedBytes); the checks here are the second line, applied to the finished buffer.
 */
export async function loadVerifiedEbookPdf(ebookId: EbookId, deps: { download(objectPath: string, maxBytes: number): Promise<Uint8Array> }): Promise<Uint8Array> {
  if (!Object.hasOwn(EBOOK_PDF_OBJECTS, ebookId)) throw new EbookDeliveryError("unavailable");
  let bytes: Uint8Array;
  try {
    bytes = await deps.download(EBOOK_PDF_OBJECTS[ebookId].objectPath, MAX_PDF_BYTES);
  } catch {
    throw new EbookDeliveryError("unavailable");
  }
  const entry = EBOOK_PDF_OBJECTS[ebookId];
  // Cheap checks first; the hash is computed only for a plausible PDF within the size cap.
  if (bytes.length === 0 || bytes.length > MAX_PDF_BYTES || Buffer.from(bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") throw new EbookDeliveryError("integrity");
  if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw new EbookDeliveryError("integrity");
  return bytes;
}
