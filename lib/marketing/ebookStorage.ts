import "server-only";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "../supabase/env";
import { EBOOK_PDF_OBJECTS, EBOOK_PRIVATE_BUCKET, EbookDeliveryError, MAX_PDF_BYTES, readCappedBytes } from "./ebookDelivery";

/**
 * The ONLY read of the private eBook bucket. Server-only (the import above fails the build if a client bundle reaches it).
 *
 * Why a plain fetch and not supabase-js storage.download(): download() calls response.blob(), which materialises the whole
 * object before any size check can run. Here the body is read incrementally and abandoned the moment it passes the cap, so an
 * oversized or misconfigured object can never fill memory, and the bytes land in a single buffer.
 *
 * The URL is built from constants and the allowlisted object key only; no request value reaches it. The service key is sent as
 * a header, never in a URL, never logged, and no Storage URL (signed or public) is ever created or returned to a browser.
 * Redirects are refused so a response can never send the credential elsewhere.
 */
const ALLOWED_KEYS: ReadonlySet<string> = new Set(Object.values(EBOOK_PDF_OBJECTS).map((entry) => entry.objectPath));
const TIMEOUT_MS = 15_000;

export async function fetchEbookObject(objectPath: string, maxBytes: number): Promise<Uint8Array> {
  if (!ALLOWED_KEYS.has(objectPath) || !Number.isInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_PDF_BYTES) throw new EbookDeliveryError("unavailable");
  const key = getSupabaseServiceRoleKey();
  let origin: string;
  try {
    const url = new URL(getSupabaseUrl());
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("protocol");
    origin = url.origin; // origin only: any configured path, query or credentials are dropped
  } catch {
    throw new EbookDeliveryError("unavailable");
  }
  if (!key) throw new EbookDeliveryError("unavailable");

  const response = await fetch(`${origin}/storage/v1/object/${EBOOK_PRIVATE_BUCKET}/${objectPath}`, {
    method: "GET",
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new EbookDeliveryError("unavailable");
  }
  return readCappedBytes(response, maxBytes);
}
